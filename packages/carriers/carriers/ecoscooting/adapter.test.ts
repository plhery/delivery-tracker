import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, EcoscootingTracker } from './adapter';
import { parseEcoscooting } from './parser';
import { ecoscootingStatus } from './status';

const NUMBER = '000000000000000001';
const OTHER = '000000000000000002';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));

describe('Ecoscooting parcel history', () => {
  it('binds the parcel and uses milliseconds while projecting only labelled grams and public scans', () => {
    const result = normalizeCarrierResult(parseEcoscooting(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: '2026-01-04T19:00:00Z', delivered_at: '2026-01-04T19:00:00Z', expected_delivery: null, weight_kg: 4.301 });
    expect(result.events).toHaveLength(4); expect(result.events?.[2]).toMatchObject({ stage: 'failed_attempt' });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|Latitude|Longitude|outOrder|toZip|feature/);
    const metadata = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    const evidence: Record<string, boolean> = { history: !!result.events?.length, weight: result.weight_kg === 4.301, delivered_at: !!result.delivered_at };
    for (const capability of metadata.capabilities) expect(evidence[capability], capability).toBe(true);
  });
  it('rejects wrong parcel and per-scan identities, malformed or excessive history', () => {
    const wrong = fixture(); wrong.packageParam.trackingNumber = OTHER;
    const scan = fixture(); scan.statuses[1].mailNo = OTHER;
    const excessive = fixture(); excessive.statuses = Array(501).fill(excessive.statuses[0]);
    const malformed = fixture(); malformed.statuses[1] = null;
    for (const value of [null, wrong, scan, excessive, malformed]) expect(() => parseEcoscooting(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });
  it('keeps query errors, failures and empty histories inconclusive instead of claiming absence', () => {
    for (const value of [{ success: 'false', errorCode: 'P-011-0201-00-00-502', errorMsg: 'query logisticOrder by mailNo error' }, { success: true }, {}]) {
      expect(() => parseEcoscooting(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    }
    const empty = fixture(); empty.statuses = [];
    expect(() => parseEcoscooting(empty, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
  });
  it.each(['1767553200', 1767553200000, '0', '-1767553200000', '1767553200000.5', 'not a clock'])('rejects wrong epoch units or shape %s', opTimestamp => {
    const value = fixture(); value.statuses[0].opTimestamp = opTimestamp;
    expect(() => parseEcoscooting(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });
  it('retains missing latest epoch as provider text without borrowing the display offset or older delivery', () => {
    const value = fixture(); delete value.statuses[0].opTimestamp;
    const result = parseEcoscooting(value, NUMBER);
    expect(result).toMatchObject({ status: 'delivered', last_update: null });
    expect(result.events?.[0]).toMatchObject({ provider_time_text: '2026-01-04 20:00:00 UTC+1' });
    expect(result.events?.[0]).not.toHaveProperty('time'); expect(result).not.toHaveProperty('delivered_at');
    delete value.statuses[0].datetime; expect(parseEcoscooting(value, NUMBER).events?.[0]).not.toHaveProperty('time');
  });
  it('requires affirmative completion and takes status from the actual newest scan', () => {
    const incomplete = fixture(); incomplete.statuses[0].status = 'error';
    expect(() => parseEcoscooting(incomplete, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    const contradiction = fixture(); contradiction.statuses[0].description = 'Not delivered';
    expect(() => parseEcoscooting(contradiction, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    const value = fixture(); value.statuses.shift(); value.feature = 'Delivered';
    expect(parseEcoscooting(value, NUMBER)).toMatchObject({ status: 'out_for_delivery', current_stage: 'out_for_delivery' });
    value.statuses.shift(); expect(parseEcoscooting(value, NUMBER)).toMatchObject({ status: 'exception', current_stage: 'failed_attempt' });
    expect(parseEcoscooting(value, NUMBER)).not.toHaveProperty('delivered_at');
  });
  it.each([{ weight: '4301', weightUnit: 'kg' }, { weight: '-1', weightUnit: 'g' }, { weight: 4301, weightUnit: 'g' }, { weight: '0', weightUnit: 'g' }, { weight: 'garbage', weightUnit: 'g' }])('omits ambiguous weight %s', dimWeight => {
    const value = fixture(); value.packageParam.dimWeight = dimWeight; expect(parseEcoscooting(value, NUMBER)).not.toHaveProperty('weight_kg');
  });
  it('preserves unknown/equal-time scans and provider order, deduplicating and bounding projection', () => {
    const value = fixture(); value.statuses.unshift({ ...value.statuses[0], actionCode: '__proto__', description: 'Awaiting review' });
    expect(parseEcoscooting(value, NUMBER)).toMatchObject({ status: 'unknown', last_status_text: 'Awaiting review' });
    expect(ecoscootingStatus('__proto__')).toBeUndefined();
    value.statuses.push(value.statuses[0]); expect(parseEcoscooting(value, NUMBER).events).toHaveLength(5);
    for (let i = 0; i < 110; i++) value.statuses.push({ ...value.statuses[0], description: `Public event ${i}` });
    expect(parseEcoscooting(value, NUMBER).events).toHaveLength(100);
  });
});

describe('Ecoscooting direct retrieval', () => {
  it('sends one fresh anonymous form using exact public client configuration and identity', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(fixture())));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });
    await instance.track({ number: NUMBER }); await instance.track({ number: NUMBER }); expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('https://de-link.cainiao.com/gateway/link.do'); expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
      const form = new URLSearchParams(String(init?.body));
      expect(JSON.parse(form.get('logistics_interface')!)).toEqual({ mailNo: NUMBER, locale: 'en_US', role: 'endUser' });
      expect(Object.fromEntries([...form].filter(([key]) => key !== 'logistics_interface'))).toEqual({ msg_type: 'CN_OVERSEA_LOGISTICS_INQUIRY_TRACKING', logistic_provider_id: 'DISTRIBUTOR_30250031', data_digest: 'suibianxie', to_code: 'CNL_EU' });
      const headers = new Headers(init?.headers); expect(headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
      expect(headers.has('Cookie') || headers.has('Authorization')).toBe(false); expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it.each([[404, 'transport'], [410, 'transport'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']])('keeps HTTP %s distinct from parcel absence', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Failure', { status: Number(status) }));
    await expect(new EcoscootingTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('bounds invalid inputs, cancellation, fractional deadlines, body size and malformed JSON', async () => {
    const unused = vi.fn<typeof fetch>(); await expect(new EcoscootingTracker({ fetcher: unused }).fetch('ICP000000000000000001')).rejects.toThrow(TypeError);
    await expect(new EcoscootingTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow(); expect(unused).not.toHaveBeenCalled();
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => { await new Promise<void>(resolve => init?.signal?.addEventListener('abort', () => resolve(), { once: true })); init?.signal?.throwIfAborted(); return new Response('{}'); });
    await expect(new EcoscootingTracker({ fetcher: slow }).fetch(NUMBER, { budgetMs: 20.5 })).rejects.toThrow();
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001))); await expect(new EcoscootingTracker({ fetcher: huge }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Failure</html>')); await expect(new EcoscootingTracker({ fetcher: malformed }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
  });
});
