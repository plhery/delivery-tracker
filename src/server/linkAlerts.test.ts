import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  ALERT_PRESET_STAGES,
  ALL_NOTIFICATION_STAGES,
  DELIVERY_DAY_NOTIFICATION_STAGES,
  IMPORTANT_NOTIFICATION_STAGES,
} from '../lib/notificationPresets';
import * as webPresets from '../lib/pushNotifications';
import * as metrics from './metrics';
import * as observability from './observability';
import { CompositePushNotificationService, ParcelLinkAlertService, pushServices, WebPushNotificationService } from './push';
import { SupabaseServiceClient } from './supabase';
import type { JsonObject } from './types';

// Synthetic identifiers only: no push service issued this endpoint.
const now = Date.parse('2026-10-02T12:40:00Z');
const linkId = 'k7Qm2xHd9RtW';
const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-link-alert';

function row(changes: JsonObject = {}): JsonObject {
  return {
    alert_id: 'alert-1', link_id: linkId, endpoint, p256dh: 'synthetic-key', auth: 'synthetic-auth', locale: 'en', preset: 'all',
    owner: false, failures: 0, gift: false, event_id: 'event-1', package_id: 'package-1', stage: 'in_transit',
    location: 'Example Town', occurred_at: '2026-10-02T12:30:00Z', event_created_at: '2026-10-02T12:39:00Z',
    package_stage: 'in_transit', expected_delivery: null, expected_delivery_changed: false, event_has_time: true,
    account_endpoint: false, ...changes,
  };
}

let client: SupabaseServiceClient;
let web: WebPushNotificationService;
let alerts: ParcelLinkAlertService;
let send: MockInstance<WebPushNotificationService['send']>;
let handled: MockInstance<SupabaseServiceClient['recordParcelLinkAlertDeliveries']>;
let removed: MockInstance<SupabaseServiceClient['deleteParcelLinkAlert']>;
let failures: MockInstance<SupabaseServiceClient['setParcelLinkAlertFailures']>;
const pending = (rows: JsonObject[]) => vi.spyOn(client, 'listPendingParcelLinkAlerts').mockResolvedValue(rows);
const refused = (statusCode: number) => Object.assign(new Error('Received unexpected response code'), { statusCode });

beforeEach(() => {
  client = new SupabaseServiceClient('https://database.example', 'test');
  web = new WebPushNotificationService(client, 'public-key', 'private-key', 'https://delivery.example', () => now);
  alerts = new ParcelLinkAlertService(web);
  send = vi.spyOn(web, 'send').mockResolvedValue();
  handled = vi.spyOn(client, 'recordParcelLinkAlertDeliveries').mockResolvedValue();
  removed = vi.spyOn(client, 'deleteParcelLinkAlert').mockResolvedValue();
  failures = vi.spyOn(client, 'setParcelLinkAlertFailures').mockResolvedValue();
  vi.spyOn(client, 'latestScanTimes').mockResolvedValue(new Map());
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('what an alert announces', () => {
  it('shares its three presets with the account settings, on the web and on the server', () => {
    expect(ALERT_PRESET_STAGES).toEqual({
      all: ALL_NOTIFICATION_STAGES, important: IMPORTANT_NOTIFICATION_STAGES, delivery: DELIVERY_DAY_NOTIFICATION_STAGES,
    });
    // The web client's settings read the very same lists.
    expect(webPresets.ALL_NOTIFICATION_STAGES).toBe(ALL_NOTIFICATION_STAGES);
    expect(webPresets.IMPORTANT_NOTIFICATION_STAGES).toBe(IMPORTANT_NOTIFICATION_STAGES);
    expect(webPresets.DELIVERY_DAY_NOTIFICATION_STAGES).toBe(DELIVERY_DAY_NOTIFICATION_STAGES);
    expect(ALERT_PRESET_STAGES.delivery).toEqual(['out_for_delivery', 'delivered']);
    expect(ALERT_PRESET_STAGES.important).not.toContain('in_transit');
  });

  it.each([
    ['all', 'registered', true], ['all', 'in_transit', true], ['all', 'returned', true], ['all', 'pending', false],
    ['important', 'accepted', false], ['important', 'in_transit', false], ['important', 'customs', true],
    ['important', 'exception', true], ['important', 'ready_for_pickup', true], ['important', 'delivered', true],
    ['delivery', 'customs', false], ['delivery', 'out_for_delivery', true], ['delivery', 'delivered', true], ['delivery', 'returned', false],
    ['delivery-day', 'delivered', false], ['', 'delivered', false], ['toString', 'delivered', false],
  ])('preset %s and a %s scan: %s', (preset, stage, announced) => {
    expect(alerts.announces(row({ preset, stage }))).toBe(announced);
  });

  it('announces the newest scan its preset covers, and records the whole batch as handled', async () => {
    pending([
      row({ preset: 'important', event_id: 'accepted', stage: 'accepted', occurred_at: '2026-10-02T08:00:00Z' }),
      row({ preset: 'important', event_id: 'held', stage: 'exception', occurred_at: '2026-10-02T09:00:00Z' }),
      row({ preset: 'important', event_id: 'customs', stage: 'customs', occurred_at: '2026-10-02T10:00:00Z' }),
      row({ preset: 'important', event_id: 'transit', stage: 'in_transit', occurred_at: '2026-10-02T12:00:00Z' }),
    ]);
    const counted = vi.spyOn(metrics, 'recordParcelAlertSent');
    expect(await alerts.dispatch()).toEqual({ attempted: 1, sent: 1, failed: 0, expired: 0 });
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event_id: 'customs', endpoint }), expect.objectContaining({
      body: 'Your parcel is going through customs. We’ll update you when it moves again.\nExample Town',
    }));
    expect(handled).toHaveBeenCalledExactlyOnceWith('alert-1', ['accepted', 'held', 'customs', 'transit']);
    expect(removed).not.toHaveBeenCalled();
    expect(failures).not.toHaveBeenCalled();
    expect(counted).toHaveBeenCalledExactlyOnceWith('sent');
  });

  it('records scans its preset does not cover as handled, without a notification', async () => {
    pending([row({ preset: 'delivery', stage: 'in_transit' })]);
    const counted = vi.spyOn(metrics, 'recordParcelAlertSent');
    expect(await alerts.dispatch()).toEqual({ attempted: 0, sent: 0, failed: 0, expired: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(handled).toHaveBeenCalledExactlyOnceWith('alert-1', ['event-1']);
    expect(counted).toHaveBeenCalledExactlyOnceWith('skipped');
  });

  it('announces only the parcel\'s newest scan: a backfilled older one is handled silently', async () => {
    pending([row({ stage: 'customs', occurred_at: '2026-09-23T15:23:40Z' })]);
    const latest = vi.mocked(client.latestScanTimes).mockResolvedValue(new Map([['package-1', '2026-09-24T08:37:04Z']]));
    expect(await alerts.dispatch()).toMatchObject({ attempted: 0, sent: 0 });
    expect(latest).toHaveBeenCalledWith(['package-1']);
    expect(send).not.toHaveBeenCalled();
    expect(handled).toHaveBeenCalledExactlyOnceWith('alert-1', ['event-1']);
    // Within an hour of the newest it is news, and so it is when the lookup fails.
    latest.mockResolvedValueOnce(new Map([['package-1', '2026-09-23T16:15:00Z']])).mockRejectedValueOnce(new Error('down'));
    await alerts.dispatch();
    await alerts.dispatch();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('tells each alert of a link apart, in its own language and with its own preset', async () => {
    pending([
      row({ alert_id: 'alert-1', locale: 'de', preset: 'all' }),
      row({ alert_id: 'alert-2', endpoint: `${endpoint}-2`, locale: 'fr', preset: 'delivery' }),
      row({ alert_id: 'alert-3', endpoint: `${endpoint}-3`, locale: 'pl', preset: 'all' }),
    ]);
    expect(await alerts.dispatch()).toMatchObject({ attempted: 2, sent: 2 });
    expect(send.mock.calls.map(([sent, payload]) => [sent.alert_id, payload?.lang, payload?.title])).toEqual([
      ['alert-1', 'de', 'Paket-Update'], ['alert-3', 'pl', 'Aktualizacja przesyłki'],
    ]);
    expect(handled.mock.calls.map(([alertId]) => alertId)).toEqual(['alert-1', 'alert-2', 'alert-3']);
  });

  it('passes over an alert on a browser the parcel\'s owner already gets account notifications on', async () => {
    pending([row({ account_endpoint: true }), row({ alert_id: 'alert-2', endpoint: `${endpoint}-2` })]);
    expect(await alerts.dispatch()).toMatchObject({ attempted: 1, sent: 1 });
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ alert_id: 'alert-2' }), expect.anything());
    // Passed over, not kept for later: the owner's own notification covered it.
    expect(handled.mock.calls).toEqual([['alert-1', ['event-1']], ['alert-2', ['event-1']]]);
  });
});

describe('what an alert says', () => {
  it('opens the link\'s page and carries neither the parcel\'s name nor its number', () => {
    const payload = alerts.payload(row({ label: 'Sneakers for Ada', tracking_number: 'TESTPARCEL123456', stage: 'delivered' }));
    expect(payload).toEqual({
      title: 'Parcel update',
      body: 'Your parcel was delivered at 14:30.\nExample Town',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: `parcel-link-${linkId}`,
      lang: 'en',
      data: { url: `/p/${linkId}` },
    });
    expect(JSON.stringify(payload)).not.toMatch(/Sneakers|TESTPARCEL|package-1|alert-1|synthetic/);
  });

  it.each(['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'])('uses the sentences an account gets, in %s', (locale) => {
    for (const stage of ALL_NOTIFICATION_STAGES) {
      const event = row({ locale, stage, expected_delivery: '2026-10-03', timezone: 'Europe/Zurich' });
      const payload = alerts.payload(event);
      expect(payload.body).toBe(web.payload(event).body);
      expect(payload.lang).toBe(locale);
      expect(payload.title).toBe(web.payload({ ...event, label: '' }).title);
    }
  });

  it('reads times in Zurich\'s timezone, as for an account that chose none', () => {
    expect(alerts.payload(row({ stage: 'delivered', timezone: 'America/New_York' })).body).toMatch(/delivered at 14:30/);
  });

  it.each(['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'])('announces a gift on its way as one, without the place of the scan, in %s', (locale) => {
    const plain = alerts.payload(row({ locale }));
    const gift = alerts.payload(row({ locale, gift: true }));
    expect(gift.title).not.toBe(plain.title);
    expect(String(gift.title).length).toBeGreaterThan(5);
    expect(plain.body).toBe(`${String(gift.body)}\nExample Town`);
    expect(JSON.stringify(gift)).not.toContain('Example Town');
    // It has arrived: another title, and the place is no secret any more.
    const here = alerts.payload(row({ locale, gift: true, stage: 'delivered', package_stage: 'delivered' }));
    expect(here.title).not.toBe(gift.title);
    expect(here.title).not.toBe(plain.title);
    expect(String(here.body)).toContain('Example Town');
    expect(gift.data).toEqual({ url: `/p/${linkId}` });
  });

  it('words a gift in English as its page does', () => {
    expect(alerts.payload(row({ gift: true })).title).toBe('Something’s on its way to you');
    expect(alerts.payload(row({ gift: true, stage: 'delivered', package_stage: 'delivered' })).title).toBe('It’s here');
    // A gift going back is not on its way to anyone.
    expect(alerts.payload(row({ gift: true, stage: 'returned', package_stage: 'returned' })).title).toBe('Parcel update');
    expect(alerts.payload(row({ gift: true, stage: 'returned', package_stage: 'returned' })).body).not.toContain('Example Town');
  });

  it('tells the owner of a gift lookup like the owner of any parcel', () => {
    expect(alerts.payload(row({ gift: true, owner: true }))).toEqual(alerts.payload(row()));
  });

  it('does not tell a gift\'s viewer about the announcement its page leaves out', async () => {
    expect(alerts.announces(row({ gift: true, stage: 'registered' }))).toBe(false);
    expect(alerts.announces(row({ gift: true, stage: 'accepted' }))).toBe(true);
    expect(alerts.announces(row({ gift: true, owner: true, stage: 'registered' }))).toBe(true);
    expect(alerts.announces(row({ gift: true, stage: 'registered', package_stage: 'delivered' }))).toBe(true);
    pending([row({ gift: true, stage: 'registered' })]);
    expect(await alerts.dispatch()).toMatchObject({ attempted: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(handled).toHaveBeenCalledOnce();
  });

  it('is shown and opened by the service worker as any other notification', async () => {
    const worker = readFileSync(resolve(process.cwd(), 'public/push-sw.js'), 'utf8');
    const listeners: Record<string, (event: unknown) => void> = {};
    const shown: [string, JsonObject][] = [];
    const opened: string[] = [];
    let settled: Promise<unknown> = Promise.resolve();
    runInNewContext(worker, {
      URL,
      caches: { delete: async () => true },
      self: {
        addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; },
        registration: { showNotification: async (title: string, options: JsonObject) => { shown.push([title, options]); } },
        location: { origin: 'https://delivery.example' },
        clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } },
      },
    });
    const payload = alerts.payload(row({ gift: true }));
    listeners.push!({ data: { json: () => payload }, waitUntil: () => undefined });
    expect(shown).toEqual([['Something’s on its way to you', expect.objectContaining({
      body: payload.body, tag: `parcel-link-${linkId}`, lang: 'en', data: { url: `/p/${linkId}` },
    })]]);
    listeners.notificationclick!({
      notification: { close: () => undefined, data: shown[0]![1].data },
      waitUntil: (promise: Promise<unknown>) => { settled = promise; },
    });
    await settled;
    expect(opened).toEqual([`https://delivery.example/p/${linkId}`]);
  });
});

describe('when an alert ends', () => {
  it.each(['delivered', 'returned'])('ends once the %s notification is sent', async (stage) => {
    pending([row({ stage, package_stage: stage })]);
    const counted = vi.spyOn(metrics, 'recordParcelAlertRemoved');
    expect(await alerts.dispatch()).toMatchObject({ attempted: 1, sent: 1 });
    expect(send).toHaveBeenCalledOnce();
    expect(removed).toHaveBeenCalledExactlyOnceWith('alert-1');
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(removed.mock.invocationCallOrder[0]!);
    expect(counted).toHaveBeenCalledExactlyOnceWith('delivered');
    // The alert went with what it handled: nothing is recorded for it.
    expect(handled).not.toHaveBeenCalled();
  });

  it('ends with the journey even when its preset does not announce the last scan', async () => {
    pending([row({ preset: 'delivery', stage: 'returned', package_stage: 'returned' })]);
    expect(await alerts.dispatch()).toMatchObject({ attempted: 0, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledExactlyOnceWith('alert-1');
  });

  it('stays on while the parcel is on its way', async () => {
    pending([row({ stage: 'out_for_delivery', package_stage: 'out_for_delivery' })]);
    await alerts.dispatch();
    expect(removed).not.toHaveBeenCalled();
    expect(handled).toHaveBeenCalledOnce();
  });

  it.each([404, 410])('is removed when the push service answers %i for its subscription', async (statusCode) => {
    pending([row(), row({ alert_id: 'alert-2', endpoint: `${endpoint}-2` })]);
    send.mockRejectedValueOnce(refused(statusCode));
    const counted = vi.spyOn(metrics, 'recordParcelAlertRemoved');
    expect(await alerts.dispatch()).toEqual({ attempted: 2, sent: 1, failed: 0, expired: 1 });
    expect(removed).toHaveBeenCalledExactlyOnceWith('alert-1');
    expect(counted).toHaveBeenCalledExactlyOnceWith('expired');
    // The other alert of the link is not affected.
    expect(handled).toHaveBeenCalledExactlyOnceWith('alert-2', ['event-1']);
  });

  it.each([[0, new Error('socket hang up')], [0, refused(503)], [1, refused(429)], [0, refused(401)], [1, refused(400)], [0, refused(403)]])(
    'does not repeat a failed send, and counts it (after %i earlier failures)', async (before, failure) => {
      pending([row({ failures: before })]);
      send.mockRejectedValue(failure);
      const sent = vi.spyOn(metrics, 'recordParcelAlertSent');
      const logged = vi.spyOn(observability, 'logOperationalEvent');
      const report = vi.spyOn(observability, 'captureOperationalError');
      // A visitor's endpoint that fails is no error of the service: nothing is reported.
      expect(await alerts.dispatch()).toEqual({ attempted: 1, sent: 0, failed: 0, expired: 0 });
      expect(send).toHaveBeenCalledOnce();
      expect(handled).toHaveBeenCalledExactlyOnceWith('alert-1', ['event-1']);
      expect(failures).toHaveBeenCalledExactlyOnceWith('alert-1', before + 1);
      expect(removed).not.toHaveBeenCalled();
      expect(sent).toHaveBeenCalledExactlyOnceWith('failed');
      expect(logged).toHaveBeenCalledExactlyOnceWith('parcel_link_alerts_failed', { failed: 1 }, 'error');
      expect(report).not.toHaveBeenCalled();
      for (const [, details] of logged.mock.calls) expect(JSON.stringify(details)).not.toMatch(/synthetic|k7Qm2xHd9RtW/);
    },
  );

  it('is removed after three failed sends in a row, and starts over after one that worked', async () => {
    pending([row({ failures: 2 })]);
    send.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));
    const counted = vi.spyOn(metrics, 'recordParcelAlertRemoved');
    await alerts.dispatch();
    expect(removed).toHaveBeenCalledExactlyOnceWith('alert-1');
    expect(counted).toHaveBeenCalledExactlyOnceWith('failed');
    expect(failures).not.toHaveBeenCalled();

    await alerts.dispatch();
    expect(failures).toHaveBeenCalledExactlyOnceWith('alert-1', 0);
    expect(removed).toHaveBeenCalledOnce();
  });

  it('stops at once when the server is shutting down', async () => {
    pending([row()]);
    const controller = new AbortController();
    send.mockImplementation(async () => { controller.abort(new Error('draining')); });
    await expect(alerts.dispatch(controller.signal)).rejects.toThrow('draining');
    expect(handled).not.toHaveBeenCalled();
  });
});

describe('alerts beside the account notifications', () => {
  const summary = (sent: number) => ({ attempted: sent, sent, failed: 0, expired: 0 });

  it('sends link alerts on top of the account channels, after them', async () => {
    const order: string[] = [];
    const channel = (name: string, sent: number) => ({ dispatch: async () => { order.push(name); return summary(sent); } }) as never;
    const composite = new CompositePushNotificationService(channel('web', 2), channel('native', 1), channel('live', 0), channel('links', 3));
    expect(await composite.dispatch()).toEqual(summary(6));
    expect(order).toEqual(['live', 'web', 'native', 'links']);
  });

  it('still sends account notifications when the alert queue fails', async () => {
    const outage = new Error('relation "pending_parcel_link_alerts" does not exist');
    const composite = new CompositePushNotificationService(
      { dispatch: async () => summary(2) } as never, null, null, { dispatch: async () => { throw outage; } } as never,
    );
    await expect(composite.dispatch()).rejects.toMatchObject({ errors: [outage], summary: summary(2) });
  });

  it('exists exactly when this server sends Web Push', async () => {
    const { default: webpush } = await import('web-push');
    const keys = webpush.generateVAPIDKeys();
    vi.stubEnv('VAPID_PUBLIC_KEY', keys.publicKey);
    vi.stubEnv('VAPID_PRIVATE_KEY', keys.privateKey);
    const configured = pushServices(client);
    expect(configured.linkAlerts).toBeInstanceOf(ParcelLinkAlertService);
    expect(configured.linkAlerts!.web).toBe(configured.web);
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    expect(pushServices(client).linkAlerts).toBeNull();
  });
});
