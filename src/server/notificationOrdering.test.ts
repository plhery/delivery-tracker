import { generateKeyPairSync } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { compareNotificationEvents, DeliveryLiveActivityNotificationService, NativePushNotificationService, WebPushNotificationService } from './push';
import { SupabaseServiceClient } from './supabase';

const privateKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
afterEach(() => vi.restoreAllMocks());

it.each(['web', 'native', 'live'] as const)('sends the latest milestone and acknowledges the batch for %s notifications', async (channel) => {
  const client = new SupabaseServiceClient('https://example.test', 'test');
  const base = { subscription_id: 'sub', device_id: 'device', package_id: 'pkg', update_token: 'token', update_token_id: 'update', event_created_at: '2026-09-08T12:00:00Z' };
  const events = [
    { ...base, event_id: 'old', stage: 'accepted', occurred_at: '2026-09-07T09:00:00Z' },
    { ...base, event_id: 'latest', stage: 'delivered', occurred_at: '2026-09-08T11:00:00Z' },
  ];
  const apns = new NativePushNotificationService(client, 'team', 'key', privateKey, 'app');
  if (channel === 'web') {
    vi.spyOn(client, 'listPendingPushNotifications').mockResolvedValue(events);
    const ack = vi.spyOn(client, 'recordPushDeliveries').mockResolvedValue();
    vi.spyOn(client, 'updatePushSubscription').mockResolvedValue();
    const service = new WebPushNotificationService(client, '', '', '');
    const send = vi.spyOn(service, 'send').mockResolvedValue();
    await service.dispatch();
    expect(send).toHaveBeenCalledWith(events[1]);
    expect(ack).toHaveBeenCalledWith('sub', ['old', 'latest']);
  } else if (channel === 'native') {
    vi.spyOn(client, 'listPendingNativePushNotifications').mockResolvedValue(events);
    const ack = vi.spyOn(client, 'recordNativePushDeliveries').mockResolvedValue();
    vi.spyOn(client, 'updateNativePushDevice').mockResolvedValue();
    const send = vi.spyOn(apns, 'send').mockResolvedValue();
    await apns.dispatch();
    expect(send).toHaveBeenCalledWith(events[1]);
    expect(ack).toHaveBeenCalledWith('device', ['old', 'latest']);
  } else {
    vi.spyOn(client, 'listPendingLiveActivityEvents').mockResolvedValue(events);
    const ack = vi.spyOn(client, 'recordLiveActivityDeliveries').mockResolvedValue();
    vi.spyOn(client, 'deleteLiveActivityTokenById').mockResolvedValue();
    const service = new DeliveryLiveActivityNotificationService(client, apns);
    const send = vi.spyOn(service, 'send').mockResolvedValue();
    await service.dispatch();
    expect(send).toHaveBeenCalledWith(events[1], 'end');
    expect(ack.mock.calls[0][0].map(event => event.eventId)).toEqual(['old', 'latest']);
  }
});

it('uses delivery progress for timestamp ties and numeric time for timezone offsets', () => {
  const created = '2026-09-08T12:00:00Z';
  const delivered = { stage: 'delivered', occurred_at: created, event_created_at: created, event_id: 'a' };
  const accepted = { ...delivered, stage: 'accepted', event_id: 'z' };
  expect([accepted, delivered].sort(compareNotificationEvents)[0]).toBe(delivered);
  expect([delivered, accepted].sort(compareNotificationEvents)[0]).toBe(delivered);
  expect(compareNotificationEvents({ ...accepted, occurred_at: '2026-09-08T13:00:00+02:00' }, delivered)).toBeGreaterThan(0);
  expect(compareNotificationEvents({ ...accepted, occurred_at: null }, { ...delivered, occurred_at: 'bad' })).toBeGreaterThan(0);
});
