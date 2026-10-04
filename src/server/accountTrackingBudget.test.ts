import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as add } from '../../app/api/packages/route';
import { POST as detect } from '../../app/api/carriers/detect/route';
import { claimAccountTracking } from './accountTrackingBudget';
import { SupabaseAuthenticator } from './auth';
import { SupabaseServiceClient, SupabaseUserClient } from './supabase';
import * as amazon from './amazonShippingEligibility';

const userId = 'e8000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({ id: userId, email: null, authenticatedAt: null, sessionId: null });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('claims a configurable daily budget and returns Retry-After on exhaustion', async () => {
  const claim = vi.spyOn(SupabaseServiceClient.prototype, 'claimAccountTracking').mockResolvedValue(true);
  const client = new SupabaseServiceClient('https://database.example', 'test-key');
  await claimAccountTracking(client, userId, 'lookup');
  expect(claim).toHaveBeenCalledWith(userId, 'lookup', 60);
  vi.stubEnv('ACCOUNT_DETECTIONS_PER_DAY', '12');
  claim.mockResolvedValue(false);
  await expect(claimAccountTracking(client, userId, 'detection')).rejects.toMatchObject({ status: 429, headers: { 'Retry-After': expect.any(String) } });
  expect(claim).toHaveBeenLastCalledWith(userId, 'detection', 12);
});

it('refuses additions and provider detection before spending provider resources', async () => {
  vi.spyOn(SupabaseServiceClient.prototype, 'claimAccountTracking').mockResolvedValue(false);
  const verify = vi.spyOn(amazon, 'verifyAmazonShippingAddition');
  const check = vi.spyOn(amazon, 'checkAmazonShipping');
  const create = vi.spyOn(SupabaseUserClient.prototype, 'createPackage');
  for (const [handler, path] of [[add, 'packages'], [detect, 'carriers/detect']] as const) {
    const result = await handler(new NextRequest(`https://peek.example/api/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-token' },
      body: JSON.stringify({ trackingNumber: 'FR0000000099', carrier: 'amazon-shipping' }),
    }), { params: Promise.resolve({}) });
    expect(result.status).toBe(429);
  }
  expect(verify).not.toHaveBeenCalled();
  expect(check).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
