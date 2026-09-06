import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../app/api/sync/jobs/route';
import { SupabaseAuthenticator } from './auth';
import { SupabaseServiceClient } from './supabase';

const owner = '10000000-0000-0000-0000-000000000001';
const jobId = 'aaaaaaaa-0000-0000-0000-000000000001';
const secondId = 'bbbbbbbb-0000-0000-0000-000000000002';

function get(query: string, authenticated = true) {
  return GET(new NextRequest(`https://delivery.example/api/sync/jobs${query}`, {
    headers: authenticated ? { Authorization: 'Bearer test-session' } : {},
  }), { params: Promise.resolve({}) });
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({
    id: owner, email: null, authenticatedAt: null, sessionId: null,
  });
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('batch sync status route', () => {
  it('deduplicates ids and returns only the public status projection', async () => {
    const read = vi.spyOn(SupabaseServiceClient.prototype, 'getSyncJobs').mockResolvedValue([
      { id: jobId, state: 'running', user_id: owner, locked_by: 'private-worker' },
      { id: secondId, state: 'succeeded' },
    ]);
    const response = await get(`?ids=${jobId.toUpperCase()},${secondId},${jobId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(read).toHaveBeenCalledExactlyOnceWith([jobId, secondId], owner);
    const body = await response.json();
    expect(body.jobs).toHaveLength(2);
    expect(body.jobs[0]).toMatchObject({ id: jobId, status: 'running' });
    expect(body.jobs[0]).not.toHaveProperty('user_id');
    expect(body.jobs[0]).not.toHaveProperty('locked_by');
  });

  it.each(['', '?ids=', '?ids=not-a-uuid', `?ids=${jobId}&ids=${secondId}`, `?ids=${Array(21).fill(jobId).join(',')}`])(
    'rejects an invalid or oversized batch: %s', async (query) => {
      const read = vi.spyOn(SupabaseServiceClient.prototype, 'getSyncJobs');
      expect((await get(query)).status).toBe(400);
      expect(read).not.toHaveBeenCalled();
    },
  );

  it('does not disclose unowned or absent jobs in a mixed batch', async () => {
    vi.spyOn(SupabaseServiceClient.prototype, 'getSyncJobs').mockResolvedValue([{ id: jobId }]);
    const response = await get(`?ids=${jobId},${secondId}`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Sync job not found' });
  });

  it('requires authentication before reading jobs', async () => {
    const read = vi.spyOn(SupabaseServiceClient.prototype, 'getSyncJobs');
    expect((await get(`?ids=${jobId}`, false)).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });
});
