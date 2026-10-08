import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import * as background from './background';
import { SupabaseServiceClient } from './supabase';
import { GET, HEAD } from '../../app/health/route';
import { GET as live } from '../../app/health/live/route';
import { GET as scrape } from '../../app/api/metrics/route';
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
  expect(request).toHaveBeenCalledWith('/rest/v1/sync_jobs?select=id,check_in&limit=0', { timeoutMs: 2500 });
  request.mockResolvedValue(null);
  expect(await client.probeReadiness()).toBe(false);
});
it('fails readiness immediately during shutdown even with a fresh heartbeat', async () => {
  configure();
  vi.mocked(background.backgroundState).mockReturnValue({ ...background.backgroundState()!, draining: true });
  const probe = vi.spyOn(SupabaseServiceClient.prototype, 'probeReadiness');
  expect(await deliveryServiceReady()).toBe(false);
  expect(probe).not.toHaveBeenCalled();
});
it('exposes process liveness separately from unavailable dependencies', async () => {
  const response = await live(new NextRequest('https://delivery.test/health/live'), { params: Promise.resolve({}) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
it('logs a health check or a metrics scrape only when it fails', async () => {
  const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  configure();
  const probe = vi.spyOn(SupabaseServiceClient.prototype, 'probeReadiness').mockResolvedValue(true);
  vi.stubEnv('METRICS_TOKEN', 'synthetic-metrics-token');
  const authorized = { authorization: 'Bearer synthetic-metrics-token' };
  expect((await GET(new NextRequest('https://delivery.test/health'), { params: Promise.resolve({}) })).status).toBe(200);
  expect((await live(new NextRequest('https://delivery.test/health/live'), { params: Promise.resolve({}) })).status).toBe(200);
  expect((await scrape(new NextRequest('https://delivery.test/api/metrics', { headers: authorized }), { params: Promise.resolve({}) })).status).toBe(200);
  const requests = () => [...output.mock.calls, ...errors.mock.calls].map(([line]) => JSON.parse(String(line)))
    .filter((line) => line.event === 'http_request');
  expect(requests()).toEqual([]);
  probe.mockResolvedValue(false);
  expect((await GET(new NextRequest('https://delivery.test/health'), { params: Promise.resolve({}) })).status).toBe(503);
  expect((await scrape(new NextRequest('https://delivery.test/api/metrics'), { params: Promise.resolve({}) })).status).toBe(401);
  expect(requests()).toHaveLength(2);
  expect(requests()).toEqual(expect.arrayContaining([
    expect.objectContaining({ route: '/health', status: 503 }), expect.objectContaining({ route: '/api/metrics', status: 401 }),
  ]));
});
