import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { type Session } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { ParcelsProvider, useParcels } from '../store/ParcelsContext';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { currentStage } from '../lib/stages';
import { apiRoute, json } from '../server/api';
import { compareNotificationEvents } from '../server/push';
import type { ParcelRepo, ParcelWithEvents, TrackingEvent } from '../types';

vi.spyOn(console, 'log').mockImplementation(() => {});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const parcel: ParcelWithEvents = { id: 'parcel-1', trackingNumber: '123456', label: 'Old name', carrier: 'ups', createdAt: '2026-09-08T00:00:00Z', syncStatus: 'ok', events: [] };

it('keeps a completed rename when an earlier poll returns', async () => {
  let finishPoll!: (rows: ParcelWithEvents[]) => void;
  const repo = { mode: 'api', list: vi.fn().mockResolvedValue([parcel]), rename: vi.fn().mockResolvedValue({ ...parcel, label: 'New name' }) } as unknown as ParcelRepo;
  const { result } = renderHook(() => useParcels(), { wrapper: ({ children }) => <ParcelsProvider repo={repo}>{children}</ParcelsProvider> });
  await waitFor(() => expect(result.current.parcels).toHaveLength(1));
  vi.mocked(repo.list).mockImplementationOnce(() => new Promise(resolve => { finishPoll = resolve; }));
  let poll!: Promise<void>;
  act(() => { poll = result.current.retryLoad(); });
  await act(async () => { await result.current.renameParcel(parcel.id, 'New name'); });
  expect(result.current.parcels[0].label).toBe('New name');
  await act(async () => { finishPoll([parcel]); await poll; });
  expect(result.current.parcels[0].label).toBe('New name');
});

it('agrees with push on equal-time delivery events', () => {
  const events: TrackingEvent[] = [
    { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', parcelId: parcel.id, stage: 'in_transit', description: 'In transit', occurredAt: '2026-09-08T00:00:00Z' },
    { id: '00000000-0000-4000-8000-000000000001', parcelId: parcel.id, stage: 'delivered', description: 'Delivered', occurredAt: '2026-09-08T00:00:00Z' },
  ];
  expect(currentStage(events)).toBe('delivered');
  expect(events.map(e => ({ event_id: e.id, stage: e.stage, occurred_at: e.occurredAt })).sort(compareNotificationEvents)[0].stage).toBe('delivered');
});

it.each([429, 500, 502, 503, 504])('preserves authentication during Auth HTTP %s', async (status) => {
  vi.stubEnv('SUPABASE_URL', 'https://audit-auth.example.test');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-fixture');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Service unavailable', { status })));
  const route = apiRoute(() => json({ ok: true }), { loadService: false });
  const response = await route(new NextRequest('https://audit.example.test/api/packages', { headers: { authorization: 'Bearer fixture-current-session' } }), { params: Promise.resolve({}) });
  expect(response.status).toBe(503);
});

it('clears expired offline credentials and cannot restore them on reload', async () => {
  const key = 'sb-fixture-auth-token';
  const config = { url: 'https://fixture.example.test', publishableKey: 'public-fixture', googleEnabled: false, emailOtpEnabled: true };
  const saved: Session = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '00000000-0000-4000-8000-000000000003', email: 'fixture@example.test', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-09-08T00:00:00Z' } };
  window.localStorage.setItem(key, JSON.stringify(saved));
  const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider config={config}>{children}</AuthProvider>;
  const first = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(first.result.current.status).toBe('authenticated'));
  window.localStorage.setItem(key, JSON.stringify({ ...saved, expires_at: 1 }));
  await act(async () => { await first.result.current.signOut(); });
  expect(first.result.current.status).toBe('anonymous');
  expect(window.localStorage.getItem(key)).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('grant_type=refresh_token'))).toBe(false);
  first.unmount();
  const second = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(second.result.current.status).toBe('anonymous'));
  second.unmount();
  window.localStorage.removeItem(`${key}.signed-out`);
});

it('isolates untrusted anonymous traffic from valid credentials', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://audit-auth.example.test');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-fixture');
  vi.stubEnv('TRUST_PROXY_HEADERS', 'false');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const route = apiRoute(() => json({ ok: true }), { loadService: false });
  for (let i = 0; i < 900; i++) {
    await route(new NextRequest('https://audit.example.test/api/packages'), { params: Promise.resolve({}) });
  }
  const upstream = vi.fn().mockResolvedValue(Response.json({ id: '00000000-0000-4000-8000-000000000007' }));
  vi.stubGlobal('fetch', upstream);
  const victim = await route(new NextRequest('https://audit.example.test/api/packages', { headers: { authorization: 'Bearer valid-other-user', 'x-real-ip': '203.0.113.55' } }), { params: Promise.resolve({}) });
  expect(victim.status).toBe(200);
  expect(upstream).toHaveBeenCalledOnce();
});
