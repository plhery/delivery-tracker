import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '../../app/api/carriers/detect/route';
import { SupabaseAuthenticator } from './auth';
import { GLSGermanyTracker } from './glsGermany';

const request = (trackingNumber: unknown, authenticated = true) => POST(new NextRequest('https://delivery.example/api/carriers/detect', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { Authorization: 'Bearer detection-test' } : {}) },
  body: JSON.stringify({ trackingNumber }),
}), { params: Promise.resolve({}) });

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-key');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({
    id: '10000000-0000-0000-0000-000000000002', email: null, authenticatedAt: null, sessionId: null,
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('only detects ambiguous numeric GLS numbers after a verified lookup', async () => {
  const lookup = vi.spyOn(GLSGermanyTracker.prototype, 'recognizes').mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const response = await request('123 456 789 018');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ trackingNumber: '123456789018', carrier: 'gls-de' });
  expect(lookup).toHaveBeenCalledWith('123456789018');
  expect(await (await request('123456789018')).json()).toEqual({ trackingNumber: '123456789018', carrier: 'unknown' });
});

it('does not query GLS for other formats or unauthenticated callers', async () => {
  const lookup = vi.spyOn(GLSGermanyTracker.prototype, 'recognizes');
  expect((await request('123456789018', false)).status).toBe(401);
  expect((await request('bad input!')).status).toBe(400);
  expect(await (await request('1Z999AA10123456784')).json()).toMatchObject({ carrier: 'ups' });
  expect(await (await request('12345678901234')).json()).toMatchObject({ carrier: 'unknown' });
  expect(lookup).not.toHaveBeenCalled();
});

it('keeps provider failures distinct from an unrecognized number', async () => {
  vi.spyOn(GLSGermanyTracker.prototype, 'recognizes').mockRejectedValue(new RangeError('different shipment'));
  expect((await request('123456789018')).status).toBe(502);
});
