import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '../../app/api/carriers/detect/route';
import { detectCarrierMatch } from '../lib/carriers';
import { SupabaseAuthenticator } from './auth';

// The route asks carriers through the adapter registry; no test reaches a carrier.
const recognize = vi.hoisted(() => vi.fn());
vi.mock('./adapterRegistry', () => ({
  createAdapterRegistry: () => ({ for: (carrier: string) => ({ recognize: (number: string) => recognize(carrier, number) }) }),
}));

const request = (trackingNumber: unknown, authenticated = true) => POST(new NextRequest('https://delivery.example/api/carriers/detect', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { Authorization: 'Bearer detection-test' } : {}) },
  body: JSON.stringify({ trackingNumber }),
}), { params: Promise.resolve({}) });
const knows = (...carriers: string[]) => async (carrier: string) => ({ known: carriers.includes(carrier) });
const asked = () => recognize.mock.calls.map(([carrier]) => carrier);

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-key');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  recognize.mockReset().mockImplementation(knows());
  vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({
    id: '10000000-0000-0000-0000-000000000002', email: null, authenticatedAt: null, sessionId: null,
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

// Answers are cached per number for a few minutes, so every test uses its own numbers.

it('returns the one carrier that knows an ambiguous number', async () => {
  recognize.mockImplementation(knows('dpd'));
  const response = await request('0608 0000 0000 02');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ trackingNumber: '06080000000002', carrier: 'dpd' });
  // Every carrier that can answer is asked at once, number evidence first.
  expect(asked()).toEqual(['dpd', 'ciblex']);
});

it('offers a carrier that needs a postcode so the sheet can ask for it', async () => {
  // Both GLS networks answer from one overview: the more common one is returned.
  recognize.mockImplementation(knows('gls-ch', 'gls-de'));
  expect(await (await request('12345678901')).json()).toEqual({ trackingNumber: '12345678901', carrier: 'gls-ch' });
});

it('lets the user choose between unrelated carriers that both know the number', async () => {
  recognize.mockImplementation(knows('dpd', 'hermes-de'));
  expect(await (await request('12345678901231')).json()).toEqual({
    trackingNumber: '12345678901231', carrier: 'unknown', recognized: ['dpd', 'hermes-de'],
  });
});

it('ignores an answer about an old parcel that reused the number', async () => {
  recognize.mockImplementation(async (carrier: string) => ({ known: true, lastActivityAt: carrier === 'dpd' ? '2026-01-01T00:00:00Z' : null }));
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-10T12:00:00Z') });
  try {
    expect(await (await request('06080000000019')).json()).toEqual({ trackingNumber: '06080000000019', carrier: 'ciblex' });
  } finally { vi.useRealTimers(); }
});

it('answers unknown when no carrier knows the number or one fails, and asks again after a failure', async () => {
  recognize.mockImplementation(async (carrier: string) => {
    if (carrier === 'dpd') throw new Error('guest API unreachable');
    return { known: false };
  });
  expect(await (await request('06080000000027')).json()).toEqual({ trackingNumber: '06080000000027', carrier: 'unknown' });
  recognize.mockClear();
  // A carrier that could not answer is asked again on the next focus-out.
  await request('06080000000027');
  expect(asked()).toEqual(['dpd', 'ciblex']);
  // A complete answer is reused.
  recognize.mockReset().mockImplementation(knows());
  await request('06080000000035');
  await request('06080000000035');
  expect(asked()).toEqual(['dpd', 'ciblex']);
});

it('does not ask carriers for selected shapes, formats without candidates or unauthenticated callers', async () => {
  expect((await request('06080000000043', false)).status).toBe(401);
  expect((await request('bad input!')).status).toBe(400);
  expect(await (await request('1Z999AA10123456784')).json()).toMatchObject({ carrier: 'ups' });
  expect(await (await request('123456789')).json()).toMatchObject({ carrier: 'unknown' });
  expect(recognize).not.toHaveBeenCalled();
});

it('counts served detections by confidence, including a recognized carrier', async () => {
  const { metricsText } = await import('./metrics');
  const served = async (result: string) => Number(new RegExp(`carrier_detection_total\\{result="${result}"\\} (\\d+)`).exec(await metricsText())?.[1] ?? 0);
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
