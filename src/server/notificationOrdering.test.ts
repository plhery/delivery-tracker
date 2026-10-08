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
  vi.spyOn(client, 'latestScanTimes').mockResolvedValue(new Map([['pkg', '2026-09-08T11:00:00Z']]));
  vi.spyOn(client, 'packageJoinTimes').mockResolvedValue(new Map([['pkg', '2026-09-01T08:00:00Z']]));
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

it.each(['web', 'native'] as const)('records a backfilled older scan as handled without announcing it for %s', async (channel) => {
  const client = new SupabaseServiceClient('https://example.test', 'test');
  const base = { subscription_id: 'sub', device_id: 'device', package_id: 'pkg', event_created_at: '2026-09-27T12:00:00Z' };
  // A carrier change stored the customs scan after the parcel was already delivered.
  const backfill = [{ ...base, event_id: 'customs', stage: 'customs', occurred_at: '2026-09-23T15:23:40Z' }];
  const latest = vi.spyOn(client, 'latestScanTimes').mockResolvedValue(new Map([['pkg', '2026-09-24T08:37:04Z']]));
  vi.spyOn(client, 'packageJoinTimes').mockResolvedValue(new Map([['pkg', '2026-09-01T08:00:00Z']]));
  const apns = new NativePushNotificationService(client, 'team', 'key', privateKey, 'app');
  const service = channel === 'web' ? new WebPushNotificationService(client, '', '', '') : apns;
  const send = vi.spyOn(service, 'send').mockResolvedValue();
  const ack = channel === 'web'
    ? vi.spyOn(client, 'recordPushDeliveries').mockResolvedValue()
    : vi.spyOn(client, 'recordNativePushDeliveries').mockResolvedValue();
  if (channel === 'web') {
    vi.spyOn(client, 'listPendingPushNotifications').mockResolvedValue(backfill);
    vi.spyOn(client, 'updatePushSubscription').mockResolvedValue();
  } else {
    vi.spyOn(client, 'listPendingNativePushNotifications').mockResolvedValue(backfill);
    vi.spyOn(client, 'updateNativePushDevice').mockResolvedValue();
  }
  expect(await service.dispatch()).toMatchObject({ attempted: 0, sent: 0 });
  expect(latest).toHaveBeenCalledWith(['pkg']);
  expect(send).not.toHaveBeenCalled();
  expect(ack).toHaveBeenCalledWith(channel === 'web' ? 'sub' : 'device', ['customs']);

  // The parcel's newest scan is news, and so is one within an hour of it
  // (clock skew); a failed lookup announces as before.
  latest.mockResolvedValueOnce(new Map([['pkg', '2026-09-23T15:23:40Z']]))
    .mockResolvedValueOnce(new Map([['pkg', '2026-09-23T16:15:00Z']]))
    .mockRejectedValueOnce(new Error('down'));
  await service.dispatch();
  await service.dispatch();
  await service.dispatch();
  expect(send).toHaveBeenCalledTimes(3);
});

it.each(['web', 'native'] as const)('records what a parcel already showed when it was added as handled, and announces what follows, for %s', async (channel) => {
  const client = new SupabaseServiceClient('https://example.test', 'test');
  const joined = '2026-10-05T10:00:00Z';
  const scan = (occurred_at: string, event_created_at: string, event_has_time = true) => ({
    subscription_id: 'sub', device_id: 'device', package_id: 'pkg', event_id: 'scan', stage: 'in_transit', occurred_at, event_created_at, event_has_time,
  });
  const apns = new NativePushNotificationService(client, 'team', 'key', privateKey, 'app');
  const service = channel === 'web' ? new WebPushNotificationService(client, '', '', '') : apns;
  const send = vi.spyOn(service, 'send').mockResolvedValue();
  const ack = channel === 'web' ? vi.spyOn(client, 'recordPushDeliveries').mockResolvedValue() : vi.spyOn(client, 'recordNativePushDeliveries').mockResolvedValue();
  const pending = channel === 'web' ? vi.spyOn(client, 'listPendingPushNotifications') : vi.spyOn(client, 'listPendingNativePushNotifications');
  vi.spyOn(client, 'updatePushSubscription').mockResolvedValue();
  vi.spyOn(client, 'updateNativePushDevice').mockResolvedValue();
  const joins = vi.spyOn(client, 'packageJoinTimes').mockResolvedValue(new Map([['pkg', joined]]));
  // Each batch is the parcel's newest scan, as a first history always is.
  const announced = async (event: ReturnType<typeof scan>) => {
    pending.mockResolvedValueOnce([event]);
    vi.spyOn(client, 'latestScanTimes').mockResolvedValueOnce(new Map([['pkg', event.occurred_at]]));
    send.mockClear(); ack.mockClear();
    await service.dispatch();
    expect(ack).toHaveBeenCalledExactlyOnceWith(channel === 'web' ? 'sub' : 'device', ['scan']);
    return send.mock.calls.length === 1;
  };
  // The check that runs as the parcel is added stores what the carrier already had.
  expect(await announced(scan('2026-10-04T18:00:00Z', '2026-10-05T10:00:01Z'))).toBe(false);
  expect(await announced(scan('2026-10-05T00:00:00Z', '2026-10-05T10:00:02Z', false))).toBe(false);
  // A scan from well before the add is old news whenever it arrives.
  expect(await announced(scan('2026-09-20T10:00:00Z', '2026-10-05T11:00:00Z'))).toBe(false);
  // A first history that arrives later, from the hours before the add, is news.
  expect(await announced(scan('2026-10-05T09:30:00Z', '2026-10-05T10:50:00Z'))).toBe(true);
  // A day without a clock may have ended less than a day before the add.
  expect(await announced(scan('2026-10-04T00:00:00Z', '2026-10-05T12:00:00Z', false))).toBe(true);
  // So is a scan made after the add, even one the first check stores.
  expect(await announced(scan('2026-10-05T10:02:00Z', '2026-10-05T10:03:00Z'))).toBe(true);
  // Without the join time every batch is announced, as before.
  joins.mockRejectedValueOnce(new Error('down'));
  expect(await announced(scan('2026-10-04T18:00:00Z', '2026-10-05T10:00:01Z'))).toBe(true);
  expect(joins).toHaveBeenCalledWith(['pkg']);
});
