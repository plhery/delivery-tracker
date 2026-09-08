import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fixture from '../../contracts/fixtures/delivery-api.json';
import { clearApiCache, createApiRepo, API_CACHE_KEY } from './apiRepo';
import { SupabaseAuthenticator } from '../server/auth';
import { SupabaseServiceClient, SupabaseUserClient } from '../server/supabase';
import { POST as refreshAll } from '../../app/api/sync/route';

const row = fixture.packageList.packages[0];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });
it('rejects a late list response without recreating the signed-out account cache', async () => {
 let finish!: (r: Response) => void;
 const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
 vi.stubGlobal('fetch', fetcher);
 const auth = { userId: 'account-A', getAccessToken: async () => 'token-A' };
 const repo = createApiRepo(30_000, 1000, localStorage, auth);
 const stop = repo.subscribe!(() => {});
 const pending = repo.list();
 const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
 await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
 clearApiCache(localStorage, auth.userId);
 stop();
 finish(Response.json({ packages: [row] }));
 await rejected;
 expect(localStorage.getItem(`${API_CACHE_KEY}.account-A`)).toBeNull();
});
it('never retries a disposed account request using a new account token', async () => {
 let finish!: (r: Response) => void;
 let token = 'token-A';
 const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
   .mockResolvedValueOnce(Response.json({ packages: [{ ...row, label: 'Private B parcel' }] }));
 vi.stubGlobal('fetch', fetcher);
 const repo = createApiRepo(30_000, 1000, localStorage, { userId: 'account-A', getAccessToken: async () => token });
 const stop = repo.subscribe!(() => {});
 const pending = repo.list();
 const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
 await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
 stop(); clearApiCache(localStorage, 'account-A'); token = 'token-B';
 finish(Response.json({ error: 'expired' }, { status: 401 }));
 await rejected;
 expect(fetcher).toHaveBeenCalledTimes(1);
 expect(localStorage.getItem(`${API_CACHE_KEY}.account-A`)).toBeNull();
});
it('queues every eligible parcel when refreshing a collection larger than five', async () => {
 vi.stubEnv('SUPABASE_URL', 'https://database.example');
 vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-key');
 vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
 vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({
   id: '10000000-0000-0000-0000-000000000001', email: null, authenticatedAt: null, sessionId: null
 });
 vi.spyOn(SupabaseUserClient.prototype, 'listActivePackages').mockResolvedValue(Array.from({length:6}, (_,i) => ({id:`parcel-${i}`})));
 const enqueue = vi.spyOn(SupabaseServiceClient.prototype, 'enqueueSyncJob').mockImplementation(async ({packageId}) => ({queued:true,row:{id:`job-${packageId}`}}));
 vi.spyOn(SupabaseServiceClient.prototype,'pendingSyncJobCount').mockResolvedValue(6);
 const response = await refreshAll(new NextRequest('https://delivery.example/api/sync', { method:'POST', headers:{Authorization:'Bearer valid'} }), {params:Promise.resolve({})});
 expect(response.status).toBe(202);
 expect(enqueue).toHaveBeenCalledTimes(6);
 expect((await response.json()).jobIds).toHaveLength(6);
});
