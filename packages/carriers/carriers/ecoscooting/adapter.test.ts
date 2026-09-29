import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, EcoscootingTracker } from './adapter';
import { normalizeEcoscootingNumber, parseEcoscooting } from './parser';
import { ecoscootingStatus } from './status';
import metadata from './carrier.json';
import statuses from './statuses.json';

const NUMBER = '000000000000000001';
const OTHER = '000000000000000002';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const PORTUGAL_NUMBER = 'CNPRT00000000000000000001';
const SPAIN_NUMBER = 'CNESP00000000000000000001';
const portugalFixture = () => JSON.parse(readFileSync(new URL('./fixtures/delivered-portugal.json', import.meta.url), 'utf8'));
const referenceFixture = (number: string) => { const value = portugalFixture(); value.packageParam.trackingNumber = number; return value; };

describe('Ecoscooting parcel history', () => {
  it.each([PORTUGAL_NUMBER, SPAIN_NUMBER])('binds %s history and its separate affirmative completion schema', number => {
    const result = normalizeCarrierResult(parseEcoscooting(referenceFixture(number), number));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_status_text: 'Your shipment has been delivered successfully',
      last_update: '2026-01-10T12:00:00Z', delivered_at: '2026-01-10T12:00:00Z', weight_kg: 4.301 });
    expect(result.events?.map(event => event.stage)).toEqual(['delivered', 'out_for_delivery', 'accepted', 'in_transit', 'in_transit', 'registered']);
    // Sorting scans carry another local offset than last-mile scans; epochs keep them in order.
    expect(result.events?.slice(2, 4).map(event => event.time)).toEqual(['2026-01-08T12:00:00Z', '2026-01-07T12:00:00Z']);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|imgUrl|opCode|Latitude|Longitude|outOrder|toZip|feature|cainiaoId|solution/);
    for (const entry of statuses.entries) expect(ecoscootingStatus(entry.code)?.stage, entry.code).toBe(entry.stage);
    const wrong = referenceFixture(number.replace(/1$/, '2'));
    expect(() => parseEcoscooting(wrong, number)).toThrow(expect.objectContaining({ kind: 'schema' }));
    const wrongScan = referenceFixture(number); wrongScan.statuses[1].mailNo = NUMBER;
    expect(() => parseEcoscooting(wrongScan, number)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });
  it('does not borrow missing completion flags from the CN reference schema for numeric parcels', () => {
    const value = portugalFixture(); value.packageParam.trackingNumber = NUMBER;
    expect(() => parseEcoscooting(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    const numeric = fixture(); delete numeric.statuses[0].status; delete numeric.statuses[0].statusGroup;
    expect(() => parseEcoscooting(numeric, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
  });
  it.each(['status', 'statusGroup', 'description', 'statusName'])('rejects contradictory CN reference completion %s', field => {
    const value = portugalFixture(); value.statuses[0][field] = field === 'description' ? 'Not delivered' : 'Different';
    expect(() => parseEcoscooting(value, PORTUGAL_NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
  });
  it('keeps CN reference movement active and retains missing epochs without inferring display instants', () => {
    const value = portugalFixture(); delete value.statuses[0].opTimestamp;
    const result = parseEcoscooting(value, PORTUGAL_NUMBER);
    expect(result).toMatchObject({ status: 'delivered', last_update: null });
    expect(result.events?.[0]).toMatchObject({ provider_time_text: '2026-01-10 12:00:00 UTC+0' });
    expect(result).not.toHaveProperty('delivered_at');
    value.statuses.shift();
    expect(parseEcoscooting(value, PORTUGAL_NUMBER)).toMatchObject({ status: 'out_for_delivery', current_stage: 'out_for_delivery' });
    value.statuses[0].actionCode = 'UNKNOWN';
    expect(parseEcoscooting(value, PORTUGAL_NUMBER)).toMatchObject({ status: 'unknown' });
  });
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
  it('preserves full CN references in each fresh factory request and aligns detection boundaries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
      new Response(JSON.stringify(referenceFixture(JSON.parse(new URLSearchParams(String(init?.body)).get('logistics_interface')!).mailNo))));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });
    for (const [input, number] of [[PORTUGAL_NUMBER, PORTUGAL_NUMBER], ['cnprt-00000000000000000001', PORTUGAL_NUMBER],
      [SPAIN_NUMBER, SPAIN_NUMBER], ['cnesp 00000000000000000001', SPAIN_NUMBER]]) {
      await expect(instance.track({ number: input })).resolves.toMatchObject({ status: 'delivered' });
      const form = new URLSearchParams(String(fetcher.mock.lastCall?.[1]?.body));
      expect(JSON.parse(form.get('logistics_interface')!).mailNo).toBe(number);
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
    const patterns = metadata.detection.map(rule => new RegExp(rule.pattern));
    for (const number of [NUMBER, PORTUGAL_NUMBER, SPAIN_NUMBER]) {
      expect(patterns.some(pattern => pattern.test(number)), number).toBe(true);
      expect(normalizeEcoscootingNumber(number)).toBe(number);
    }
    // Cainiao issues other CN families elsewhere (CNUSUP in the US, CNFR…HD in
    // France); only the Spanish and Portuguese references belong to Ecoscooting.
    for (const number of ['CNPRT0000000000000000001', 'CNPRT000000000000000000001', 'CNESP0000000000000000001', 'CNFRA00000000000000000001',
      'CNUSUP00000000001', 'CNPRT00000000000000000001&x=1']) {
      expect(patterns.some(pattern => pattern.test(number)), number).toBe(false);
      await expect(instance.track({ number })).rejects.toThrow(TypeError);
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
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
