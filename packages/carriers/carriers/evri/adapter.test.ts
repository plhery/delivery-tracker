import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { adapter, EvriTracker, normalizeEvriNumber, parse } from './adapter';
import { NOOP_RECORDER } from '../../core/telemetry';

const NUMBER = 'H000000000000001';
const UNKNOWN = 'H000000000000000';
const html = readFileSync(new URL('./fixtures/international.html', import.meta.url), 'utf8');
const empty = readFileSync(new URL('./fixtures/not-found.html', import.meta.url), 'utf8');
const capabilities = (JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8')) as { capabilities: string[] }).capabilities;

describe('Evri International parser', () => {
  it('binds the shipment identity independently of the partner-alias form field', () => {
    const result = parse(html, NUMBER);
    expect(result).toMatchObject({ status: 'exception', current_stage: 'failed_attempt',
      last_update: null, last_update_local: '2026-06-08T12:08:00', last_status_text: 'Delivery Attempted', expected_delivery: null });
    expect(result.events).toHaveLength(7);
    expect(result.events?.map((event) => event.stage)).toEqual([
      'failed_attempt', 'in_transit', 'in_transit', 'customs', 'in_transit', 'accepted', 'registered',
    ]);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|example\.invalid|CI000000005NL|H000000000000001/);
  });

  it('exercises every declared capability', () => {
    expect(capabilities).toEqual(['history', 'location', 'weight']);
    const result = parse(html, NUMBER);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.[0]?.location).toBe('ET');
    expect(result.weight_kg).toBe(1.95);
  });

  it('preserves portal order and wall clocks across international legs', () => {
    const value = html.replaceAll('2026-06-08 12:08:00', '2026-06-08 09:00:00');
    const result = parse(value, NUMBER);
    expect(result.events?.slice(0, 2).map((event) => event.local_time)).toEqual(['2026-06-08T09:00:00', '2026-06-08T11:51:00']);
    expect(result.events?.every((event) => !event.time)).toBe(true);
    expect(result.timezone).toBeUndefined();
  });

  it('only accepts the exact unambiguous parcel-not-found response to the scoped POST', () => {
    expect(() => parse(empty, UNKNOWN)).toThrow(expect.objectContaining({ kind: 'not_found' }));
    expect(() => parse(empty.replace('name="tracking_number" value=""', `name="tracking_number" value="${NUMBER}"`), UNKNOWN))
      .toThrow(expect.objectContaining({ kind: 'schema' }));
    expect(() => parse('<main><h2>Parcel not found</h2></main>', UNKNOWN)).toThrow(expect.objectContaining({ kind: 'schema' }));
    expect(() => parse(empty.replace('Parcel not found', 'Temporarily unavailable'), UNKNOWN)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('rejects wrong, ambiguous, empty and malformed shipment results', () => {
    for (const value of [
      html.replace(`Shipment Details #${NUMBER}`, `Shipment Details #${UNKNOWN}`),
      html.replace(`Tracking:</strong> ${NUMBER}`, `Tracking:</strong> ${UNKNOWN}`),
      html.replace('</main>', '<div class="card"><h2>Shipment History</h2></div></main>'),
      html.replace('<th>Comments</th>', '<th>Changed schema</th>'),
      html.replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody></tbody>'),
      html.replace('2026-06-08 12:08:00', '2026-02-31 12:08:00'),
      html.replace('2026-06-08 12:08:00', '2026-06-08'),
      html.replace('<td>Delivery Attempted</td>', '<td></td>'),
      html.replace('<td>Delivery Attempted</td>', '<td colspan="2">Delivery Attempted</td>'),
      html.replace('<strong>Current Status:</strong> Delivery Attempted', '<strong>Current Status:</strong>'),
    ]) expect(() => parse(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    const row = '<tr><td>2026-06-08 12:08:00</td><td>Delivered</td><td>GB</td><td></td></tr>';
    expect(() => parse(html.replace(/<tbody>[\s\S]*?<\/tbody>/, `<tbody>${row.repeat(501)}</tbody>`), NUMBER))
      .toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('leaves unknown current and historical wording unclassified', () => {
    const result = parse(html.replaceAll('Delivery Attempted', 'Future Evri milestone'), NUMBER);
    expect(result.status).toBe('unknown');
    expect(result.current_stage).toBeUndefined();
    expect(result.events?.[0]).toMatchObject({ description: 'Future Evri milestone' });
    expect(result.events?.[0]?.stage).toBeUndefined();
  });

  it.each([
    ['Delivered', 'delivered', 'delivered'],
    ['Out for delivery', 'out_for_delivery', 'out_for_delivery'],
    ['Ready for collection', 'in_transit', 'ready_for_pickup'],
    ['Returned to sender', 'exception', 'returned'],
    ['Carrier label error', 'exception', 'exception'],
    ['Delivery Attempted', 'exception', 'failed_attempt'],
  ])('maps %s without confusing completion, collection and return', (label, status, stage) => {
    expect(parse(html.replaceAll('Delivery Attempted', label), NUMBER)).toMatchObject({ status, current_stage: stage });
  });

  it('does not claim malformed or nonpositive weights', () => {
    for (const value of ['0 kg', '-1 kg', '2 lb', 'unknown']) {
      expect(parse(html.replace('1.95 kg', value), NUMBER).weight_kg).toBeUndefined();
    }
  });

  it('recognizes an interactive challenge and validates input before retrieval', () => {
    expect(() => parse('<title>Verify you are human</title>', NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
    expect(normalizeEvriNumber('h0000 0000 0000 001')).toBe(NUMBER);
    expect(() => normalizeEvriNumber('12345678')).toThrow(expect.objectContaining({ kind: 'input_required' }));
  });
});

describe('Evri International retrieval', () => {
  it('uses one cookie-free bounded form POST and the caller-provided transport', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(html));
    const carrier = adapter({ fetcher, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });
    await expect(carrier.track({ number: NUMBER }, { budgetMs: 1234.5 })).resolves.toMatchObject({ status: 'exception' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://globaleco.app/track', expect.objectContaining({
      method: 'POST', body: `tracking_number=${NUMBER}`, cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
      headers: { Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' },
    }));
  });

  it.each([403, 404, 410, 429, 503])('does not report endpoint HTTP %i as a missing parcel', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Unavailable', { status }));
    await expect(new EvriTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({
      kind: [404, 410].includes(status) ? 'transport' : status === 403 ? 'challenge' : status === 429 ? 'rate_limited' : 'maintenance',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized responses and respects caller cancellation', async () => {
    const large = vi.fn<typeof fetch>().mockResolvedValue(new Response(html, { headers: { 'content-length': '1000001' } }));
    await expect(new EvriTracker({ fetcher: large }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      return new Response(html);
    });
    await expect(new EvriTracker({ fetcher }).fetch(NUMBER, { signal: controller.signal })).rejects.toThrow();
    fetcher.mockClear();
    await expect(new EvriTracker({ fetcher }).fetch(NUMBER, { signal: controller.signal })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects invalid input and timeout without making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new EvriTracker({ fetcher }).fetch('invalid')).rejects.toMatchObject({ kind: 'input_required' });
    for (const budgetMs of [0, -1, NaN, Infinity]) await expect(new EvriTracker({ fetcher }).fetch(NUMBER, { budgetMs })).rejects.toThrow('positive');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
