import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET } from '../../app/api/packages/route';
import { SupabaseAuthenticator } from './auth';
import * as observability from './observability';
import { SupabaseError, SupabaseUserClient } from './supabase';

// Synthetic identifiers only.
const userId = '55000000-0000-4000-a000-000000000001';
const parcel = { id: '55000000-0000-4000-a000-000000000002', tracking_number: 'TEST1234', events: [] };

function list(query = '') {
  return GET(new NextRequest(`https://delivery.example/api/packages${query}`, {
    headers: { Authorization: 'Bearer list-test' },
  }), { params: Promise.resolve({}) });
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({ id: userId, email: null, authenticatedAt: null, sessionId: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('records that the account read its parcels, which keeps them on the full schedule', async () => {
  const read = vi.spyOn(SupabaseUserClient.prototype, 'listPackages').mockResolvedValue([parcel]);
  const recorded = vi.spyOn(SupabaseUserClient.prototype, 'recordOpened').mockResolvedValue(undefined);
  const response = await list('?includeArchived=true');
  expect(response.status).toBe(200);
  expect((await response.json()).packages).toMatchObject([{ id: parcel.id }]);
  expect(read).toHaveBeenCalledExactlyOnceWith(true);
  expect(recorded).toHaveBeenCalledOnce();
});

it('still lists the parcels when the read cannot be recorded', async () => {
  vi.spyOn(SupabaseUserClient.prototype, 'listPackages').mockResolvedValue([parcel]);
  const failure = new SupabaseError('function unavailable');
  vi.spyOn(SupabaseUserClient.prototype, 'recordOpened').mockRejectedValue(failure);
  const report = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
  const response = await list();
  expect(response.status).toBe(200);
  expect((await response.json()).packages).toHaveLength(1);
  expect(report).toHaveBeenCalledExactlyOnceWith(failure, { component: 'packages', operation: 'record_account_opened' });
});

it('serves the carrier\'s scans without "Tracking added" once they reach back to it, nor any source', async () => {
  const event = { package_id: parcel.id, location: null, point: null };
  vi.spyOn(SupabaseUserClient.prototype, 'listPackages').mockResolvedValue([{ ...parcel, carrier: 'swiss-post', tracking_events: [
    { ...event, id: 'added', stage: 'pending', description: 'Tracking added', occurred_at: '2026-10-02T08:00:00+00:00', provider_event_id: 'app:pending' },
    { ...event, id: 'delivered', stage: 'delivered', description: 'Delivered', occurred_at: '2026-10-01T15:00:00+00:00', provider_event_id: 'swiss-post:a' },
  ] }]);
  vi.spyOn(SupabaseUserClient.prototype, 'recordOpened').mockResolvedValue(undefined);
  const [served] = (await (await list()).json()).packages;
  expect(served.tracking_events).toEqual([expect.objectContaining({ id: 'delivered', place: null })]);
  expect(JSON.stringify(served)).not.toContain('provider_event_id');
});
