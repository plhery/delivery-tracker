import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import * as background from './background';
import { SupabaseServiceClient } from './supabase';
import { GET, HEAD } from '../../app/health/route';
import { GET as live } from '../../app/health/live/route';
import { deliveryServiceReady } from './readiness';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function configure(age = 0) {
  vi.stubEnv('SUPABASE_URL', 'https://database.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test');
  vi.spyOn(background, 'backgroundState').mockReturnValue({ workerHeartbeat: Date.now() / 1000 - age, lastScheduledSync: null, nextScheduledSync: null, lastSummary: null, lastError: null, lastAutoArchived: 0 });
}
it('returns readiness only when the worker and database are available', async () => {
  configure();
  const probe = vi.spyOn(SupabaseServiceClient.prototype, 'probeReadiness').mockResolvedValue(true);
  expect(await deliveryServiceReady()).toBe(true);
  probe.mockRejectedValue(new Error('private connection details'));
  const response = await GET(new NextRequest('https://delivery.test/health'), { params: Promise.resolve({}) });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false });
  const head = await HEAD(new NextRequest('https://delivery.test/health'), { params: Promise.resolve({}) });
  expect(head.status).toBe(503);
  expect(await head.text()).toBe('');
});
it('rejects a stalled worker even when configuration is valid', async () => {
  configure(121);
  const probe = vi.spyOn(SupabaseServiceClient.prototype, 'probeReadiness');
  expect(await deliveryServiceReady()).toBe(false);
  expect(probe).not.toHaveBeenCalled();
});
it('bounds the database probe and checks that PostgREST returned a row set', async () => {
  const client = new SupabaseServiceClient('https://database.test', 'test');
  const request = vi.spyOn(client, 'request').mockResolvedValue([]);
  expect(await client.probeReadiness()).toBe(true);
  expect(request).toHaveBeenCalledWith('/rest/v1/sync_jobs?select=id&limit=0', { timeoutMs: 2500 });
  request.mockResolvedValue(null);
  expect(await client.probeReadiness()).toBe(false);
});
it('exposes process liveness separately from unavailable dependencies', async () => {
  const response = await live(new NextRequest('https://delivery.test/health/live'), { params: Promise.resolve({}) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
