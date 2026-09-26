import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { adapter, AustraliaPostTracker, australiaPostApiUrl, australiaPostTrackingUrl, normalizeAustraliaPostNumber, parse } from './adapter';
import { TrawlClient } from '../../core/transport';
import { NOOP_RECORDER } from '../../core/telemetry';

const NUMBER = '7T0000000001000000001';
const OTHER = '7T0000000001000000002';
const UNKNOWN = '7T0000000000000000000';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const empty = () => JSON.parse(readFileSync(new URL('./fixtures/not-found.json', import.meta.url), 'utf8'));
const capabilities = (JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8')) as { capabilities: string[] }).capabilities;

describe('Australia Post parser', () => {
  it('projects all capabilities without retaining private details or modification times', () => {
    const result = parse(fixture(), NUMBER);
    expect(capabilities).toEqual(['history', 'location', 'provider_code', 'delivered_at']);
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_status_text: 'Delivered',
      last_update: '2026-06-08T14:10:00+10:00', delivered_at: '2026-06-08T14:10:00+10:00', expected_delivery: null });
    expect(result.events).toHaveLength(12);
    expect(result.events?.[0]).toEqual({ time: '2026-06-08T14:10:00+10:00', description: 'Delivered',
      location: 'Example sorting facility', stage: 'delivered', provider_code: 'DD-ER15' });
    expect(result.events?.[1]?.stage).toBe('out_for_delivery');
    expect(result.events?.[8]?.stage).toBe('accepted');
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|example\.invalid|7T0000000001000000001|14:10:5[78]/);
  });

  it('sorts by absolute instant, deduplicates scans and preserves their explicit offsets', () => {
    const payload = fixture();
    const events = payload[0].shipment.articles[0].details[0].events;
    events.push(structuredClone(events[0]));
    events.reverse();
    const result = parse(payload, NUMBER);
    expect(result.events).toHaveLength(12);
    expect(result.events?.[0]?.stage).toBe('delivered');
    expect(result.events?.[4]?.time).toBe('2026-06-07T16:10:00+09:30');
    expect(result.events?.map((event) => Date.parse(event.time!))).toEqual(
      result.events?.map((event) => Date.parse(event.time!)).sort((a, b) => b - a),
    );
  });

  it('selects an exact article without promoting a delivered sibling to consignment completion', () => {
    const payload = fixture();
    const target = payload[0].shipment.articles[0];
    const sibling = structuredClone(target);
    sibling.articleId = OTHER;
    sibling.details[0].articleId = OTHER;
    target.trackStatusOfArticle = 'In transit';
    target.details[0].events = target.details[0].events.slice(2);
    payload[0].shipment.articles.unshift(sibling);
    expect(parse(payload, NUMBER)).toMatchObject({ status: 'in_transit', current_stage: 'in_transit' });
    expect(parse(payload, NUMBER).delivered_at).toBeUndefined();
    const consignment = payload[0].shipment.consignmentId;
    payload[0].trackingIds = [consignment];
    expect(() => parse(payload, consignment)).toThrow(expect.objectContaining({ kind: 'schema' }));
    payload[0].shipment.articles = [target];
    expect(parse(payload, consignment).status).toBe('in_transit');
  });

  it('requires matched lookup, article and detail identities, including negative replies', () => {
    expect(() => parse(empty(), UNKNOWN)).toThrow(expect.objectContaining({ kind: 'not_found' }));
    expect(() => parse(empty(), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    for (const change of [
      (p: ReturnType<typeof fixture>) => { p[0].trackingIds = [OTHER]; },
      (p: ReturnType<typeof fixture>) => { p[0].shipment.articles[0].articleId = OTHER; },
      (p: ReturnType<typeof fixture>) => { p[0].shipment.articles[0].details[0].articleId = OTHER; },
      (p: ReturnType<typeof fixture>) => { p[0].shipment.articles[0].details[0].consignmentId = OTHER; },
      (p: ReturnType<typeof fixture>) => { p[0].shipment.articles.push(structuredClone(p[0].shipment.articles[0])); },
      (p: ReturnType<typeof fixture>) => { p.push(structuredClone(p[0])); },
    ]) {
      const payload = fixture(); change(payload);
      expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
    const wrongError = empty(); wrongError[0].error.errorCode = 99;
    expect(() => parse(wrongError, UNKNOWN)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('leaves unknown status and events unclassified rather than borrowing delivery', () => {
    const payload = fixture();
    const article = payload[0].shipment.articles[0];
    article.trackStatusOfArticle = 'Future milestone';
    article.details[0].events[0].milestone = 'Future milestone';
    article.details[0].events[0].eventCode = 'NEW-CODE';
    const result = parse(payload, NUMBER);
    expect(result.status).toBe('unknown');
    expect(result.current_stage).toBeUndefined();
    expect(result.delivered_at).toBeUndefined();
    expect(result.events?.[0]?.stage).toBeUndefined();
  });

  it.each([
    ['Awaiting collection', 'in_transit', 'ready_for_pickup'],
    ['Attempted delivery', 'exception', 'failed_attempt'],
    ['Returned to sender', 'exception', 'returned'],
    ['Delayed', 'exception', 'exception'],
  ])('does not mistake %s for final delivery', (label, status, stage) => {
    const payload = fixture(); payload[0].shipment.articles[0].trackStatusOfArticle = label;
    expect(parse(payload, NUMBER)).toMatchObject({ status, current_stage: stage });
    expect(parse(payload, NUMBER).delivered_at).toBeUndefined();
  });

  it('uses verified epoch milliseconds when local display time is absent', () => {
    const payload = fixture(); delete payload[0].shipment.articles[0].details[0].events[0].localeDateTime;
    expect(parse(payload, NUMBER).last_update).toBe('2026-06-08T04:10:00Z');
  });

  it('rejects schema changes, ambiguous details, invalid and contradictory times', () => {
    for (const change of [
      (p: ReturnType<typeof fixture>) => { p[0].shipment.articles = []; },
      (p: ReturnType<typeof fixture>) => { p[0].shipment.articles[0].details.push(structuredClone(p[0].shipment.articles[0].details[0])); },
      (p: ReturnType<typeof fixture>) => { p[0].shipment.articles[0].details[0].events = []; },
      (p: ReturnType<typeof fixture>) => { p[0].shipment.articles[0].details[0].events[0].dateTime += 1000; },
      (p: ReturnType<typeof fixture>) => { Object.assign(p[0].shipment.articles[0].details[0].events[0], { dateTime: 0, localeDateTime: '2026-02-31T10:00:00+10:00' }); },
      (p: ReturnType<typeof fixture>) => { Object.assign(p[0].shipment.articles[0].details[0].events[0], { dateTime: 1780000000, localeDateTime: null }); },
      (p: ReturnType<typeof fixture>) => { p[0].shipment.articles[0].details[0].events[0].description = ''; },
      (p: ReturnType<typeof fixture>) => { p[0].shipment.articles[0].details[0].events = Array(501).fill(p[0].shipment.articles[0].details[0].events[0]); },
    ]) {
      const payload = fixture(); change(payload);
      expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
    for (const payload of [{}, [], [null]]) expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });
});

function capture(body: unknown = fixture(), status = 200) {
  return { url: australiaPostApiUrl(NUMBER), status, body: JSON.stringify(body), headers: {} };
}
function service(captures: Array<Record<string, unknown>> = [capture()], extra: Record<string, unknown> = {}) {
  return { url: australiaPostTrackingUrl(NUMBER), html: '<html/>', tier: 2, statusCode: 200,
    capturedResponses: captures, ...extra };
}
function tracker(payload: unknown) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
  const trawl = new TrawlClient('https://browser.example.test', fetcher);
  return { fetcher, trawl, tracker: new AustraliaPostTracker({ trawl }) };
}

describe('Australia Post browser retrieval', () => {
  it('serializes exact capture and page URLs, reserves transport time and records the step', async () => {
    const { trawl, fetcher } = tracker(service());
    const recorder = { step: vi.fn(), lookup: vi.fn() };
    const carrier = adapter({ trawl, recorder, env: {}, browserExecutablePath: null });
    await expect(carrier.track({ number: NUMBER })).resolves.toMatchObject({ status: 'delivered' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    expect(request).toMatchObject({ url: australiaPostTrackingUrl(NUMBER), skipHttp: true,
      maxTier: 3, captureResponses: [australiaPostApiUrl(NUMBER)] });
    expect(request.maxTimeout).toBeGreaterThan(29_000);
    expect(request.maxTimeout).toBeLessThanOrEqual(30_000);
    expect(JSON.stringify(request)).not.toMatch(/api-key|Cookie|Authorization/);
    expect(recorder.step).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'australia-post', step: 'trawl', outcome: 'ok' }));
    expect(recorder.lookup).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ok', attempts: 1 }));
  });

  it('uses only the latest exact response, ignoring preflight and unrelated numbers', async () => {
    const unrelated = { ...capture(), url: australiaPostApiUrl(OTHER) };
    await expect(tracker(service([capture({}, 403), capture(), { ...capture({}, 204) }, unrelated])).tracker.fetch(NUMBER))
      .resolves.toMatchObject({ status: 'delivered' });
    await expect(tracker(service([unrelated])).tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'transport' });
    await expect(tracker(service([capture(), capture({}, 403)])).tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'challenge' });
  });

  it('classifies the inner matched negative response while HTTP errors remain separate', async () => {
    const payload = empty(); payload[0].trackingIds = [NUMBER];
    await expect(tracker(service([capture(payload)])).tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'not_found' });
    for (const [status, kind] of [[401, 'challenge'], [403, 'challenge'], [429, 'rate_limited'], [500, 'indeterminate']] as const) {
      await expect(tracker(service([capture({}, status)])).tracker.fetch(NUMBER)).rejects.toMatchObject({ kind });
    }
  });

  it('rejects empty, oversized, incomplete and malformed captures', async () => {
    for (const value of [
      service([]), service([capture()], { tier: 1 }),
      service([{ ...capture(), body: 'not JSON' }]),
      service([{ ...capture(), body: 'x'.repeat(1_000_001) }]),
      service([{ ...capture(), truncated: true }]),
      service([{ ...capture(), base64Encoded: true }]),
      service([{ ...capture(), error: 'capture failed' }]),
    ]) await expect(tracker(value).tracker.fetch(NUMBER)).rejects.toThrow();
  });

  it('requires a browser, validates input and honors cancellation and caller budgets', async () => {
    await expect(new AustraliaPostTracker({ trawl: null }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'challenge' });
    const { tracker: client, fetcher } = tracker(service());
    await expect(client.fetch('bad')).rejects.toMatchObject({ kind: 'input_required' });
    await expect(client.fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    for (const budgetMs of [0, -1, Infinity, 60_001]) await expect(client.fetch(NUMBER, { budgetMs })).rejects.toThrow('budget');
    for (const budgetMs of [1, 15_000]) await expect(client.fetch(NUMBER, { budgetMs })).rejects.toMatchObject({ kind: 'budget' });
    await expect(client.fetch('7'.repeat(35))).rejects.toMatchObject({ kind: 'input_required' });
    expect(fetcher).not.toHaveBeenCalled();
    await client.fetch(NUMBER, { budgetMs: 20_000 });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).maxTimeout).toBeLessThanOrEqual(5000);
    expect(normalizeAustraliaPostNumber('7t0000000001000000001')).toBe(NUMBER);
  });

  it('also works through an adapter with the no-op recorder', async () => {
    const { trawl } = tracker(service());
    await expect(adapter({ trawl, recorder: NOOP_RECORDER, env: {}, browserExecutablePath: null }).track({ number: NUMBER }))
      .resolves.toMatchObject({ status: 'delivered' });
  });
});
