import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, AustrianPostTracker, normalizeAustrianPostNumber, parseAustrianPostResponse } from './adapter';
import { austrianPostEventStatus, austrianPostSummaryStatus } from './status';

const NUMBER = '1000000000000000000001';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));

describe('Austrian Post public tracking', () => {
  it('binds history to the item and classifies scans independently of the summary', () => {
    const result = parseAustrianPostResponse(fixture(), NUMBER);
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', weight_kg: 0.45, last_update: '2026-03-29T13:00:00.747Z' });
    expect(result.events?.map((event) => event.stage)).toEqual(['delivered', 'failed_attempt', 'out_for_delivery', 'in_transit', 'registered']);
    expect(result.events?.[0]).toMatchObject({ location: 'Synthetic destination' });
  });

  it('rejects a different returned item', () => {
    const payload = fixture();
    payload.data.einzelsendung.sendungsnummer = '1000000000000000000002';
    expect(() => parseAustrianPostResponse(payload, NUMBER)).toThrow('different shipment');
  });

  it('separates positive not-found from missing data, query errors and empty history', () => {
    expect(() => parseAustrianPostResponse({ data: { einzelsendung: null } }, NUMBER)).toThrow('could not locate');
    expect(() => parseAustrianPostResponse({ data: {} }, NUMBER)).toThrow('invalid tracking response');
    expect(() => parseAustrianPostResponse({ data: { einzelsendung: null }, errors: [{ message: 'Unavailable' }] }, NUMBER)).toThrow('could not complete');
    const payload = fixture();
    payload.data.einzelsendung.sendungsEvents = [];
    expect(() => parseAustrianPostResponse(payload, NUMBER)).toThrow('without tracking history');
  });

  it('requires scan wording and explicit timestamp offsets', () => {
    const payload = fixture();
    payload.data.einzelsendung.sendungsEvents[0].timestamp = '2026-03-28T12:00:00';
    expect(() => parseAustrianPostResponse(payload, NUMBER)).toThrow('incomplete scan');
    payload.data.einzelsendung.sendungsEvents[0].timestamp = '2026-03-28T12:00:00+02:00';
    payload.data.einzelsendung.sendungsEvents[0].trackingDesc = '';
    expect(() => parseAustrianPostResponse(payload, NUMBER)).toThrow('incomplete scan');
  });

  it('deduplicates scans and keeps unfamiliar stages unresolved', () => {
    const payload = fixture();
    payload.data.einzelsendung.status = 'NEW';
    payload.data.einzelsendung.sendungsEvents.push({ ...payload.data.einzelsendung.sendungsEvents[4] });
    payload.data.einzelsendung.sendungsEvents[0].status = 'NEW';
    payload.data.einzelsendung.sendungsEvents[0].trackingDesc = 'New milestone';
    expect(parseAustrianPostResponse(payload, NUMBER)).toMatchObject({ status: 'unknown', events: expect.any(Array) });
    expect(parseAustrianPostResponse(payload, NUMBER).events).toHaveLength(5);
    expect(parseAustrianPostResponse(payload, NUMBER).events?.[4]).not.toHaveProperty('stage');
  });

  it('separates summary and scan vocabularies for pickup, returns and delivery', () => {
    expect(austrianPostSummaryStatus('IZ')?.stage).toBe('out_for_delivery');
    expect(austrianPostEventStatus('IZ', 'ZA', '')?.stage).toBe('delivered');
    expect(austrianPostEventStatus('IZ', 'BH', '')?.stage).toBe('failed_attempt');
    expect(austrianPostEventStatus('IZ', 'HO', '')?.stage).toBe('ready_for_pickup');
    expect(austrianPostSummaryStatus('RE')?.stage).toBe('returned');
  });

  it('makes one anonymous bounded query and honors caller cancellation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fixture())));
    await new AustrianPostTracker({ fetcher }).fetch(NUMBER, { budgetMs: 900.5 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.post.at/sendungen/sv/graphqlPublic');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
    expect(JSON.parse(String(init?.body)).query).toContain(`sendungsnummer: "${NUMBER}"`);
    expect(init?.headers).not.toHaveProperty('Authorization');
    const cancelled = AbortSignal.abort();
    await expect(new AustrianPostTracker({ fetcher }).fetch(NUMBER, { signal: cancelled })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not treat an unavailable endpoint as an unknown parcel', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    await expect(new AustrianPostTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'transport' });
  });

  it('rejects invalid input before network and exposes recognition for ambiguous digits', async () => {
    expect(normalizeAustrianPostNumber(` ${NUMBER} `)).toBe(NUMBER);
    expect(() => normalizeAustrianPostNumber(`${NUMBER}"}`)).toThrow(TypeError);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fixture())));
    const tracker = adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
    await expect(tracker.recognize!('123')).resolves.toEqual({ known: false });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(tracker.recognize!(NUMBER)).resolves.toMatchObject({ known: true });
  });
});
