import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  CompositePushNotificationService,
  DeliveryLiveActivityNotificationService,
  NativePushNotificationService,
  PushDispatchError,
  WebPushNotificationService,
} from './push';
import type { JsonObject } from './types';

const now = Date.parse('2026-09-07T12:40:00Z');
const privateKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const native = new NativePushNotificationService(
  {} as never, 'TEAM', 'KEY', privateKey, 'com.example.delivery', () => now / 1_000,
);
const web = new WebPushNotificationService(
  {} as never, 'public-key', 'private-key', 'https://delivery.example', () => now,
);
const live = new DeliveryLiveActivityNotificationService({} as never, native);
const delivered: JsonObject = {
  label: 'Coffee beans',
  package_id: 'package-1',
  stage: 'delivered',
  occurred_at: '2026-09-07T12:32:00Z',
  event_created_at: '2026-09-07T12:39:00Z',
  event_has_time: true,
  timezone: 'Europe/Zurich',
  expected_delivery: '2026-09-07',
  expected_delivery_changed: true,
};

function alert(payload: JsonObject): JsonObject {
  return (payload.aps as JsonObject).alert as JsonObject;
}

describe('friendly parcel notifications', () => {
  it.each(['web', 'native', 'live'])('leads with the news, then names the parcel and when it arrived, for %s alerts', (channel) => {
    const payload = channel === 'web' ? web.payload(delivered)
      : alert(channel === 'native' ? native.eventPayload(delivered) : live.payload(delivered, 'end'));
    expect(payload).toMatchObject({
      title: 'It’s arrived', body: 'Coffee beans · delivered at 14:32',
    });
    // Keep tapping the notification linked to the same parcel.
    expect(web.payload(delivered).data).toEqual({ url: '/?parcel=package-1' });
    expect(native.eventPayload(delivered).parcel_id).toBe('package-1');
  });

  it.each([
    ['registered', 'Label created'],
    ['accepted', 'Received by carrier'],
    ['in_transit', 'On its way'],
    ['customs', 'At customs'],
    ['exception', 'Needs attention'],
    ['out_for_delivery', 'Out for delivery'],
    ['ready_for_pickup', 'Ready for pickup'],
    ['failed_attempt', 'Delivery missed'],
    ['returned', 'On its way back'],
    ['something_new', 'Parcel update'],
  ])('titles a %s scan with the news, in its own words or the app\'s', (stage, title) => {
    expect(web.payload({ ...delivered, stage }).title).toBe(title);
    expect(alert(native.eventPayload({ ...delivered, stage })).title).toBe(title);
  });

  it.each([
    ['en', 'Coffee beans · delivered at 14:32'],
    ['de-CH', 'Coffee beans · um 14:32 Uhr zugestellt'],
    ['fr', 'Coffee beans · livré à 14:32'],
    ['it', 'Coffee beans · consegnato alle 14:32'],
    ['es-ES', 'Coffee beans · entregado a las 14:32'],
    ['pt-PT', 'Coffee beans · entregue às 14:32'],
    ['pl-PL', 'Coffee beans · dostarczono o 14:32'],
  ])('localizes delivery sentences for %s devices', (locale, body) => {
    expect(alert(native.eventPayload({ ...delivered, locale })).body).toBe(body);
  });

  it.each([
    ['en', 'Delivered at 14:32', 'Peek is keeping an eye on it'],
    ['de', 'Um 14:32 Uhr zugestellt', 'Peek behält es im Auge'],
    ['pt', 'Entregue às 14:32', 'O Peek está de olho nela'],
  ])('starts the line with a capital when a %s parcel has no name', (locale, arrived, customs) => {
    expect(web.payload({ ...delivered, locale, label: '' }).body).toBe(arrived);
    expect(web.payload({ ...delivered, locale, label: null, stage: 'customs', expected_delivery: null }).body).toBe(customs);
  });

  it('uses the recipient timezone and a safe fallback for an invalid timezone', () => {
    expect(web.payload({ ...delivered, timezone: 'America/New_York' }).body)
      .toBe('Coffee beans · delivered at 08:32');
    expect(web.payload({ ...delivered, timezone: 'Invalid/Zone' }).body)
      .toBe('Coffee beans · delivered at 14:32');
  });

  it('does not call delayed alerts recent, and dates deliveries from a previous day', () => {
    expect(web.payload({ ...delivered, occurred_at: '2026-09-07T09:32:00Z' }).body)
      .toBe('Coffee beans · delivered at 11:32');
    expect(web.payload({ ...delivered, occurred_at: '2026-09-06T12:32:00Z' }).body)
      .toBe('Coffee beans · delivered on 6 September at 14:32');
  });

  it.each([
    { event_has_time: false },
    { event_has_time: undefined },
    { occurred_at: null },
    { occurred_at: 'invalid' },
    { occurred_at: '2026-09-08T12:32:00Z' },
  ])('omits the clock time when the carrier time is unavailable or unreliable: %j', (changes) => {
    expect(web.payload({ ...delivered, ...changes }).body).toBe('Coffee beans · delivered');
  });

  it.each([
    ['ready_for_pickup', 'Coffee beans · waiting at the pickup point'],
    ['failed_attempt', 'Coffee beans · the carrier couldn’t deliver it. Tap to see what happens next.'],
    ['returned', 'Coffee beans · returning to the sender'],
    ['exception', 'Coffee beans · the carrier flagged a problem. Tap to see what to do.'],
  ])('does not repeat an obsolete estimate for %s', (stage, body) => {
    expect(web.payload({ ...delivered, stage }).body).toBe(body);
  });

  it('ends a Live Activity on a reported problem, with the missed-attempt grace period', () => {
    const row = { ...delivered, stage: 'exception', update_token: 'a'.repeat(64) };
    expect(live.deliveryKind(row)).toBe('end');
    const aps = live.payload(row, 'end').aps as JsonObject;
    expect(((aps['content-state'] as JsonObject).parcel as JsonObject).phase).toBe('exception');
    expect(aps['dismissal-date'])
      .toBe((live.payload({ ...row, stage: 'failed_attempt' }, 'end').aps as JsonObject)['dismissal-date']);
  });

  it('says when a parcel out for delivery arrives, or that it is close', () => {
    const row = { ...delivered, stage: 'out_for_delivery', expected_delivery_changed: false };
    expect(web.payload(row).body).toBe('Coffee beans · arriving today');
    expect(alert(live.payload(row, 'start')).body).toBe(web.payload(row).body);
    expect(web.payload({ ...row, expected_delivery: null }).body).toBe('Coffee beans · almost there');
  });

  it('says when the parcel arrives instead of what the step means, once that is known', () => {
    const row = { ...delivered, stage: 'in_transit', expected_delivery_changed: false };
    expect(web.payload({ ...row, expected_delivery: null }).body).toBe('Coffee beans · one step closer');
    expect(web.payload({ ...row, expected_delivery: '2026-09-08' }).body).toBe('Coffee beans · arriving tomorrow');
    expect(web.payload({ ...row, expected_delivery: '2026-09-11' }).body).toBe('Coffee beans · arriving 11 September');
    expect(web.payload({ ...row, expected_delivery: '2026-09-11', expected_delivery_changed: true }).body)
      .toBe('Coffee beans · now arriving 11 September');
  });

  it.each([
    ['de', 'kommt morgen', 'kommt am 11. September', 'neuer Liefertermin: 11. September'],
    ['fr', 'arrive demain', 'arrive le 11 septembre', 'arrive désormais le 11 septembre'],
    ['it', 'arriva domani', 'arrivo previsto: 11 settembre', 'nuova data prevista: 11 settembre'],
    ['es', 'llega mañana', 'llega el 11 de septiembre', 'ahora llega el 11 de septiembre'],
    ['pt', 'chega amanhã', 'chega a 11 de setembro', 'afinal chega a 11 de setembro'],
    ['pl', 'dotrze jutro', 'dotrze 11 września', 'nowy termin: 11 września'],
  ])('fits a day of the year into a %s sentence', (locale, tomorrow, dated, changed) => {
    const row = { ...delivered, locale, stage: 'in_transit', expected_delivery_changed: false };
    expect(web.payload({ ...row, expected_delivery: '2026-09-08' }).body).toBe(`Coffee beans · ${tomorrow}`);
    expect(web.payload({ ...row, expected_delivery: '2026-09-11' }).body).toBe(`Coffee beans · ${dated}`);
    expect(web.payload({ ...row, expected_delivery: '2026-09-11', expected_delivery_changed: true }).body)
      .toBe(`Coffee beans · ${changed}`);
  });

  it('keeps the delivery message readable before a long Unicode location', () => {
    const body = String(web.payload({ ...delivered, location: '😀'.repeat(250) }).body);
    expect(body).toMatch(/^Coffee beans · delivered at 14:32\n😀+…$/u);
    expect([...body].length).toBeLessThanOrEqual(220);
  });

  it('sends the mark\'s eyes as the badge Android reduces to an outline', () => {
    expect(web.payload(delivered)).toMatchObject({ icon: '/icons/icon-192.png', badge: '/icons/badge-96.png' });
  });
});

describe('useful, localized tracking updates', () => {
  it.each(['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'])('uses the same %s copy on web, iOS and Live Activities', (locale) => {
    for (const stage of ['pending', 'registered', 'accepted', 'in_transit', 'customs', 'exception', 'out_for_delivery', 'ready_for_pickup', 'delivered', 'failed_attempt', 'returned']) {
      for (const expected_delivery of ['2026-09-07', '2026-09-11', null]) {
        const row = { ...delivered, locale, stage, expected_delivery };
        const browser = web.payload(row);
        expect(browser.lang).toBe(locale);
        expect(browser.title).toBe(alert(native.eventPayload(row)).title);
        expect(browser.body).toBe(alert(native.eventPayload(row)).body);
        if (['out_for_delivery', 'delivered', 'ready_for_pickup', 'failed_attempt', 'returned', 'exception'].includes(stage)) {
          expect(alert(live.payload(row, stage === 'out_for_delivery' ? 'start' : 'end'))).toEqual({ title: browser.title, body: browser.body });
        }
        expect(`${String(browser.title)} ${String(browser.body)}`).not.toMatch(/\{\{|undefined|ETA/);
        expect(String(browser.body)).toMatch(/^Coffee beans · \S/);
        if (locale !== 'en') expect(browser.body).not.toBe(web.payload({ ...row, locale: 'en' }).body);
      }
    }
  });

  it('keeps a useful delivery window but removes past or malformed estimates', () => {
    const row = { ...delivered, stage: 'out_for_delivery', locale: 'fr', expected_delivery_changed: false };
    expect(web.payload({ ...row, expected_delivery: '2026-09-07 14:00–16:00' }).body)
      .toBe('Coffee beans · arrive aujourd’hui, 14:00–16:00');
    for (const expected_delivery of ['2026-09-06', 'invalid']) {
      expect(web.payload({ ...row, expected_delivery }).body).toBe('Coffee beans · presque arrivé');
    }
    expect(web.payload({ ...row, expected_delivery: '2026-09-07' }).body).toBe('Coffee beans · arrive aujourd’hui');
  });

  it('writes a Live Activity in the app\'s own words', () => {
    const row = { ...delivered, stage: 'out_for_delivery', locale: 'fr', expected_delivery_changed: false };
    const parcel = (changes: JsonObject) => ((live.payload({ ...row, ...changes }, 'start').aps as JsonObject)['content-state'] as JsonObject).parcel;
    expect(parcel({})).toMatchObject({ label: 'Coffee beans', detail: 'En livraison', status: 'En livraison' });
    expect(parcel({ expected_delivery: '2026-09-08 09:00–12:00' })).toMatchObject({ detail: 'demain, 09:00–12:00', status: 'En livraison' });
    expect(parcel({ label: '', stage: 'failed_attempt' })).toMatchObject({ label: 'Colis', status: 'Tentative de livraison' });
  });

  it.each(['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'])('confirms that notifications are on in %s', async (locale) => {
    const sent: JsonObject[] = [];
    const browser = new WebPushNotificationService({} as never, 'public-key', 'private-key', 'https://delivery.example', () => now);
    vi.spyOn(browser, 'send').mockImplementation(async (_row, payload) => { sent.push(payload!); });
    await browser.sendTest({ locale });
    await browser.sendTest({ locale: 'en' });
    expect(sent[0]).toMatchObject({ lang: locale, badge: '/icons/badge-96.png', data: { url: '/' } });
    expect(String(sent[0]!.title)).toContain('Peek');
    expect(String(sent[0]!.body).length).toBeGreaterThan(40);
    if (locale !== 'en') expect(sent[0]!.body).not.toBe(sent[1]!.body);
    expect(sent[1]).toMatchObject({ title: 'You’ll hear from Peek' });
  });
});

describe('service worker fallback copy', () => {
  const worker = readFileSync(resolve(process.cwd(), 'public/push-sw.js'), 'utf8');

  it.each(['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'])('matches the server %s update copy', (locale) => {
    const listeners: Record<string, (event: unknown) => void> = {};
    const shown: [string, { body: string; lang: string }][] = [];
    runInNewContext(worker, {
      caches: { delete: async () => true },
      self: {
        addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; },
        registration: { showNotification: async (title: string, options: { body: string; lang: string }) => { shown.push([title, options]); } },
      },
    });
    listeners.push!({ data: { json: () => ({ lang: locale }) }, waitUntil: () => undefined });

    const expected = web.payload({ locale, stage: 'update', package_id: 'package-1' });
    expect(shown).toHaveLength(1);
    expect(shown[0]![0]).toBe(expected.title);
    expect(shown[0]![1].body).toBe(expected.body);
    expect(shown[0]![1].lang).toBe(locale);
  });

  it('tells open windows to show the new state at once', async () => {
    const listeners: Record<string, (event: unknown) => void> = {};
    const postMessage = vi.fn();
    let settled: Promise<unknown> = Promise.resolve();
    runInNewContext(worker, {
      caches: { delete: async () => true },
      self: {
        addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; },
        registration: { showNotification: async () => undefined },
        clients: { matchAll: async () => [{ postMessage }] },
      },
    });
    listeners.push!({ data: { json: () => ({}) }, waitUntil: (promise: Promise<unknown>) => { settled = promise; } });
    await settled;
    expect(postMessage).toHaveBeenCalledWith({ type: 'sdt:server-update' });
  });
});

describe('push channel isolation', () => {
  it('still sends browser and iPhone alerts when the Live Activity queue fails', async () => {
    const summary = (sent: number) => ({ attempted: sent, sent, failed: 0, expired: 0 });
    const outage = new Error('relation "pending_live_activity_events" does not exist');
    const composite = new CompositePushNotificationService(
      { dispatch: async () => summary(2) } as never,
      { dispatch: async () => summary(1) } as never,
      { dispatch: async () => { throw outage; } } as never,
    );

    const error = await composite.dispatch().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(PushDispatchError);
    expect((error as PushDispatchError).errors).toEqual([outage]);
    expect((error as PushDispatchError).summary).toEqual(summary(3));
  });
});
