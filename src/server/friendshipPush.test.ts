import { afterEach, describe, expect, it, vi } from 'vitest';
import { FriendshipPushService, FriendshipPushWorker, friendshipNotification } from './friendshipPush';
import * as observability from './observability';
import { SupabaseError } from './supabase';
import type { JsonObject } from './types';

const friendID = '11111111-1111-4111-8111-111111111111';
const row = { id: 'receipt', lease_token: 'lease', friend_id: friendID, nickname: 'Alex', subscription_id: 'browser', locale: 'fr' };
function fixture(deliveries: JsonObject[] = [row]) {
  const client = { claimFriendshipPush: vi.fn().mockResolvedValue(deliveries), finishFriendshipPush: vi.fn().mockResolvedValue(undefined), updatePushSubscription: vi.fn(), updateNativePushDevice: vi.fn() };
  const web = { send: vi.fn().mockResolvedValue(undefined) };
  const native = { send: vi.fn().mockResolvedValue(undefined), isExpired: vi.fn().mockReturnValue(false) };
  return { client, web, native, service: new FriendshipPushService(client as never, web as never, native as never) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('friendship receipts', () => {
  it.each([
    ['en', 'Alex is in'], ['fr-CH', 'Alex est de la partie'],
    ['de', 'Alex ist dabei'], ['it', 'Alex è dei nostri'], ['es', 'Alex se apunta'], ['pt-PT', 'Alex juntou-se a ti'],
    ['pl', 'Alex jest już w Twoim kręgu'], ['unknown', 'Alex is in'],
  ])('tells both push channels in the device\'s language: %s', (locale, title) => {
    const payload = friendshipNotification({ ...row, locale, email: 'PRIVATE', label: 'PRIVATE', location: 'PRIVATE' });
    expect(payload.web.title).toBe(title);
    expect(String(payload.web.body).length).toBeGreaterThan(10);
    expect(payload.web).toMatchObject({ badge: '/icons/badge-96.png' });
    expect(payload.web.data).toEqual({ url: `/?view=friends&friend=${friendID}` });
    expect(payload.native).toMatchObject({ aps: { alert: { title } }, kind: 'friend_accepted', friend_id: friendID });
    expect(JSON.stringify(payload)).not.toContain('PRIVATE');
    expect(payload.native).not.toHaveProperty('parcel_id');
  });
  it('writes a nickname as it is', () => {
    expect(friendshipNotification({ ...row, locale: 'en', nickname: 'A$&B' }).web.title).toBe('A$&B is in');
  });
  it('acknowledges each successful device delivery with its lease', async () => {
    const { service, client, web, native } = fixture([row, { ...row, id: 'native-receipt', subscription_id: null, device_id: 'iphone' }]);
    expect(await service.dispatch()).toEqual({ attempted: 2, sent: 2, failed: 0, expired: 0 });
    expect(client.claimFriendshipPush).toHaveBeenCalledWith(true, true);
    expect(web.send).toHaveBeenCalledOnce(); expect(native.send).toHaveBeenCalledOnce();
    expect(client.finishFriendshipPush).toHaveBeenCalledWith('receipt', 'lease', true);
    expect(client.finishFriendshipPush).toHaveBeenCalledWith('native-receipt', 'lease', true);
  });
  it('releases failed sends for retry without marking them delivered', async () => {
    const { service, client, web } = fixture();
    web.send.mockRejectedValue(new Error('offline'));
    expect(await service.dispatch()).toMatchObject({ failed: 1, sent: 0 });
    expect(client.finishFriendshipPush).toHaveBeenCalledWith('receipt', 'lease', false);
    expect(client.updatePushSubscription).not.toHaveBeenCalled();
  });
  it('disables expired subscriptions and native tokens', async () => {
    const { service, client, web, native } = fixture([row, { ...row, subscription_id: null, device_id: 'iphone' }]);
    web.send.mockRejectedValue({ statusCode: 410 }); native.send.mockRejectedValue(new Error('expired')); native.isExpired.mockReturnValue(true);
    expect(await service.dispatch()).toMatchObject({ expired: 2, sent: 0 });
    expect(client.updatePushSubscription).toHaveBeenCalledWith('browser', expect.objectContaining({ disabled_at: expect.any(String) }));
    expect(client.updateNativePushDevice).toHaveBeenCalledWith('iphone', expect.objectContaining({ disabled_at: expect.any(String) }));
  });
  it('does not claim deliveries when neither channel is configured', async () => {
    const { client } = fixture();
    const service = new FriendshipPushService(client as never, null, null);
    expect(await service.dispatch()).toMatchObject({ attempted: 0 });
    expect(client.claimFriendshipPush).not.toHaveBeenCalled();
  });
  it('wakes promptly and never overlaps dispatches in the same process', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const dispatch = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue({});
    const worker = new FriendshipPushWorker({ dispatch } as never);
    worker.start(); worker.start(); worker.wake();
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatch).toHaveBeenCalledOnce();
    worker.wake(); await vi.advanceTimersByTimeAsync(30_000); expect(dispatch).toHaveBeenCalledOnce();
    finish(); await vi.advanceTimersByTimeAsync(15_001); expect(dispatch).toHaveBeenCalledTimes(2);
    worker.stop(); await vi.advanceTimersByTimeAsync(60_000); expect(dispatch).toHaveBeenCalledTimes(2);
  });
  it('leaves a database that does not answer to the sync worker, and reports a refusal', async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(observability, 'logOperationalEvent').mockImplementation(() => undefined);
    const report = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const refusal = new SupabaseError('Supabase POST request failed (404)', 404, 'PGRST202');
    const dispatch = vi.fn()
      .mockRejectedValueOnce(new SupabaseError('The delivery database is unreachable', undefined, 'unreachable'))
      .mockRejectedValueOnce(refusal).mockResolvedValue({});
    const worker = new FriendshipPushWorker({ dispatch } as never);
    worker.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(logged).toHaveBeenCalledExactlyOnceWith('friendship_notification_failed', { error_type: 'SupabaseError' }, 'error');
    expect(report).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    worker.stop();
    expect(logged).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledExactlyOnceWith(refusal, { component: 'friendship-notifications', operation: 'dispatch' });
  });
});
