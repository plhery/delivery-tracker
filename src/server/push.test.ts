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
      title: 'Coffee beans', body: 'Your package just got delivered at 14:32!',
    });
    // Keep tapping the notification linked to the same parcel.
    expect(web.payload(delivered).data).toEqual({ url: '/?parcel=package-1' });
    expect(native.eventPayload(delivered).parcel_id).toBe('package-1');
  });

  it.each([
    ['en', 'Your package just got delivered at 14:32!'],
    ['de-CH', 'Dein Paket wurde gerade um 14:32 Uhr zugestellt!'],
    ['fr', 'Votre colis vient d’être livré à 14:32 !'],
    ['it', 'Il tuo pacco è appena stato consegnato alle 14:32!'],
  ])('localizes delivery sentences for %s devices', (locale, body) => {
    expect(alert(native.eventPayload({ ...delivered, locale })).body).toBe(body);
  });

  it('uses the recipient timezone and a safe fallback for an invalid timezone', () => {
    expect(web.payload({ ...delivered, timezone: 'America/New_York' }).body)
      .toBe('Your package just got delivered at 08:32!');
    expect(web.payload({ ...delivered, timezone: 'Invalid/Zone' }).body)
      .toBe('Your package just got delivered at 14:32!');
  });

  it('does not call delayed alerts recent, and dates deliveries from a previous day', () => {
    expect(web.payload({ ...delivered, occurred_at: '2026-09-07T09:32:00Z' }).body)
      .toBe('Your package was delivered at 11:32!');
    expect(web.payload({ ...delivered, occurred_at: '2026-09-06T12:32:00Z' }).body)
      .toBe('Your package was delivered on 06.09.2026 at 14:32.');
  });

  it.each([
    { event_has_time: false },
    { event_has_time: undefined },
    { occurred_at: null },
    { occurred_at: 'invalid' },
    { occurred_at: '2026-09-08T12:32:00Z' },
  ])('omits the clock time when the carrier time is unavailable or unreliable: %j', (changes) => {
    expect(web.payload({ ...delivered, ...changes }).body).toBe('Your package has been delivered!');
  });

  it.each([
    ['ready_for_pickup', 'Your package is ready to pick up!'],
    ['failed_attempt', 'The carrier couldn’t deliver your package. Check the tracking details for next steps.'],
    ['returned', 'Your package is being returned to the sender.'],
  ])('does not repeat an obsolete estimate for %s', (stage, body) => {
    expect(web.payload({ ...delivered, stage }).body).toBe(body);
  });

  it('gives out-for-delivery alerts friendly wording with the current estimate', () => {
    const row = { ...delivered, stage: 'out_for_delivery', expected_delivery_changed: false };
    expect(web.payload(row).body).toBe('Your package is out for delivery! Expected today.');
    expect(alert(live.payload(row, 'start')).body).toBe(web.payload(row).body);
  });

  it('keeps the delivery message readable before a long Unicode location', () => {
    const body = String(web.payload({ ...delivered, location: '😀'.repeat(250) }).body);
    expect(body).toMatch(/^Your package just got delivered at 14:32!\n😀+…$/u);
    expect([...body].length).toBeLessThanOrEqual(220);
  });
});
