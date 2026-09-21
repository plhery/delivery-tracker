import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';
import { AdapterRegistry } from '../../core/adapter';
import { carrierDefinition, CARRIERS } from '../../core/catalog';
import { detectCarrier, parseTrackingInput } from '../../core/detection';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { REGISTRY } from '../../generated/registry';
import { EmsTracker, normalizeEmsTrackingNumber, parse } from './adapter';

const NUMBER = 'EB000000005CN';
const fixture = (name = 'positive') => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');
function withLastStatus(status: string): string {
  const $ = load(fixture());
  $('tbody tr').last().find('td').eq(1).text(status);
  return $.html();
}

describe('EMS result projection', () => {
  it('returns identity-bound history in provider order with local wall times', () => {
    const result = normalizeCarrierResult(parse(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'in_transit', current_stage: 'customs',
      last_status_text: 'Held for export customs inspection', last_update: '2026-09-03T22:23:00', expected_delivery: null });
    expect(result.events).toHaveLength(6);
    expect(result.events?.map((event) => event.stage)).toEqual([
      'customs', 'in_transit', 'in_transit', 'customs', 'in_transit', 'accepted',
    ]);
    expect(result.events?.[1].description).toBe('Departed from export office');
    expect(result.events?.[2].description).toBe('Released from export customs and security');
    expect(result.events?.every((event) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(event.time!))).toBe(true);
    expect(result.timezone).toBeUndefined();
  });

  it('also handles EMS history from another postal operator', () => {
    const result = parse(fixture('international'), 'EW000000005FR');
    expect(result.events).toHaveLength(9);
    expect(result).toMatchObject({ status: 'in_transit', current_stage: 'in_transit',
      last_status_text: 'Arrived at post office', last_update: '2026-08-06T07:51:00' });
  });

  it('keeps equal-time ordering and clock changes instead of guessing timezones', () => {
    const $ = load(fixture());
    $('tbody tr').last().find('td').first().text('Sep 1, 2026, 9:00 AM');
    const result = parse($.html(), NUMBER);
    expect(result.last_update).toBe('2026-09-01T09:00:00');
    expect(result.last_status_text).toBe('Held for export customs inspection');
  });

  it('rejects wrong or duplicate result identities even when the form echoes the request', () => {
    const $ = load(fixture());
    $('.result-table').attr('id', 'table-EB123456785CN');
    expect(() => parse($.html(), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    const duplicate = load(fixture());
    duplicate('body').append(duplicate('.result-table').clone());
    expect(() => parse(duplicate.html(), NUMBER)).toThrow('ambiguous');
    expect(() => parse(`<input value="${NUMBER}">${fixture().replaceAll(NUMBER, 'EB123456785CN')}`, NUMBER))
      .toThrow('different or ambiguous');
  });

  it('ignores unrelated tables and non-tracking personal fields', () => {
    const $ = load(fixture());
    $('body').append('<aside>PRIVATE_RECIPIENT PRIVATE_ADDRESS PRIVATE_SIGNATURE</aside>');
    $('body').append(fixture().replaceAll(NUMBER, 'EB123456785CN').replaceAll('Posted', 'PRIVATE_OTHER_ITEM'));
    const result = parse($.html(), NUMBER);
    expect(result.events).toHaveLength(6);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(Object.keys(result).sort()).toEqual([
      'current_stage', 'events', 'expected_delivery', 'last_status_text', 'last_update', 'status',
    ]);
  });

  it('recognizes only the exact empty-result row as not found', () => {
    expect(() => parse(fixture('absent'), NUMBER)).toThrow(expect.objectContaining({ kind: 'not_found', status: 404 }));
    const $ = load(fixture('absent'));
    $('tbody').append('<tr><td>Sep 1, 2026, 9:00 AM</td><td>Posted</td><td>Example office</td></tr>');
    expect(() => parse($.html(), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    expect(() => parse(fixture('absent').replace('There were no results found.', 'Maintenance, try again later'), NUMBER))
      .toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it.each(['empty', 'changed-header', 'bad-date', 'missing-cell', 'empty-status'])('rejects %s history instead of using older progress', (mode) => {
    const $ = load(fixture());
    if (mode === 'empty') $('tbody').empty();
    if (mode === 'changed-header') $('th').first().text('Changed schema');
    if (mode === 'bad-date') $('tbody tr').last().find('td').first().text('Feb 30, 2026, 9:00 AM');
    if (mode === 'missing-cell') $('tbody tr').last().find('td').last().remove();
    if (mode === 'empty-status') $('tbody tr').last().find('td').eq(1).empty();
    expect(() => parse($.html(), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('separates application rejection, challenge and generic HTML from absence', () => {
    expect(() => parse(fixture('non-ems').replaceAll('LZ000000005CN', NUMBER), NUMBER))
      .toThrow(expect.objectContaining({ kind: 'input_required' }));
    expect(() => parse('<title>Just a moment...</title>', NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
    expect(() => parse('<html>Maintenance</html>', NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('deduplicates identical scans and bounds the returned history', () => {
    const $ = load(fixture());
    $('tbody').append($('tbody tr').last().clone());
    expect(parse($.html(), NUMBER).events).toHaveLength(6);
    for (let i = 0; i < 110; i++) {
      $('tbody').append(`<tr><td>Sep 4, 2026, 9:00 AM</td><td>Posted</td><td>Example office ${i}</td></tr>`);
    }
    expect(parse($.html(), NUMBER).events).toHaveLength(100);
    expect(parse($.html(), NUMBER).events?.[0].location).toBe('Example office 109');
  });

  it.each([
    ['Delivered', 'delivered', 'delivered'],
    ['Out for delivery', 'out_for_delivery', 'out_for_delivery'],
    ['Delivery attempted', 'exception', 'failed_attempt'],
    ['Returned to sender', 'exception', 'returned'],
    ['Released from import customs', 'in_transit', 'in_transit'],
  ])('maps the exact wording %s without changing older stages', (wording, status, stage) => {
    const result = parse(withLastStatus(wording), NUMBER);
    expect(result).toMatchObject({ status, current_stage: stage });
    expect(result.events?.at(-1)?.stage).toBe('accepted');
  });

  it.each(['Not delivered', 'Expected delivery', 'Delivery office notified', 'New upstream wording'])('preserves unmapped wording %s without inventing progress', (wording) => {
    const result = parse(withLastStatus(wording), NUMBER);
    expect(result).toMatchObject({ status: 'unknown', last_status_text: wording });
    expect(result.current_stage).toBeUndefined();
    expect(result.events?.[0].stage).toBeUndefined();
  });

  it('proves each declared capability with a scrubbed fixture', () => {
    const result = parse(fixture(), NUMBER);
    const checks: Record<string, boolean> = { history: Boolean(result.events?.length),
      location: Boolean(result.events?.some((event) => event.location)) };
    const capabilities = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8')).capabilities as string[];
    for (const capability of capabilities) expect(checks[capability], capability).toBe(true);
  });
});

describe('EMS retrieval and registration', () => {
  it('uses the registered adapter and one fresh bounded GET per lookup', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(fixture()));
    const registry = new AdapterRegistry(REGISTRY, { fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
    expect(registry.adapterIdFor('ems')).toBe('ems');
    const instance = registry.for('ems')!;
    expect(instance.steps).toEqual(['direct']);
    await expect(instance.track({ number: 'eb 000.000-005 cn' })).resolves.toMatchObject({ current_stage: 'customs' });
    await instance.track({ number: NUMBER });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toBe(`https://items.ems.post/api/publicTracking/track?language=EN&itemId=${NUMBER}`);
      expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
      expect(new Headers(init?.headers).get('User-Agent')).toContain('Mozilla/5.0');
      expect(new Headers(init?.headers).has('Cookie')).toBe(false);
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each(['LZ000000005CN', 'EB000000000CN', 'TRACK&itemId=123', ''])('rejects unsupported input %s before I/O', async (number) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new EmsTracker({ fetcher }).fetch(number)).rejects.toMatchObject({ kind: 'input_required' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([[403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance'], [404, 'transport'], [410, 'transport']])(
    'does not confuse HTTP %s with a missing parcel or retry it', async (status, kind) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Failure', { status: Number(status) }));
      await expect(new EmsTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('propagates pre-abort, in-flight cancellation and a fractional timeout budget', async () => {
    const preAborted = AbortSignal.abort();
    const unused = vi.fn<typeof fetch>();
    await expect(new EmsTracker({ fetcher: unused }).fetch(NUMBER, { signal: preAborted })).rejects.toThrow();
    expect(unused).not.toHaveBeenCalled();
    const abort = new AbortController();
    const cancelled = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      abort.abort();
      init?.signal?.throwIfAborted();
      return new Response(fixture());
    });
    await expect(new EmsTracker({ fetcher: cancelled }).fetch(NUMBER, { signal: abort.signal })).rejects.toThrow();
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise<void>((resolve) => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      init?.signal?.throwIfAborted();
      return new Response(fixture());
    });
    await expect(new EmsTracker({ fetcher: slow }).fetch(NUMBER, { budgetMs: 20.5 })).rejects.toMatchObject({ kind: 'transport' });
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it('enforces the streaming response limit', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new EmsTracker({ fetcher }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
  });

  it('is selectable through the catalog or its official link while retaining national number detection', () => {
    expect(normalizeEmsTrackingNumber('eb 000.000-005 cn')).toBe(NUMBER);
    expect(carrierDefinition('ems')).toMatchObject({ selectable: true, tracking: { adapter: 'ems' } });
    const url = CARRIERS.ems.trackingUrl!(NUMBER);
    expect(parseTrackingInput(url)).toMatchObject({ carrier: 'ems', trackingNumber: NUMBER, source: 'link', confidence: 'high' });
    expect(detectCarrier(NUMBER)).toBe('china-post');
    expect(detectCarrier('EW000000005FR')).toBe('la-poste');
    expect(detectCarrier('LZ000000005CN')).toBe('china-post');
  });
});
