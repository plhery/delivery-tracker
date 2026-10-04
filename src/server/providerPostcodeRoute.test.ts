import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PATCH } from '../../app/api/packages/[id]/carrier/route';
import { SupabaseAuthenticator } from './auth';
import { SupabaseServiceClient, SupabaseUserClient } from './supabase';
vi.mock('./background', () => ({ wakeSyncWorker: vi.fn() }));
const id = '55000000-0000-4000-a000-000000000002';
const parcel = { id, tracking_number: '1234567891', carrier: 'unknown', tracking_url: null, dpd_postcode: null, archived_at: null };
const patch = (body: object) => PATCH(new NextRequest(`https://delivery.example/api/packages/${id}/carrier`, {
  method: 'PATCH', headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example'); vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-key'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({ id: '55000000-0000-4000-a000-000000000001', email: null, authenticatedAt: null, sessionId: null });
  vi.spyOn(SupabaseUserClient.prototype, 'getPackage').mockResolvedValue(parcel);
  vi.spyOn(SupabaseUserClient.prototype, 'setProviderPostcode').mockResolvedValue(true);
  vi.spyOn(SupabaseUserClient.prototype, 'changePackageCarrier').mockResolvedValue(true);
  vi.spyOn(SupabaseServiceClient.prototype, 'enqueueSyncJob').mockResolvedValue({ row: { id: '55000000-0000-4000-a000-000000000003' }, queued: true });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it('saves normalized provider input through the owner RPC and queues a fresh check without resetting the carrier', async () => {
  expect((await patch({ carrier: 'unknown', providerPostcode: 'm5v 3l9' })).status).toBe(200);
  expect(SupabaseUserClient.prototype.setProviderPostcode).toHaveBeenCalledWith(id, 'M5V 3L9');
  expect(SupabaseUserClient.prototype.changePackageCarrier).not.toHaveBeenCalled();
  expect(SupabaseServiceClient.prototype.enqueueSyncJob).toHaveBeenCalledOnce();
});
it('rejects malformed input and a combined carrier change before any mutation', async () => {
  expect((await patch({ carrier: 'unknown', providerPostcode: '<script>123' })).status).toBe(400);
  expect((await patch({ carrier: 'dhl-express', providerPostcode: '8000' })).status).toBe(400);
  expect(SupabaseUserClient.prototype.setProviderPostcode).not.toHaveBeenCalled();
  expect(SupabaseServiceClient.prototype.enqueueSyncJob).not.toHaveBeenCalled();
});
it('does not mutate a parcel the authenticated user cannot read', async () => {
  vi.mocked(SupabaseUserClient.prototype.getPackage).mockResolvedValue(null);
  expect((await patch({ carrier: 'unknown', providerPostcode: '8000' })).status).toBe(404);
  expect(SupabaseUserClient.prototype.setProviderPostcode).not.toHaveBeenCalled();
});
