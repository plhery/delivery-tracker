import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DeliveryLiveActivityNotificationService,
  NativePushNotificationService,
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
  it.each(['web', 'native', 'live'])('uses the carrier delivery time and drops the ETA for %s alerts', (channel) => {
    const payload = channel === 'web' ? web.payload(delivered)
      : alert(channel === 'native' ? native.eventPayload(delivered) : live.payload(delivered, 'end'));
    expect(payload).toMatchObject({
      title: 'Coffee beans', body: "Your parcel was delivered at 14:32.",
    });
    // Keep tapping the notification linked to the same parcel.
    expect(web.payload(delivered).data).toEqual({ url: '/?parcel=package-1' });
    expect(native.eventPayload(delivered).parcel_id).toBe('package-1');
  });

  it.each([
    ['en', "Your parcel was delivered at 14:32."],
    ['de-CH', "Dein Paket wurde um 14:32 Uhr zugestellt."],
    ['fr', "Ton colis a été livré à 14:32."],
    ['it', "Il tuo pacco è stato consegnato alle 14:32."],
    ['es-ES', "Tu paquete se entregó a las 14:32."],
    ['pt-PT', "O teu envio foi entregue às 14:32."],
    ['pl-PL', "Twoja przesyłka została dostarczona o 14:32."],
  ])('localizes delivery sentences for %s devices', (locale, body) => {
    expect(alert(native.eventPayload({ ...delivered, locale })).body).toBe(body);
  });

  it('uses the recipient timezone and a safe fallback for an invalid timezone', () => {
    expect(web.payload({ ...delivered, timezone: 'America/New_York' }).body)
      .toBe("Your parcel was delivered at 08:32.");
    expect(web.payload({ ...delivered, timezone: 'Invalid/Zone' }).body)
      .toBe("Your parcel was delivered at 14:32.");
  });

  it('does not call delayed alerts recent, and dates deliveries from a previous day', () => {
    expect(web.payload({ ...delivered, occurred_at: '2026-09-07T09:32:00Z' }).body)
      .toBe("Your parcel was delivered at 11:32.");
    expect(web.payload({ ...delivered, occurred_at: '2026-09-06T12:32:00Z' }).body)
      .toBe("Your parcel was delivered on 06.09.2026 at 14:32.");
  });

  it.each([
    { event_has_time: false },
    { event_has_time: undefined },
    { occurred_at: null },
    { occurred_at: 'invalid' },
    { occurred_at: '2026-09-08T12:32:00Z' },
  ])('omits the clock time when the carrier time is unavailable or unreliable: %j', (changes) => {
    expect(web.payload({ ...delivered, ...changes }).body).toBe("Your parcel has been delivered.");
  });

  it.each([
    ['ready_for_pickup', "Your parcel is ready to collect. Open tracking for pickup details."],
    ['failed_attempt', "The carrier couldn’t deliver your parcel. Open tracking for the next steps."],
    ['returned', "Your parcel is being returned to the sender. Contact the sender for the next steps."],
    ['exception', "The carrier reported a problem with your parcel. Open tracking for the next steps."],
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

  it('omits a redundant today estimate from out-for-delivery alerts', () => {
    const row = { ...delivered, stage: 'out_for_delivery', expected_delivery_changed: false };
    expect(web.payload(row).body).toBe("Your parcel is out for delivery.");
    expect(alert(live.payload(row, 'start')).body).toBe(web.payload(row).body);
  });

  it('keeps the delivery message readable before a long Unicode location', () => {
    const body = String(web.payload({ ...delivered, location: '😀'.repeat(250) }).body);
    expect(body).toMatch(/^Your parcel was delivered at 14:32\.\n😀+…$/u);
    expect([...body].length).toBeLessThanOrEqual(220);
  });
});

describe('useful, localized tracking updates', () => {
  it.each(['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'])('uses the same %s copy on web, iOS and Live Activities', (locale) => {
    for (const stage of ['pending', 'registered', 'accepted', 'in_transit', 'customs', 'exception', 'out_for_delivery', 'ready_for_pickup', 'delivered', 'failed_attempt', 'returned']) {
      const row = { ...delivered, locale, stage };
      const browser = web.payload(row);
      expect(browser.lang).toBe(locale);
      expect(browser.body).toBe(alert(native.eventPayload(row)).body);
      if (['out_for_delivery', 'delivered', 'ready_for_pickup', 'failed_attempt', 'returned', 'exception'].includes(stage)) {
        expect(browser.body).toBe(alert(live.payload(row, stage === 'out_for_delivery' ? 'start' : 'end')).body);
      }
      expect(String(browser.body)).not.toMatch(/\{\{|undefined|ETA/);
      if (locale !== 'en') expect(browser.body).not.toBe(web.payload({ ...row, locale: 'en' }).body);
    }
  });

  it('keeps a useful delivery window but removes past or malformed estimates', () => {
    const row = { ...delivered, stage: 'out_for_delivery', locale: 'fr', expected_delivery_changed: false };
    expect(web.payload({ ...row, expected_delivery: '2026-09-07 14:00–16:00' }).body)
      .toBe('Ton colis est en livraison. Livraison prévue : aujourd’hui, 14:00–16:00.');
    for (const expected_delivery of ['2026-09-06', 'invalid', '2026-09-07']) {
      expect(web.payload({ ...row, expected_delivery }).body).toBe('Ton colis est en livraison.');
    }
    expect(((live.payload({ ...row, expected_delivery: '2026-09-07' }, 'start').aps as JsonObject)['content-state'] as JsonObject).parcel)
      .toMatchObject({ detail: 'En cours de livraison', status: 'En cours de livraison' });
  });
});
