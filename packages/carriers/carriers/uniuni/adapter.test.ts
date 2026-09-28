import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, UniuniTracker } from './adapter';
import { normalizeUniuniNumber, parseUniuni } from './parser';
import { uniuniStatus } from './status';

const NUMBER = 'UUS0000000000000001';
const OTHER = 'UUS0000000000000002';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));

describe('UniUni parcel history', () => {
  it('binds the parcel and uses corrected seconds, excluding private detail and day estimates', () => {
    const result = normalizeCarrierResult(parseUniuni(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered',
      last_update: '2026-01-05T22:00:00Z', delivered_at: '2026-01-05T22:00:00Z', expected_delivery: null });
    expect(result.events).toHaveLength(9);
    expect(result.events?.[0]).toMatchObject({ description: 'Delivered', provider_code: '203', location: 'Example City, EX', time: result.last_update });
    expect(result.events?.[2]).toMatchObject({ stage: 'failed_attempt', description: 'Failed delivery attempt, returning to the warehouse' });
    expect(result.events?.at(-1)).toMatchObject({ stage: 'registered', time: '2026-01-01T14:30:00Z' });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|pathTime|latitude|longitude|operator|estimate_time|second_delivery/);
    const metadata = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    const evidence: Record<string, boolean> = { history: Boolean(result.events?.length), location: Boolean(result.events?.some(scan => scan.location)),
      delivered_at: Boolean(result.delivered_at) };
    for (const capability of metadata.capabilities) expect(evidence[capability], capability).toBe(true);
  });

  it('never falls back to a mismatching first parcel or merges ambiguous identities', () => {
    const wrong = fixture(); wrong.data.valid_tno[0].tno = OTHER;
    const duplicate = fixture(); duplicate.data.valid_tno.push(duplicate.data.valid_tno[0]);
    const conflicting = fixture(); conflicting.data.invalid_tno = NUMBER;
    for (const value of [null, {}, { status: 'SUCCESS' }, wrong, duplicate, conflicting]) {
      expect(() => parseUniuni(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
  });

  it('requires the exact observed negative signature and leaves empty or failed lookups inconclusive', () => {
    const negative = { status: 'SUCCESS', err_code: 1, data: { invalid_tno: NUMBER, valid_tno: [] } };
    expect(() => parseUniuni(negative, NUMBER)).toThrow(expect.objectContaining({ kind: 'not_found' }));
    for (const invalid of [OTHER, `${NUMBER},${OTHER}`]) {
      expect(() => parseUniuni({ ...negative, data: { ...negative.data, invalid_tno: invalid } }, NUMBER))
        .toThrow(expect.objectContaining({ kind: 'schema' }));
    }
    expect(() => parseUniuni({ ...negative, data: { invalid_tno: '', valid_tno: [] } }, NUMBER))
      .toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parseUniuni({ status: 'ERROR', ret_msg: 'Unknown key', data: negative.data }, NUMBER))
      .toThrow(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it.each([true, 1, '1'])('rejects master shipments with marker %s instead of completing unfinished pieces', is_master => {
    const value = fixture(); value.data.valid_tno[0].is_master = is_master;
    expect(() => parseUniuni(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it.each([false, 0, '0', null, undefined])('accepts explicit non-master marker %s', is_master => {
    const value = fixture(); value.data.valid_tno[0].is_master = is_master;
    expect(parseUniuni(value, NUMBER).status).toBe('delivered');
  });

  it.each(['true', 'false', 2, -1, {}, []])('rejects unrecognized master marker %s', is_master => {
    const value = fixture(); value.data.valid_tno[0].is_master = is_master;
    expect(() => parseUniuni(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('rejects master/piece envelopes and malformed or excessive histories', () => {
    const master = fixture(); master.data.valid_tno[0].master_tno = NUMBER;
    const pieces = fixture(); pieces.data.valid_tno[0].orders_list = [{ tno: OTHER, state: 200 }];
    for (const value of [master, pieces]) expect(() => parseUniuni(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    for (const row of [null, {}, { ...fixture().data.valid_tno[0].spath_list[0], description_en: '' }]) {
      const value = fixture(); value.data.valid_tno[0].spath_list[0] = row;
      expect(() => parseUniuni(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
    const empty = fixture(); empty.data.valid_tno[0].spath_list = [];
    expect(() => parseUniuni(empty, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    const excessive = fixture(); excessive.data.valid_tno[0].spath_list = Array(501).fill(excessive.data.valid_tno[0].spath_list[0]);
    expect(() => parseUniuni(excessive, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('preserves an incomplete newest clock without borrowing local-encoded pathTime or an older delivery', () => {
    const value = fixture(); const latest = value.data.valid_tno[0].spath_list.at(-1);
    delete latest.dateTime.ts;
    const result = normalizeCarrierResult(parseUniuni(value, NUMBER));
    expect(result).toMatchObject({ status: 'delivered', last_update: null, last_update_local: '2026-01-05T16:00:00' });
    expect(result.events?.[0]).toMatchObject({ local_time: '2026-01-05T16:00:00' });
    expect(result.events?.[0]).not.toHaveProperty('time');
    expect(result).not.toHaveProperty('delivered_at');
    latest.dateTime.localTime = '2026-02-30 16:00:00';
    expect(parseUniuni(value, NUMBER).events?.[0]).toMatchObject({ provider_time_text: '2026-02-30 16:00:00' });
    delete latest.dateTime;
    expect(parseUniuni(value, NUMBER).events?.[0]).not.toHaveProperty('time');
  });

  it.each([0, -1, 1760000000000, 1.2, '1767646800', Number.NaN])('rejects invalid corrected seconds %s', ts => {
    const value = fixture(); value.data.valid_tno[0].spath_list.at(-1).dateTime.ts = ts;
    expect(() => parseUniuni(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('uses the actual latest scan instead of a terminal summary and keeps failed attempts nonterminal', () => {
    const value = fixture(); value.data.valid_tno[0].spath_list.pop();
    expect(parseUniuni(value, NUMBER)).toMatchObject({ status: 'out_for_delivery', current_stage: 'out_for_delivery' });
    value.data.valid_tno[0].spath_list.pop();
    expect(parseUniuni(value, NUMBER)).toMatchObject({ status: 'exception', current_stage: 'failed_attempt' });
    expect(uniuniStatus(217)).toEqual({ status: 'in_transit', stage: 'in_transit' });
    expect(uniuniStatus(230)).toEqual({ status: 'exception', stage: 'returned' });
    expect(uniuniStatus(99999)).toBeUndefined();
  });

  it('keeps unknown and equal-time scans in provider order, deduplicating and bounding output', () => {
    const value = fixture(); const latest = value.data.valid_tno[0].spath_list.at(-1);
    value.data.valid_tno[0].spath_list.push({ ...latest, state: 99999, description_en: 'Awaiting review' });
    const unknown = parseUniuni(value, NUMBER);
    expect(unknown).toMatchObject({ status: 'unknown', last_status_text: 'Awaiting review' });
    expect(unknown.events?.[0]).not.toHaveProperty('stage');
    expect(unknown.events?.[1].description).toBe('Delivered');
    value.data.valid_tno[0].spath_list.push(latest);
    expect(parseUniuni(value, NUMBER).events).toHaveLength(10);
    for (let i = 0; i < 110; i++) value.data.valid_tno[0].spath_list.push({ ...latest, city: `Example City ${i}` });
    expect(parseUniuni(value, NUMBER).events).toHaveLength(100);
  });
});

describe('UniUni direct retrieval', () => {
  it('recognizes only supported formats, exact absence and dated activity while preserving uncertain failures', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });
    for (const number of ['123', 'TRACKING000000001', 'YT0000000000000000', 'UR00000000000000000']) {
      await expect(instance.recognize!(number)).resolves.toEqual({ known: false });
    }
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(fixture())));
    await expect(instance.recognize!(NUMBER)).resolves.toEqual({ known: true, lastActivityAt: '2026-01-05T22:00:00.000Z' });
    const local = fixture();
    for (const scan of local.data.valid_tno[0].spath_list) delete scan.dateTime.ts;
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(local)));
    await expect(instance.recognize!(NUMBER)).resolves.toEqual({ known: true, lastActivityAt: null });
    const negative = { status: 'SUCCESS', data: { invalid_tno: NUMBER, valid_tno: [] } };
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(negative)));
    await expect(instance.recognize!(NUMBER)).resolves.toEqual({ known: false });
    const wrong = fixture(); wrong.data.valid_tno[0].tno = OTHER;
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(wrong)));
    await expect(instance.recognize!(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
    fetcher.mockResolvedValueOnce(new Response('Verification', { status: 403 }));
    await expect(instance.recognize!(NUMBER)).rejects.toMatchObject({ kind: 'challenge' });
  });

  it('uses one fresh anonymous request with the current public website configuration', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(fixture())));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });
    await instance.track({ number: 'uus-00000000 00000001' });
    await instance.track({ number: NUMBER });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [rawUrl, init] of fetcher.mock.calls) {
      const url = new URL(String(rawUrl));
      expect(url.origin + url.pathname).toBe('https://tracking-service-api.uniuni.ca/tracking/trackinguniuninew');
      expect(Object.fromEntries(url.searchParams)).toEqual({ id: NUMBER, key: 'SMq45nJhQuNR3WHsJA6N', source: 'web' });
      expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      expect(new Headers(init?.headers).has('Cookie')).toBe(false);
    }
    expect(normalizeUniuniNumber('4c000000001us')).toBe('4C000000001US');
  });

  it.each([[404, 'transport'], [410, 'transport'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']])('keeps HTTP %s distinct from parcel absence', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Failure', { status: Number(status) }));
    await expect(new UniuniTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects invalid input before I/O and bounds cancellation, elapsed time and response size', async () => {
    const unused = vi.fn<typeof fetch>();
    for (const number of ['123', `${NUMBER}&id=OTHER`, 'U'.repeat(36)]) {
      await expect(new UniuniTracker({ fetcher: unused }).fetch(number)).rejects.toThrow(TypeError);
    }
    await expect(new UniuniTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(unused).not.toHaveBeenCalled();
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise<void>(resolve => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      init?.signal?.throwIfAborted(); return new Response('{}');
    });
    await expect(new UniuniTracker({ fetcher: slow }).fetch(NUMBER, { budgetMs: 20.5 })).rejects.toThrow();
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new UniuniTracker({ fetcher: huge }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Unavailable</html>'));
    await expect(new UniuniTracker({ fetcher: malformed }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
  });
});
