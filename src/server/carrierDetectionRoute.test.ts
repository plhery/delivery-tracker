import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '../../app/api/carriers/detect/route';
import { POST as detectWithoutAccount } from '../../app/api/public/detect/route';
import { detectCarrierMatch, recognitionAskedCarriers } from '../lib/carriers';
import { preflightTracking } from './trackingPreflight';
import * as amazon from './amazonShippingEligibility';
import { SupabaseAuthenticator } from './auth';
import * as metrics from './metrics';
import { SupabaseServiceClient } from './supabase';

vi.mock('./trackingPreflight', () => ({ preflightTracking: vi.fn().mockResolvedValue(undefined) }));

// The route asks carriers through the adapter registry; no test reaches a carrier.
const recognize = vi.hoisted(() => vi.fn());
vi.mock('./adapterRegistry', () => ({
  createAdapterRegistry: () => ({ for: (carrier: string) => ({ recognize: (number: string) => recognize(carrier, number) }) }),
}));

const request = (trackingNumber: unknown, authenticated = true) => POST(new NextRequest('https://delivery.example/api/carriers/detect', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { Authorization: 'Bearer detection-test' } : {}) },
  body: JSON.stringify({ trackingNumber }),
}), { params: Promise.resolve({}) });
const withoutAccount = (trackingNumber: unknown, ip = '198.51.100.30') => detectWithoutAccount(new NextRequest('https://delivery.example/api/public/detect', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ trackingNumber }),
}), { params: Promise.resolve({}) });
const knows = (...carriers: string[]) => async (carrier: string) => ({ known: carriers.includes(carrier) });
const asked = () => recognize.mock.calls.map(([carrier]) => carrier);

beforeEach(() => {
  vi.mocked(preflightTracking).mockReset().mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof preflightTracking>>);
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
  vi.spyOn(SupabaseServiceClient.prototype, 'claimAccountTracking').mockResolvedValue(true);
  vi.spyOn(SupabaseServiceClient.prototype, 'recordTrackingSupportObservation').mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  recognize.mockReset().mockImplementation(knows());
  vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({
    id: '10000000-0000-0000-0000-000000000002', email: null, authenticatedAt: null, sessionId: null,
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

// Answers are cached per number for a few minutes, so every test uses its own numbers.

it('returns the one carrier that knows an ambiguous number', async () => {
  recognize.mockImplementation(knows('dpd'));
  const response = await request('0608 0000 0000 02');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ trackingNumber: '06080000000002', carrier: 'dpd', asked: ['dpd', 'seur', 'brt', 'relais-colis', 'ciblex'] });
  // Every carrier that can answer is asked at once, number evidence first.
  expect(asked()).toEqual(['dpd', 'seur', 'brt', 'relais-colis', 'ciblex']);
});

it('offers a carrier that needs a postcode so the sheet can ask for it', async () => {
  // Both GLS networks answer from one overview: the more common one is returned.
  recognize.mockImplementation(knows('gls-ch', 'gls-de'));
  expect(await (await request('12345678901')).json()).toMatchObject({ trackingNumber: '12345678901', carrier: 'gls-ch' });
});

it.each([
  ['RR123456785FI', 'posti', ['posti', 'chronopost']],
  ['XR123456785TS', 'chronopost', ['chronopost']],
  ['33870000000000001', 'dhl-ecommerce', ['dhl-ecommerce']],
])('confirms a direct carrier for %s instead of returning the generic shape', async (number, carrier, candidates) => {
  recognize.mockImplementation(knows(carrier as string));
  expect(await (await request(number)).json()).toEqual({ trackingNumber: number, carrier, asked: candidates });
  expect(asked()).toEqual(candidates);
});

it('keeps a generic postal number unconfirmed when no direct carrier knows it', async () => {
  expect(await (await request('CE123456785FI')).json()).toEqual({
    trackingNumber: 'CE123456785FI', carrier: 'unknown', asked: ['posti', 'chronopost'],
  });
});

it('retains an unresolved signed-in submission without creating a parcel', async () => {
  const response = await request('0000 0000 41');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ trackingNumber: '0000000041', carrier: 'unknown' });
  expect(SupabaseServiceClient.prototype.recordTrackingSupportObservation).toHaveBeenCalledExactlyOnceWith(
    '0000000041', expect.objectContaining({ reasons: ['ambiguous_shape', 'recognition_unknown'] }),
    { outcome: 'detection_unknown' }, expect.any(Date), expect.stringMatching(/^detection:/),
  );
});

it('retains unresolved public submissions even when the detection answer is cached', async () => {
  const claim = vi.spyOn(SupabaseServiceClient.prototype, 'claimPublicAllowance').mockResolvedValue({ allowed: true, scope: null, overallUsed: 1 });
  const retain = vi.mocked(SupabaseServiceClient.prototype.recordTrackingSupportObservation);
  for (let index = 0; index < 2; index += 1) {
    const response = await withoutAccount('0000000042', '198.51.100.70');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ carrier: 'unknown' });
  }
  expect(claim).toHaveBeenCalledOnce();
  expect(retain).toHaveBeenCalledTimes(2);
  expect(retain.mock.calls[0][4]).not.toBe(retain.mock.calls[1][4]);
});

it('does not retain confirmed, invalid or refused detections', async () => {
  const retain = vi.mocked(SupabaseServiceClient.prototype.recordTrackingSupportObservation);
  expect((await request('1Z0000000012345678')).status).toBe(200);
  expect((await request('invalid!')).status).toBe(400);
  expect((await request('0000000043', false)).status).toBe(401);
  vi.spyOn(SupabaseServiceClient.prototype, 'claimPublicAllowance').mockResolvedValue({ allowed: false, scope: 'bucket', overallUsed: 1 });
  expect((await withoutAccount('0000000044', '198.51.100.71')).status).toBe(429);
  expect(retain).not.toHaveBeenCalled();
});

it('returns the unknown answer when retaining its number fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(SupabaseServiceClient.prototype.recordTrackingSupportObservation).mockRejectedValue(new Error('database unavailable'));
  const response = await request('0000000045');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ carrier: 'unknown' });
});

it('lets the user choose between unrelated carriers that both know the number', async () => {
  recognize.mockImplementation(knows('dpd', 'hermes-de'));
  expect(await (await request('12345678901231')).json()).toEqual({
    trackingNumber: '12345678901231', carrier: 'unknown', recognized: ['dpd', 'hermes-de'], asked: asked(),
  });
});

it('ignores an answer about an old parcel that reused the number', async () => {
  recognize.mockImplementation(async (carrier: string) => ({ known: carrier === 'dpd' || carrier === 'ciblex',
    lastActivityAt: carrier === 'dpd' ? '2026-01-01T00:00:00Z' : null }));
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-10T12:00:00Z') });
  try {
    expect(await (await request('06080000000019')).json()).toEqual({ trackingNumber: '06080000000019', carrier: 'ciblex', asked: ['dpd', 'seur', 'brt', 'relais-colis', 'ciblex'] });
  } finally { vi.useRealTimers(); }
});

it('answers unknown when no carrier knows the number or one fails, and asks again after a failure', async () => {
  recognize.mockImplementation(async (carrier: string) => {
    if (carrier === 'dpd') throw new Error('guest API unreachable');
    return { known: false };
  });
  // The sheet tells a carrier that could not answer from one that said no.
  expect(await (await request('06080000000027')).json()).toEqual({
    trackingNumber: '06080000000027', carrier: 'unknown', asked: ['dpd', 'seur', 'brt', 'relais-colis', 'ciblex'], unanswered: ['dpd'],
  });
  recognize.mockClear();
  // A carrier that could not answer is asked again on the next focus-out.
  await request('06080000000027');
  expect(asked()).toEqual(['dpd', 'seur', 'brt', 'relais-colis', 'ciblex']);
  // A complete answer is reused.
  recognize.mockReset().mockImplementation(knows());
  expect(await (await request('06080000000035')).json()).toEqual({ trackingNumber: '06080000000035', carrier: 'unknown', asked: ['dpd', 'seur', 'brt', 'relais-colis', 'ciblex'] });
  await request('06080000000035');
  expect(asked()).toEqual(['dpd', 'seur', 'brt', 'relais-colis', 'ciblex']);
});

it('does not ask carriers for selected shapes, formats without candidates or unauthenticated callers', async () => {
  expect((await request('06080000000043', false)).status).toBe(401);
  expect((await request('bad input!')).status).toBe(400);
  expect(await (await request('1Z999AA10123456784')).json()).toMatchObject({ carrier: 'ups' });
  expect(await (await request('ZZUNMATCHED0001')).json()).toMatchObject({ carrier: 'unknown' });
  expect(recognize).not.toHaveBeenCalled();
});

it.each([
  ['12345678901242', 'brt', ['dpd', 'seur', 'brt', 'relais-colis', 'ciblex']],
  ['12345678901243', 'seur', ['dpd', 'seur', 'brt', 'relais-colis', 'ciblex']],
  ['9900002', 'seur', ['seur']],
  ['1000000000000001', 'tnt', ['tnt', 'correos-express', 'dhl-ecommerce', 'canada-post']],
  ['1000000000000002', 'correos-express', ['tnt', 'correos-express', 'dhl-ecommerce', 'canada-post']],
  ['98765432109876543211', 'nz-post', ['nz-post']],
  ['98765432109876543210', 'poczta-polska', ['poczta-polska', 'nz-post']],
  ['1000000000000000000001', 'austrian-post', ['austrian-post']],
])('recognizes newly supported %s shapes only through carrier answers', async (number, carrier, candidates) => {
  recognize.mockImplementation(knows(carrier as string));
  expect(await (await request(number)).json()).toEqual({ trackingNumber: number, carrier, asked: candidates });
  expect(asked()).toEqual(candidates);
});

it('keeps unrelated BRT and SEUR answers ambiguous', async () => {
  recognize.mockImplementation(knows('brt', 'seur'));
  expect(await (await request('06080000000084')).json()).toEqual({ trackingNumber: '06080000000084', carrier: 'unknown',
    recognized: ['seur', 'brt'], asked: ['dpd', 'seur', 'brt', 'relais-colis', 'ciblex'] });
});

it.each(['06080000000076', '12345678901234', '12345678909', '1234567890', '12345678'])('asks the carriers the Add sheets name for %s', async (number) => {
  const response = await (await request(number)).json();
  expect(asked()).toEqual(recognitionAskedCarriers(number));
  expect(response.asked ?? []).toEqual(recognitionAskedCarriers(number));
});

it('counts served detections by confidence, including a recognized carrier', async () => {
  const { metricsText } = await import('./metrics');
  // A new series reads 0 until a scrape has shown it; the second scrape carries its count.
  const served = async (result: string) => { await metricsText(); return Number(new RegExp(`carrier_detection_total\\{result="${result}"\\} (\\d+)`).exec(await metricsText())?.[1] ?? 0); };
  const unverified = detectCarrierMatch('06080000000050').confidence;
  expect(unverified).not.toBe('high');
  const [high, other] = [await served('high'), await served(unverified)];
  await request('1Z999AA10123456784');
  recognize.mockImplementation(knows('dpd'));
  await request('06080000000050');
  recognize.mockImplementation(knows());
  await request('06080000000068');
  expect(await served('high')).toBe(high + 2);
  expect(await served(unverified)).toBe(other + 1);
});

it('answers the front door without a session, the same way, within a limit per client', async () => {
  const authenticate = vi.mocked(SupabaseAuthenticator.prototype.validate);
  vi.spyOn(SupabaseServiceClient.prototype, 'claimPublicAllowance').mockResolvedValue({ allowed: true, scope: null, overallUsed: 1 });
  const counted = vi.spyOn(metrics, 'recordPublicDetection');
  recognize.mockImplementation(knows('dpd'));
  const response = await withoutAccount('0608 0000 0000 92');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ trackingNumber: '06080000000092', carrier: 'dpd', asked: ['dpd', 'seur', 'brt', 'relais-colis', 'ciblex'] });
  // One implementation serves both routes: in this process they even share its answers.
  recognize.mockClear();
  expect(await (await request('06080000000092')).json()).toMatchObject({ carrier: 'dpd' });
  expect(recognize).not.toHaveBeenCalled();
  expect((await withoutAccount('bad input!')).status).toBe(400);
  expect(authenticate).toHaveBeenCalledOnce();

  for (let index = 2; index < 20; index += 1) expect((await withoutAccount('1Z999AA10123456784')).status).toBe(200);
  const refused = await withoutAccount('1Z999AA10123456784');
  expect(refused.status).toBe(429);
  expect(refused.headers.get('retry-after')).toBeTruthy();
  expect(counted).toHaveBeenLastCalledWith('limited_burst');
  expect((await withoutAccount('1Z999AA10123456784', '198.51.100.31')).status).toBe(200);
});

it('counts a number that carriers are asked about against the day\'s allowances without an account', async () => {
  const claim = vi.spyOn(SupabaseServiceClient.prototype, 'claimPublicAllowance').mockResolvedValue({ allowed: true, scope: null, overallUsed: 1 });
  const counted = vi.spyOn(metrics, 'recordPublicDetection');
  const from = (number: string) => withoutAccount(number, '198.51.100.40');

  // A shape that names its carrier asks nobody and counts nothing.
  expect(await (await from('1Z999AA10123456784')).json()).toMatchObject({ carrier: 'ups' });
  expect(claim).not.toHaveBeenCalled();

  recognize.mockImplementation(knows('dpd'));
  expect(await (await from('12345678901251')).json()).toMatchObject({ carrier: 'dpd' });
  expect(claim).toHaveBeenCalledExactlyOnceWith({
    bucket: expect.stringMatching(/^detection:[0-9a-f]{64}$/), limit: 60, overall: { bucket: 'detection', limit: 10_000 },
  });
  expect(counted).toHaveBeenCalledExactlyOnceWith('asked');
  // The answer kept from a moment ago is not counted again.
  expect(await (await from('12345678901251')).json()).toMatchObject({ carrier: 'dpd' });
  expect(claim).toHaveBeenCalledOnce();

  // Amazon is a carrier to ask, too.
  const amazonCheck = vi.spyOn(amazon, 'checkAmazonShipping').mockResolvedValue('available');
  expect(await (await from('TBA000000000019')).json()).toMatchObject({ carrier: 'amazon-shipping' });
  expect(claim).toHaveBeenCalledTimes(2);

  // The signed-in sheet has its account's limits instead.
  await request('12345678901252');
  expect(claim).toHaveBeenCalledTimes(2);
  amazonCheck.mockClear();
  recognize.mockClear();

  // Past an allowance the carriers are not asked, until the next UTC midnight.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-02T21:30:00Z') });
  claim.mockResolvedValue({ allowed: false, scope: 'bucket', overallUsed: 1 });
  const refused = await from('12345678901253');
  expect(refused.status).toBe(429);
  expect(refused.headers.get('retry-after')).toBe(String(2.5 * 3_600));
  expect(counted).toHaveBeenLastCalledWith('limited_daily');
  claim.mockResolvedValue({ allowed: false, scope: 'global', overallUsed: 0 });
  expect((await from('TBA000000000027')).status).toBe(429);
  expect(counted).toHaveBeenLastCalledWith('limited_global');
  expect(recognize).not.toHaveBeenCalled();
  expect(amazonCheck).not.toHaveBeenCalled();
  // A shape that names its carrier is still answered.
  expect((await from('1Z999AA10123456784')).status).toBe(200);
});

it('takes the detection allowances from the environment, and fails closed when they cannot be counted', async () => {
  vi.stubEnv('PUBLIC_DETECTIONS_PER_DAY', '5');
  vi.stubEnv('PUBLIC_DETECTIONS_GLOBAL_PER_DAY', '0');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const claim = vi.spyOn(SupabaseServiceClient.prototype, 'claimPublicAllowance').mockRejectedValue(new Error('database down'));
  expect((await withoutAccount('12345678901254', '198.51.100.41')).status).toBe(500);
  expect(claim).toHaveBeenCalledExactlyOnceWith({ bucket: expect.any(String), limit: 5, overall: { bucket: 'detection', limit: 0 } });
  expect(recognize).not.toHaveBeenCalled();
});

it('uses universal preflight for a number with no direct candidates and reports history without forcing carrier identity', async () => {
  vi.mocked(preflightTracking).mockResolvedValue({ trackingFound: true, providers: [{ provider: 'Ship24', outcome: 'history' }] });
  const response = await request('TESTPREFLIGHT0001');
  expect(await response.json()).toEqual({ trackingNumber: 'TESTPREFLIGHT0001', carrier: 'unknown', trackingFound: true, providers: [{ provider: 'Ship24', outcome: 'history' }] });
  expect(preflightTracking).toHaveBeenCalledWith('TESTPREFLIGHT0001', expect.any(SupabaseServiceClient), expect.any(AbortSignal));
  expect(recognize).not.toHaveBeenCalled();
});

it.each([request, (number: string) => withoutAccount(number, '198.51.100.89')])('returns the carrier named by universal preflight when direct recognition fails', async (detect) => {
  vi.spyOn(SupabaseServiceClient.prototype, 'claimPublicAllowance').mockResolvedValue({ allowed: true, scope: null, overallUsed: 1 });
  recognize.mockRejectedValue(new Error('carrier blocked'));
  vi.mocked(preflightTracking).mockResolvedValue({ carrier: 'dhl-express', trackingFound: true,
    providers: [{ provider: 'Ship24', outcome: 'history' }] });
  expect(await (await detect('1234500223')).json()).toMatchObject({ carrier: 'dhl-express', trackingFound: true });
});
