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
