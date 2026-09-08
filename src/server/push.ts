import { EVENT_STAGE_ORDER } from '../lib/stages';
import 'server-only';

import { connect, constants as http2Constants } from 'node:http2';
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { SignJWT } from 'jose';
import { DateTime, IANAZone } from 'luxon';
import webpush from 'web-push';
import { CARRIER_CAPABILITIES } from '../generated/apiContract';
import type { SupabaseServiceClient } from './supabase';
import { errorMessage, isRecord, type JsonObject } from './types';

const STAGE_LABELS: Record<string, string> = {
  pending: 'Not announced yet',
  registered: 'Shipment announced',
  accepted: 'Parcel accepted',
  in_transit: 'Parcel in transit',
  customs: 'At customs',
  out_for_delivery: 'Out for delivery',
  ready_for_pickup: 'Ready for pickup',
  delivered: 'Delivered',
  failed_attempt: 'Delivery attempt failed',
  returned: 'Returning to sender',
};

const PUSH_COPY: Record<string, Record<string, string>> = {
  en: {
    test_title: "Parcel alerts are on",
    test_body: "You’ll receive the delivery updates you chose on this device. You can change them in Notification settings.",
    update: 'Parcel update',
    today: 'today',
    tomorrow: 'tomorrow',
    ...STAGE_LABELS,
    body_update: "There’s an update to your parcel. Open tracking for details.",
    body_pending: "We’re waiting for the carrier’s first update.",
    body_registered: "The sender has announced your parcel. We’re waiting for the carrier to receive it.",
    body_accepted: "The carrier has received your parcel.",
    body_in_transit: "Your parcel is on its way.",
    body_customs: "Your parcel is going through customs. We’ll update you when it moves again.",
    body_out_for_delivery: "Your parcel is out for delivery.",
    body_ready_for_pickup: "Your parcel is ready to collect. Open tracking for pickup details.",
    body_delivered: "Your parcel has been delivered.",
    body_failed_attempt: "The carrier couldn’t deliver your parcel. Open tracking for the next steps.",
    body_returned: "Your parcel is being returned to the sender. Contact the sender for the next steps.",
    delivered_time: "Your parcel was delivered at {{time}}.",
    delivered_date: "Your parcel was delivered on {{date}} at {{time}}.",
    eta: 'Expected {{date}}.',
    eta_changed: 'Delivery is now expected {{date}}.',
  },
  de: {
    test_title: "Paketmeldungen sind aktiv",
    test_body: "Du erhältst die gewählten Liefermeldungen auf diesem Gerät. Du kannst sie in den Meldungseinstellungen ändern.",
    update: 'Paketaktualisierung',
    today: 'heute',
    tomorrow: 'morgen',
    pending: 'Noch nicht angekündigt',
    registered: 'Sendung angekündigt',
    accepted: 'Paket angenommen',
    in_transit: 'Paket unterwegs',
    customs: 'Beim Zoll',
    out_for_delivery: 'In Zustellung',
    ready_for_pickup: 'Abholbereit',
    delivered: 'Zugestellt',
    failed_attempt: 'Zustellversuch fehlgeschlagen',
    returned: 'Rücksendung an Absender',
    body_update: "Es gibt Neuigkeiten zu deinem Paket. Öffne das Tracking für die Details.",
    body_pending: "Wir warten auf die erste Meldung des Paketdienstes.",
    body_registered: "Der Absender hat dein Paket angekündigt. Wir warten auf die Übergabe an den Paketdienst.",
    body_accepted: "Der Paketdienst hat dein Paket erhalten.",
    body_in_transit: "Dein Paket ist unterwegs.",
    body_customs: "Dein Paket wird beim Zoll bearbeitet. Wir melden uns, wenn es weitergeht.",
    body_out_for_delivery: "Dein Paket ist auf Zustelltour.",
    body_ready_for_pickup: "Dein Paket ist abholbereit. Öffne das Tracking für die Abholinformationen.",
    body_delivered: "Dein Paket wurde zugestellt.",
    body_failed_attempt: "Dein Paket konnte nicht zugestellt werden. Öffne das Tracking für die nächsten Schritte.",
    body_returned: "Dein Paket geht an den Absender zurück. Frage dort nach den nächsten Schritten.",
    delivered_time: "Dein Paket wurde um {{time}} Uhr zugestellt.",
    delivered_date: "Dein Paket wurde am {{date}} um {{time}} Uhr zugestellt.",
    eta: 'Voraussichtliche Zustellung: {{date}}.',
    eta_changed: 'Neue voraussichtliche Zustellung: {{date}}.',
  },
  fr: {
    test_title: "Les alertes colis sont activées",
    test_body: "Vous recevrez les nouvelles choisies sur cet appareil. Vous pouvez les modifier dans les réglages des notifications.",
    update: 'Mise à jour du colis',
    today: 'aujourd’hui',
    tomorrow: 'demain',
    pending: 'Pas encore annoncé',
    registered: 'Envoi annoncé',
    accepted: 'Colis accepté',
    in_transit: 'Colis en transit',
    customs: 'À la douane',
    out_for_delivery: 'En cours de livraison',
    ready_for_pickup: 'Prêt à être retiré',
    delivered: 'Livré',
    failed_attempt: 'Échec de la tentative de livraison',
    returned: 'Retour à l’expéditeur',
    body_update: "Il y a du nouveau pour votre colis. Ouvrez le suivi pour les détails.",
    body_pending: "Nous attendons les premières nouvelles du transporteur.",
    body_registered: "L’expéditeur a annoncé votre colis. Nous attendons sa remise au transporteur.",
    body_accepted: "Le transporteur a pris en charge votre colis.",
    body_in_transit: "Votre colis est en route.",
    body_customs: "Votre colis est en cours de dédouanement. Nous vous préviendrons lorsqu’il repartira.",
    body_out_for_delivery: "Votre colis est en cours de livraison.",
    body_ready_for_pickup: "Votre colis est prêt à être retiré. Ouvrez le suivi pour les détails du retrait.",
    body_delivered: "Votre colis a été livré.",
    body_failed_attempt: "Le transporteur n’a pas pu livrer votre colis. Ouvrez le suivi pour connaître la suite.",
    body_returned: "Votre colis est retourné à l’expéditeur. Contactez-le pour connaître la suite.",
    delivered_time: "Votre colis a été livré à {{time}}.",
    delivered_date: "Votre colis a été livré le {{date}} à {{time}}.",
    eta: 'Livraison prévue : {{date}}.',
    eta_changed: 'Livraison désormais prévue : {{date}}.',
  },
  it: {
    test_title: "Gli avvisi sui pacchi sono attivi",
    test_body: "Riceverai gli aggiornamenti scelti su questo dispositivo. Puoi modificarli nelle impostazioni delle notifiche.",
    update: 'Aggiornamento del pacco',
    today: 'oggi',
    tomorrow: 'domani',
    pending: 'Non ancora annunciato',
    registered: 'Spedizione annunciata',
    accepted: 'Pacco accettato',
    in_transit: 'Pacco in transito',
    customs: 'Alla dogana',
    out_for_delivery: 'In consegna',
    ready_for_pickup: 'Pronto per il ritiro',
    delivered: 'Consegnato',
    failed_attempt: 'Tentativo di consegna non riuscito',
    returned: 'Restituzione al mittente',
    body_update: "Ci sono novità sul pacco. Apri il tracciamento per i dettagli.",
    body_pending: "Aspettiamo il primo aggiornamento del corriere.",
    body_registered: "Il mittente ha annunciato il pacco. Attendiamo che venga affidato al corriere.",
    body_accepted: "Il corriere ha preso in carico il tuo pacco.",
    body_in_transit: "Il tuo pacco è in viaggio.",
    body_customs: "Il tuo pacco è in fase di sdoganamento. Ti avviseremo quando ripartirà.",
    body_out_for_delivery: "Il tuo pacco è in consegna.",
    body_ready_for_pickup: "Il pacco è pronto per il ritiro. Apri il tracciamento per i dettagli.",
    body_delivered: "Il tuo pacco è stato consegnato.",
    body_failed_attempt: "Il corriere non è riuscito a consegnare il pacco. Apri il tracciamento per sapere come procedere.",
    body_returned: "Il pacco sta tornando al mittente. Contattalo per sapere come procedere.",
    delivered_time: "Il tuo pacco è stato consegnato alle {{time}}.",
    delivered_date: "Il tuo pacco è stato consegnato il {{date}} alle {{time}}.",
    eta: 'Consegna prevista: {{date}}.',
    eta_changed: 'La consegna è ora prevista: {{date}}.',
  },
};

export interface PushSummary {
  attempted: number;
  sent: number;
  failed: number;
  expired: number;
}

function emptySummary(): PushSummary {
  return { attempted: 0, sent: 0, failed: 0, expired: 0 };
}

export function notificationText(value: unknown, limit: number): string {
  const cleaned = String(value ?? '').trim().split(/\s+/).filter(Boolean).join(' ');
  const characters = [...cleaned];
  if (characters.length <= limit) return cleaned;
  return `${characters.slice(0, limit - 1).join('').trimEnd()}…`;
}

function stringField(row: JsonObject, name: string): string {
  return typeof row[name] === 'string' ? row[name] : '';
}

function carrierDisplayName(value: unknown): string {
  const carrier = typeof value === 'string' ? value : '';
  if (Object.hasOwn(CARRIER_CAPABILITIES, carrier)) {
    return CARRIER_CAPABILITIES[carrier as keyof typeof CARRIER_CAPABILITIES].displayName;
  }
  return carrier || 'Carrier';
}

const NOTIFICATION_LANGUAGE_TAGS: Record<string, string> = {
  en: 'en-CH',
  de: 'de-CH',
  fr: 'fr-CH',
  it: 'it-CH',
};

function notificationLocale(value: unknown): string {
  const locale = typeof value === 'string'
    ? value.trim().split(/[-_]/, 1)[0]!.toLowerCase()
    : 'en';
  return PUSH_COPY[locale] ? locale : 'en';
}

export function notificationExpectedDelivery(
  value: unknown,
  locale = 'en',
  timezone = 'Europe/Zurich',
  now = Date.now(),
): string {
  const cleaned = notificationText(value, 100);
  if (!cleaned) return '';
  const language = notificationLocale(locale);
  const copy = PUSH_COPY[language]!;
  const languageTag = NOTIFICATION_LANGUAGE_TAGS[language]!;
  const zone = IANAZone.isValidZone(timezone) ? timezone : 'Europe/Zurich';
  const today = DateTime.fromMillis(now, { zone });

  const formattedDay = (raw: string): string | null => {
    const expected = DateTime.fromISO(raw, { zone });
    if (!expected.isValid || !today.isValid) return null;
    if (expected.startOf('day') < today.startOf('day')) return '';
    if (expected.toISODate() === today.toISODate()) return copy.today!;
    if (expected.toISODate() === today.plus({ days: 1 }).toISODate()) return copy.tomorrow!;
    return expected.setLocale(languageTag).toLocaleString(DateTime.DATE_SHORT);
  };

  const window = /^(\d{4}-\d{2}-\d{2})[ T]+(\d{2}:\d{2})(?:[–-](\d{2}:\d{2}))?$/.exec(
    cleaned,
  );
  if (window) {
    const day = formattedDay(window[1]!);
    if (!day) return '';
    return `${day}, ${window[2]}${window[3] ? `–${window[3]}` : ''}`;
  }
  const expected = DateTime.fromISO(cleaned, { zone });
  if (expected.isValid && /T\d{2}:\d{2}/.test(cleaned)) {
    const day = formattedDay(expected.toISODate()!);
    return day ? `${day}, ${expected.toFormat('HH:mm')}` : '';
  }
  return formattedDay(cleaned) ?? '';
}

function deliveredMessage(
  row: JsonObject,
  copy: Record<string, string>,
  locale: string,
  now: number,
): string {
  const fallback = copy.body_delivered!;
  // The queue distinguishes carrier times from date-only and observed updates.
  if (row.event_has_time !== true) return fallback;
  const timezone = stringField(row, 'timezone');
  const zone = IANAZone.isValidZone(timezone) ? timezone : 'Europe/Zurich';
  const delivered = DateTime.fromISO(stringField(row, 'occurred_at'), { zone });
  const current = DateTime.fromMillis(now, { zone });
  if (!delivered.isValid || !current.isValid || delivered.toMillis() > now) return fallback;

  const sameDay = delivered.toISODate() === current.toISODate();
  const template = sameDay ? copy.delivered_time : copy.delivered_date;
  return template!
    .replace('{{time}}', delivered.toFormat('HH:mm'))
    .replace('{{date}}', delivered.setLocale(NOTIFICATION_LANGUAGE_TAGS[locale]!)
      .toLocaleString(DateTime.DATE_SHORT));
}

const ETA_NOTIFICATION_STAGES = new Set([
  'registered', 'accepted', 'in_transit', 'customs', 'out_for_delivery',
]);

function notificationBody(
  row: JsonObject,
  copy: Record<string, string>,
  locale: string,
  now: number,
): string {
  const stage = stringField(row, 'stage');
  let message = stage === 'delivered'
    ? deliveredMessage(row, copy, locale, now)
    : copy[`body_${stage}`] ?? copy.body_update!;
  if (ETA_NOTIFICATION_STAGES.has(stage)) {
    const expected = notificationExpectedDelivery(
      row.expected_delivery,
      locale,
      stringField(row, 'timezone') || 'Europe/Zurich',
      now,
    );
    if (expected && !(stage === 'out_for_delivery' && expected === copy.today)) {
      const template = row.expected_delivery_changed === true ? copy.eta_changed : copy.eta;
      message += ` ${template!.replace('{{date}}', expected)}`;
    }
  }

  const primary = notificationText(message, 220);
  const remaining = 220 - [...primary].length - 1;
  const location = remaining > 1 ? notificationText(row.location, Math.min(140, remaining)) : '';
  return location ? `${primary}\n${location}` : primary;
}

// Database insertion times are identical for events imported in one transaction.
// Prefer carrier chronology; resolve coarse/missing timestamps by delivery progress.


export function compareNotificationEvents(left: JsonObject, right: JsonObject): number {
  const timestamp = (row: JsonObject, key: string) => {
    const value = Date.parse(stringField(row, key));
    return Number.isFinite(value) ? value : 0;
  };
  return timestamp(right, 'occurred_at') - timestamp(left, 'occurred_at')
    || EVENT_STAGE_ORDER.indexOf(stringField(right, 'stage')) - EVENT_STAGE_ORDER.indexOf(stringField(left, 'stage'))
    || timestamp(right, 'event_created_at') - timestamp(left, 'event_created_at')
    || stringField(right, 'event_id').localeCompare(stringField(left, 'event_id'));
}

export class WebPushNotificationService {
  constructor(
    readonly client: SupabaseServiceClient,
    readonly publicKey: string,
    readonly privateKey: string,
    readonly subject: string,
    readonly now: () => number = () => Date.now(),
  ) {}

  async dispatch(signal?: AbortSignal): Promise<PushSummary> {
    signal?.throwIfAborted();
    const grouped = new Map<string, JsonObject[]>();
    for (const row of await this.client.listPendingPushNotifications()) {
      const key = JSON.stringify([stringField(row, 'subscription_id'), stringField(row, 'package_id')]);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    const summary = emptySummary();
    for (const events of grouped.values()) {
      signal?.throwIfAborted();
      const newest = [...events].sort(compareNotificationEvents)[0]!;
      const subscriptionId = stringField(newest, 'subscription_id');
      summary.attempted += 1;
      try {
        await this.send(newest);
        signal?.throwIfAborted();
        await this.client.recordPushDeliveries(
          subscriptionId,
          events.map((event) => stringField(event, 'event_id')).filter(Boolean),
        );
        await this.client.updatePushSubscription(subscriptionId, {
          last_success_at: new Date().toISOString(),
          last_error: null,
        });
        summary.sent += 1;
      } catch (error) {
        signal?.throwIfAborted();
        const status = typeof error === 'object' && error !== null && 'statusCode' in error
          ? Number(error.statusCode)
          : 0;
        if (status === 404 || status === 410) {
          await this.client.updatePushSubscription(subscriptionId, {
            disabled_at: new Date().toISOString(),
            last_error: 'Push endpoint expired',
          });
          summary.expired += 1;
        } else {
          await this.client.updatePushSubscription(subscriptionId, {
            last_error: 'Push delivery failed',
          });
          summary.failed += 1;
        }
      }
    }
    return summary;
  }

  async sendTest(subscription: JsonObject): Promise<void> {
    const copy = PUSH_COPY[notificationLocale(subscription.locale)]!;
    await this.send(subscription, {
      title: copy.test_title,
      body: copy.test_body,
      tag: 'parcel-post-ready',
      lang: notificationLocale(subscription.locale),
      data: { url: '/' },
    });
  }

  async send(row: JsonObject, payload?: JsonObject): Promise<void> {
    await webpush.sendNotification(
      {
        endpoint: stringField(row, 'endpoint'),
        keys: {
          p256dh: stringField(row, 'p256dh'),
          auth: stringField(row, 'auth'),
        },
      },
      JSON.stringify(payload ?? this.payload(row)),
      {
        TTL: 86_400,
        timeout: 15_000,
        vapidDetails: {
          subject: this.subject,
          publicKey: this.publicKey,
          privateKey: this.privateKey,
        },
      },
    );
  }

  payload(row: JsonObject): JsonObject {
    const locale = notificationLocale(row.locale);
    const copy = PUSH_COPY[locale]!;
    const packageId = stringField(row, 'package_id');
    return {
      title: notificationText(row.label || copy.update, 80),
      body: notificationBody(row, copy, locale, this.now()),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: `parcel-${packageId}`,
      lang: locale,
      data: { url: `/?parcel=${packageId}` },
    };
  }
}

export class APNsError extends Error {
  constructor(
    readonly statusCode: number,
    readonly reason = '',
  ) {
    super(reason || `APNs returned HTTP ${statusCode}`);
    this.name = 'APNsError';
  }
}

async function postApns(
  host: string,
  path: string,
  headers: Record<string, string>,
  payload: JsonObject,
  timeoutMs: number,
): Promise<{ status: number; reason: string }> {
  return await new Promise((resolve, reject) => {
    const session = connect(`https://${host}`);
    const finish = (error?: Error) => {
      session.close();
      if (error) reject(error);
    };
    const timeout = setTimeout(() => {
      session.destroy();
      reject(new Error('APNs request timed out'));
    }, timeoutMs);
    session.once('error', (error) => {
      clearTimeout(timeout);
      finish(error);
    });
    const request = session.request({
      [http2Constants.HTTP2_HEADER_METHOD]: 'POST',
      [http2Constants.HTTP2_HEADER_PATH]: path,
      ...headers,
    });
    let status = 0;
    const chunks: Buffer[] = [];
    let length = 0;
    request.on('response', (responseHeaders) => {
      status = Number(responseHeaders[http2Constants.HTTP2_HEADER_STATUS] ?? 0);
    });
    request.on('data', (chunk: Buffer) => {
      length += chunk.byteLength;
      if (length <= 65_536) chunks.push(chunk);
      else request.close(http2Constants.NGHTTP2_CANCEL);
    });
    request.once('error', (error) => {
      clearTimeout(timeout);
      finish(error);
    });
    request.once('end', () => {
      clearTimeout(timeout);
      let reason = '';
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (isRecord(body) && typeof body.reason === 'string') reason = body.reason;
      } catch {
        // APNs error bodies are best effort; status remains authoritative.
      }
      session.close();
      resolve({ status, reason });
    });
    request.end(JSON.stringify(payload));
  });
}

export class NativePushNotificationService {
  static readonly EXPIRED_REASONS = new Set([
    'BadDeviceToken',
    'DeviceTokenNotForTopic',
    'Unregistered',
  ]);

  #privateKey: KeyObject;
  #cachedToken: { token: string; issuedAt: number } | null = null;

  constructor(
    readonly client: SupabaseServiceClient,
    readonly teamId: string,
    readonly keyId: string,
    privateKey: string,
    readonly bundleId: string,
    readonly now: () => number = () => Date.now() / 1_000,
  ) {
    try {
      const key = createPrivateKey(privateKey.replaceAll('\\n', '\n').trim());
      if (
        key.asymmetricKeyType !== 'ec'
        || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
      ) throw new TypeError('APNS_PRIVATE_KEY must be a P-256 private key');
      this.#privateKey = key;
    } catch (error) {
      throw new TypeError('APNS_PRIVATE_KEY must be a P-256 private key', { cause: error });
    }
  }

  async dispatch(signal?: AbortSignal): Promise<PushSummary> {
    signal?.throwIfAborted();
    const grouped = new Map<string, JsonObject[]>();
    for (const row of await this.client.listPendingNativePushNotifications()) {
      const key = JSON.stringify([stringField(row, 'device_id'), stringField(row, 'package_id')]);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    const summary = emptySummary();
    for (const events of grouped.values()) {
      signal?.throwIfAborted();
      const newest = [...events].sort(compareNotificationEvents)[0]!;
      const deviceId = stringField(newest, 'device_id');
      if (newest.live_activity_delivered === true) {
        await this.client.recordNativePushDeliveries(
          deviceId,
          events.map((event) => stringField(event, 'event_id')).filter(Boolean),
        );
        continue;
      }
      summary.attempted += 1;
      try {
        await this.send(newest);
        signal?.throwIfAborted();
        await this.client.recordNativePushDeliveries(
          deviceId,
          events.map((event) => stringField(event, 'event_id')).filter(Boolean),
        );
        await this.client.updateNativePushDevice(deviceId, {
          last_success_at: new Date().toISOString(),
          last_error: null,
        });
        summary.sent += 1;
      } catch (error) {
        signal?.throwIfAborted();
        if (this.isExpired(error)) {
          await this.client.updateNativePushDevice(deviceId, {
            disabled_at: new Date().toISOString(),
            last_error: 'APNs device token expired',
          });
          summary.expired += 1;
        } else {
          await this.client.updateNativePushDevice(deviceId, {
            last_error: 'APNs delivery failed',
          });
          summary.failed += 1;
        }
      }
    }
    return summary;
  }

  async sendTest(device: JsonObject): Promise<void> {
    const copy = this.copy(device);
    await this.send(device, this.payload(copy.test_title!, copy.test_body!, null));
  }

  async send(row: JsonObject, payload?: JsonObject): Promise<void> {
    const environment = stringField(row, 'environment') || 'production';
    const host = environment === 'development'
      ? 'api.sandbox.push.apple.com'
      : 'api.push.apple.com';
    const packageId = stringField(row, 'package_id');
    const headers: Record<string, string> = {
      authorization: `bearer ${await this.providerToken()}`,
      'apns-topic': this.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(this.now()) + 86_400),
      'content-type': 'application/json',
    };
    const collapseId = packageId || (row.friend_id ? `friend-${String(row.friend_id)}` : '');
    if (collapseId) headers['apns-collapse-id'] = collapseId.slice(0, 64);
    const response = await postApns(
      host,
      `/3/device/${stringField(row, 'token')}`,
      headers,
      payload ?? this.eventPayload(row),
      15_000,
    );
    if (response.status !== 200) throw new APNsError(response.status, response.reason);
  }

  eventPayload(row: JsonObject): JsonObject {
    const locale = this.locale(row);
    const copy = this.copy(row);
    return this.payload(
      notificationText(row.label || copy.update, 80),
      notificationBody(row, copy, locale, this.now() * 1_000),
      stringField(row, 'package_id'),
    );
  }

  payload(title: string, body: string, parcelId: string | null): JsonObject {
    const aps: JsonObject = {
      alert: { title, body },
      sound: 'default',
      badge: 1,
    };
    const payload: JsonObject = { aps };
    if (parcelId) {
      aps['thread-id'] = parcelId;
      payload.parcel_id = parcelId;
    }
    return payload;
  }

  copy(row: JsonObject): Record<string, string> {
    return PUSH_COPY[this.locale(row)] ?? PUSH_COPY.en!;
  }

  locale(row: JsonObject): string {
    return notificationLocale(stringField(row, 'locale'));
  }

  async providerToken(): Promise<string> {
    const issuedAt = Math.floor(this.now());
    if (this.#cachedToken && issuedAt - this.#cachedToken.issuedAt < 50 * 60) {
      return this.#cachedToken.token;
    }
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId })
      .setIssuer(this.teamId)
      .setIssuedAt(issuedAt)
      .sign(this.#privateKey);
    this.#cachedToken = { token, issuedAt };
    return token;
  }

  isExpired(error: unknown): boolean {
    return error instanceof APNsError
      && (error.statusCode === 410 || NativePushNotificationService.EXPIRED_REASONS.has(error.reason));
  }
}

type LiveActivityDeliveryKind = 'start' | 'update' | 'end';

const LIVE_ACTIVITY_PHASES = new Set([
  'out_for_delivery',
  'delivered',
  'failed_attempt',
  'ready_for_pickup',
  'returned',
]);

export class DeliveryLiveActivityNotificationService {
  constructor(
    readonly client: SupabaseServiceClient,
    readonly apns: NativePushNotificationService,
  ) {}

  async dispatch(signal?: AbortSignal): Promise<PushSummary> {
    signal?.throwIfAborted();
    const grouped = new Map<string, JsonObject[]>();
    for (const row of await this.client.listPendingLiveActivityEvents()) {
      const key = JSON.stringify([stringField(row, 'device_id'), stringField(row, 'package_id')]);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    const summary = emptySummary();
    for (const events of grouped.values()) {
      signal?.throwIfAborted();
      const newest = [...events].sort(compareNotificationEvents)[0]!;
      const kind = this.deliveryKind(newest);
      if (!kind) continue;
      const deviceId = stringField(newest, 'device_id');
      const updateTokenId = stringField(newest, 'update_token_id');
      summary.attempted += 1;
      try {
        await this.send(newest, kind);
        signal?.throwIfAborted();
        await this.client.recordLiveActivityDeliveries(events.map((event) => ({
          deviceId,
          eventId: stringField(event, 'event_id'),
          packageId: stringField(event, 'package_id'),
          deliveryKind: kind,
          eventCreatedAt: stringField(event, 'event_created_at'),
        })));
        if (kind === 'end' && updateTokenId) {
          await this.client.deleteLiveActivityTokenById(updateTokenId);
        } else if (updateTokenId) {
          await this.client.updateLiveActivityToken(updateTokenId, {
            last_success_at: new Date().toISOString(),
            last_error: null,
          });
        } else {
          await this.client.updateLiveActivityDevice(deviceId, {
            last_success_at: new Date().toISOString(),
            last_error: null,
          });
        }
        summary.sent += 1;
      } catch (error) {
        signal?.throwIfAborted();
        if (this.apns.isExpired(error)) {
          if (updateTokenId) await this.client.deleteLiveActivityTokenById(updateTokenId);
          else {
            await this.client.updateLiveActivityDevice(deviceId, {
              disabled_at: new Date().toISOString(),
              last_error: 'ActivityKit token expired',
            });
          }
          summary.expired += 1;
        } else {
          if (updateTokenId) {
            await this.client.updateLiveActivityToken(updateTokenId, {
              last_error: 'Live Activity delivery failed',
            });
          } else {
            await this.client.updateLiveActivityDevice(deviceId, {
              last_error: 'Live Activity delivery failed',
            });
          }
          summary.failed += 1;
        }
      }
    }
    return summary;
  }

  deliveryKind(row: JsonObject): LiveActivityDeliveryKind | null {
    const hasUpdateToken = Boolean(stringField(row, 'update_token'));
    if (stringField(row, 'stage') === 'out_for_delivery') {
      return hasUpdateToken ? 'update' : 'start';
    }
    return hasUpdateToken ? 'end' : null;
  }

  async send(row: JsonObject, kind = this.deliveryKind(row)): Promise<void> {
    if (!kind) return;
    const environment = stringField(row, 'environment') || 'production';
    const host = environment === 'development'
      ? 'api.sandbox.push.apple.com'
      : 'api.push.apple.com';
    const token = kind === 'start'
      ? stringField(row, 'push_to_start_token')
      : stringField(row, 'update_token');
    const response = await postApns(
      host,
      `/3/device/${token}`,
      {
        authorization: `bearer ${await this.apns.providerToken()}`,
        'apns-topic': `${this.apns.bundleId}.push-type.liveactivity`,
        'apns-push-type': 'liveactivity',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(this.apns.now()) + 3_600),
        'content-type': 'application/json',
      },
      this.payload(row, kind),
      15_000,
    );
    if (response.status !== 200) throw new APNsError(response.status, response.reason);
  }

  payload(row: JsonObject, kind: LiveActivityDeliveryKind): JsonObject {
    const timestamp = Math.floor(this.apns.now());
    const parcelId = stringField(row, 'package_id');
    const locale = this.apns.locale(row);
    const copy = this.apns.copy(row);
    const stage = stringField(row, 'stage');
    const status = copy[stage] ?? copy.update!;
    const expected = notificationExpectedDelivery(
      row.expected_delivery,
      locale,
      stringField(row, 'timezone') || 'Europe/Zurich',
      timestamp * 1_000,
    );
    const phase = LIVE_ACTIVITY_PHASES.has(stage) ? stage : 'ended';
    const contentState: JsonObject = {
      parcel: {
        id: parcelId,
        label: notificationText(row.label || copy.update, 80),
        carrier: notificationText(carrierDisplayName(row.carrier), 80),
        status: notificationText(status, 80),
        // Older app versions already suppress a detail equal to the status.
        detail: notificationText(stage === 'out_for_delivery' && expected && expected !== copy.today
          ? expected : status, 100),
        phase,
      },
      languageCode: locale,
    };
    const aps: JsonObject = {
      timestamp,
      event: kind,
      'content-state': contentState,
      'relevance-score': stage === 'out_for_delivery' ? 0.8 : 1,
    };
    if (kind === 'start') {
      aps['attributes-type'] = 'DeliveryActivityAttributes';
      aps.attributes = { parcelID: parcelId };
      aps['input-push-token'] = 1;
      aps['stale-date'] = timestamp + 30 * 60;
      aps.alert = {
        title: notificationText(row.label || copy.update, 80),
        body: notificationBody(row, copy, locale, timestamp * 1_000),
      };
    } else if (kind === 'update') {
      aps['stale-date'] = timestamp + 30 * 60;
    } else {
      const graceSeconds = stage === 'failed_attempt' || stage === 'ready_for_pickup'
        ? 60 * 60
        : LIVE_ACTIVITY_PHASES.has(stage) ? 30 * 60 : -1;
      aps['dismissal-date'] = timestamp + graceSeconds;
      aps.alert = {
        title: notificationText(row.label || copy.update, 80),
        body: notificationBody(row, copy, locale, timestamp * 1_000),
      };
    }
    return { aps };
  }
}

export class CompositePushNotificationService {
  constructor(
    readonly web: WebPushNotificationService | null,
    readonly native: NativePushNotificationService | null,
    readonly liveActivities: DeliveryLiveActivityNotificationService | null,
  ) {}

  async dispatch(signal?: AbortSignal): Promise<PushSummary> {
    signal?.throwIfAborted();
    const combined = emptySummary();
    for (const service of [this.liveActivities, this.web, this.native]) {
      if (!service) continue;
      const summary = await service.dispatch(signal);
      combined.attempted += summary.attempted;
      combined.sent += summary.sent;
      combined.failed += summary.failed;
      combined.expired += summary.expired;
    }
    return combined;
  }
}

interface PushRuntime {
  signature: string;
  client: SupabaseServiceClient;
  service: CompositePushNotificationService;
}

const globalPush = globalThis as typeof globalThis & {
  __deliveryPushRuntime?: PushRuntime;
};

export function pushServices(client: SupabaseServiceClient): CompositePushNotificationService {
  const webValues = {
    publicKey: process.env.VAPID_PUBLIC_KEY?.trim() ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY?.trim() ?? '',
    subject: process.env.VAPID_SUBJECT?.trim() || 'https://delivery.plhery.com',
  };
  const nativeValues = {
    teamId: process.env.APNS_TEAM_ID?.trim() ?? '',
    keyId: process.env.APNS_KEY_ID?.trim() ?? '',
    privateKey: process.env.APNS_PRIVATE_KEY?.trim() ?? '',
    bundleId: process.env.APNS_BUNDLE_ID?.trim() ?? '',
  };
  if (Boolean(webValues.publicKey) !== Boolean(webValues.privateKey)) {
    throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together');
  }
  if (Object.values(nativeValues).some(Boolean) && !Object.values(nativeValues).every(Boolean)) {
    throw new Error('APNS_TEAM_ID, APNS_KEY_ID, APNS_PRIVATE_KEY and APNS_BUNDLE_ID are all required');
  }
  const signature = JSON.stringify([webValues, nativeValues]);
  if (
    globalPush.__deliveryPushRuntime?.signature !== signature
    || globalPush.__deliveryPushRuntime.client !== client
  ) {
    let web: WebPushNotificationService | null = null;
    if (webValues.publicKey && webValues.privateKey) {
      try {
        webpush.getVapidHeaders(
          'https://push.example.test',
          webValues.subject,
          webValues.publicKey,
          webValues.privateKey,
          'aes128gcm',
        );
      } catch (error) {
        throw new Error('VAPID keys are invalid', { cause: error });
      }
      web = new WebPushNotificationService(
        client,
        webValues.publicKey,
        webValues.privateKey,
        webValues.subject,
      );
    }
    const native = Object.values(nativeValues).every(Boolean)
      ? new NativePushNotificationService(
          client,
          nativeValues.teamId,
          nativeValues.keyId,
          nativeValues.privateKey,
          nativeValues.bundleId,
        )
      : null;
    globalPush.__deliveryPushRuntime = {
      signature,
      client,
      service: new CompositePushNotificationService(
        web,
        native,
        native ? new DeliveryLiveActivityNotificationService(client, native) : null,
      ),
    };
  }
  return globalPush.__deliveryPushRuntime.service;
}

export function pushConfigurationError(error: unknown): Error {
  return new Error(`Push notification configuration failed: ${errorMessage(error)}`, {
    cause: error,
  });
}
