import { AMAZON_ACCOUNT_MESSAGE, isAmazonTrackingNumber, requiresAmazonAccount } from '../lib/amazon';
import { CARRIER_IDS, type ApiGiftWords, type ApiParcelAlertPreset } from '../generated/apiContract';
import { validTrackingNumber } from '../lib/carriers';
import { ALERT_PRESET_STAGES, ALL_NOTIFICATION_STAGES } from '../lib/notificationPresets';
import { createECDH } from 'node:crypto';
import { HttpError, parseUuid } from './api';
import { normalizeCarrierInputs } from './carriers';
import { isRecord, type JsonObject } from './types';

const VALID_CARRIERS = new Set<string>(CARRIER_IDS);
const NOTIFICATION_STAGES = new Set<string>(ALL_NOTIFICATION_STAGES);
const PUSH_ENDPOINT_HOSTS = new Set([
  'android.googleapis.com',
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);
const PUSH_ENDPOINT_HOST_SUFFIXES = ['.notify.windows.com'];

function codePointLength(value: string): number {
  return [...value].length;
}

export interface NewPackageValues {
  trackingNumber: string;
  label: string;
  carrier: string;
  trackingUrl: string | null;
  dpdPostcode: string | null;
}

export type PackageCarrierValues = Pick<
  NewPackageValues,
  'carrier' | 'trackingUrl' | 'dpdPostcode'
>;

export function newPackageValues(payload: JsonObject): NewPackageValues {
  const rawTracking = payload.trackingNumber ?? '';
  const rawLabel = payload.label ?? '';
  const rawCarrier = payload.carrier ?? 'unknown';
  const rawTrackingUrl = payload.trackingUrl ?? '';
  const rawDpdPostcode = payload.dpdPostcode ?? '';
  if (
    typeof rawTracking !== 'string'
    || typeof rawLabel !== 'string'
    || typeof rawCarrier !== 'string'
    || typeof rawTrackingUrl !== 'string'
    || typeof rawDpdPostcode !== 'string'
  ) {
    throw new HttpError(
      400,
      'Tracking number, label, carrier, tracking URL and postcode must be text',
    );
  }
  const trackingNumber = rawTracking.replace(/[\s.-]/g, '').toUpperCase();
  if (trackingNumber.length < 4 || trackingNumber.length > 40) {
    throw new HttpError(400, 'Enter a tracking number between 4 and 40 characters');
  }
  // The scraper decides what a number may be: a digit, or letters alone in a shape a carrier issues.
  if (!/^(?:[A-Z0-9]+|\d{4}\/\d{8})$/.test(trackingNumber) || !validTrackingNumber(rawTracking)) {
    throw new HttpError(400, 'Tracking numbers use letters and numbers and include a digit, unless a carrier issues them as letters alone');
  }
  if (codePointLength(rawLabel) > 80) {
    throw new HttpError(400, 'Parcel names can be at most 80 characters');
  }
  let carrier = rawCarrier;
  if (!VALID_CARRIERS.has(carrier)) throw new HttpError(400, 'Choose a supported carrier');
  if (carrier === 'amazon-shipping' && !isAmazonTrackingNumber(trackingNumber)) throw new HttpError(400, 'Invalid Amazon tracking number');
  if (requiresAmazonAccount(carrier, trackingNumber)) throw new HttpError(400, AMAZON_ACCOUNT_MESSAGE);
  if (/^44\d{16}$/.test(trackingNumber)) carrier = 'quickpac';
  let extras: ReturnType<typeof normalizeCarrierInputs>;
  try {
    extras = normalizeCarrierInputs(
      carrier,
      trackingNumber,
      rawTrackingUrl,
      rawDpdPostcode,
    );
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid carrier details', undefined, {
      cause: error,
    });
  }
  return {
    trackingNumber,
    label: rawLabel.trim(),
    carrier,
    ...extras,
  };
}

export function packageCarrierValues(
  payload: JsonObject,
  trackingNumber: string,
): PackageCarrierValues {
  if (typeof payload.carrier !== 'string') {
    throw new HttpError(400, 'Carrier must be text');
  }
  const values = newPackageValues({
    trackingNumber,
    label: '',
    carrier: payload.carrier,
    trackingUrl: payload.trackingUrl ?? '',
    dpdPostcode: payload.dpdPostcode ?? '',
  });
  return {
    carrier: values.carrier,
    trackingUrl: values.trackingUrl,
    dpdPostcode: values.dpdPostcode,
  };
}

export function packageLabel(payload: JsonObject): string {
  if (typeof payload.label !== 'string') throw new HttpError(400, 'Parcel name must be text');
  if (codePointLength(payload.label) > 80) {
    throw new HttpError(400, 'Parcel names can be at most 80 characters');
  }
  return payload.label.trim();
}

export function pushEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
    throw new HttpError(400, 'Send a valid push endpoint');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new HttpError(400, 'Send a valid push endpoint', undefined, { cause: error });
  }
  const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
  const allowed = PUSH_ENDPOINT_HOSTS.has(hostname)
    || PUSH_ENDPOINT_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  if (
    url.protocol !== 'https:'
    || !allowed
    || (url.port && url.port !== '443')
    || url.username
    || url.password
    || url.hash
  ) throw new HttpError(400, 'Send a valid push endpoint');
  return value;
}

function decodeBase64Url(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HttpError(400, 'Send valid push encryption keys');
  }
  try {
    return Buffer.from(value, 'base64url');
  } catch (error) {
    throw new HttpError(400, 'Send valid push encryption keys', undefined, { cause: error });
  }
}

export function pushSubscription(payload: JsonObject): {
  endpoint: string;
  p256dh: string;
  auth: string;
  locale?: NativePushLocale;
} {
  const endpoint = pushEndpoint(payload.endpoint);
  if (typeof payload.keys !== 'object' || payload.keys === null || Array.isArray(payload.keys)) {
    throw new HttpError(400, 'Send valid push encryption keys');
  }
  const keys = payload.keys as JsonObject;
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
    throw new HttpError(400, 'Send valid push encryption keys');
  }
  const publicKey = decodeBase64Url(keys.p256dh);
  const authSecret = decodeBase64Url(keys.auth);
  if (publicKey.length !== 65 || publicKey[0] !== 4 || authSecret.length !== 16) {
    throw new HttpError(400, 'Send valid push encryption keys');
  }
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth,
    ...(payload.locale == null ? {} : { locale: nativePushLocale(payload.locale) }) };
}

export interface ParcelAlertValues {
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: NativePushLocale;
  preset: ApiParcelAlertPreset;
}

/**
 * An alert for a parcel link: the browser's subscription, checked as an
 * account's is, what to announce and in which language. The key must also be a
 * point of the curve, so a made-up one is refused here and not at every send.
 */
export function parcelAlert(payload: JsonObject): ParcelAlertValues {
  if (!isRecord(payload.subscription)) throw new HttpError(400, 'Send a valid push subscription');
  const { endpoint, p256dh, auth } = pushSubscription({
    endpoint: payload.subscription.endpoint, keys: payload.subscription.keys,
  });
  try {
    const exchange = createECDH('prime256v1');
    exchange.generateKeys();
    exchange.computeSecret(Buffer.from(p256dh, 'base64url'));
  } catch (error) {
    throw new HttpError(400, 'Send valid push encryption keys', undefined, { cause: error });
  }
  const preset = payload.preset;
  if (typeof preset !== 'string' || !Object.hasOwn(ALERT_PRESET_STAGES, preset)) {
    throw new HttpError(400, 'Choose what the alert announces');
  }
  return { endpoint, p256dh, auth, locale: nativePushLocale(payload.locale), preset: preset as ApiParcelAlertPreset };
}

/**
 * The switches of a shared link named in `fields`: each true or false when
 * sent, with an optional protected gift message. At least one change is required
 * unless `optional`.
 */
export function shareSwitches<Field extends 'showNumber' | 'gift' | 'shared'>(
  payload: JsonObject,
  fields: readonly Field[],
  optional = false,
): Partial<Record<Field, boolean>> & { giftWords?: ApiGiftWords } {
  const switches: Partial<Record<Field, boolean>> & { giftWords?: ApiGiftWords } = {};
  for (const field of fields) {
    const value = payload[field];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') throw new HttpError(400, `${field} must be true or false`);
    Object.assign(switches, { [field]: value });
  }
  if (payload.giftWords !== undefined) {
    if (!isRecord(payload.giftWords)) throw new HttpError(400, 'giftWords must be an object');
    const words: ApiGiftWords = { name: null, note: null, from: null };
    for (const [field, limit] of [['name', 80], ['note', 280], ['from', 60]] as const) {
      const value = payload.giftWords[field];
      if (value !== null && (typeof value !== 'string' || codePointLength(value) > limit)) {
        throw new HttpError(400, `giftWords.${field} must be text of at most ${limit} characters or null`);
      }
      words[field] = typeof value === 'string'
        ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim() || null : null;
    }
    switches.giftWords = words;
  }
  if (!optional && Object.keys(switches).length === 0) {
    throw new HttpError(400, `Send ${fields.join(', ')} to change`);
  }
  return switches;
}

export function pushSubscriptionLocale(payload: JsonObject): { endpoint: string; locale: NativePushLocale } {
  return { endpoint: pushEndpoint(payload.endpoint), locale: nativePushLocale(payload.locale) };
}

export interface NativePushDeviceValues {
  token: string;
  installationId: string | null;
  environment: 'development' | 'production';
  locale: 'en' | 'de' | 'fr' | 'it' | 'es' | 'pt' | 'pl';
  deviceName: string | null;
  sendTest: boolean;
}

type NativePushEnvironment = NativePushDeviceValues['environment'];
type NativePushLocale = NativePushDeviceValues['locale'];

function apnsToken(value: unknown, label = 'APNs device token'): string {
  if (typeof value !== 'string') throw new HttpError(400, `Send a valid ${label}`);
  const token = value.trim().toLowerCase();
  if (
    token.length < 32
    || token.length > 512
    || token.length % 2 !== 0
    || !/^[0-9a-f]+$/.test(token)
  ) throw new HttpError(400, `Send a valid ${label}`);
  return token;
}

function nativePushEnvironment(value: unknown): NativePushEnvironment {
  if (value !== 'development' && value !== 'production') {
    throw new HttpError(400, 'Choose a valid APNs environment');
  }
  return value;
}

function nativePushLocale(value: unknown): NativePushLocale {
  if (typeof value !== 'string' || !['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'].includes(value)) {
    throw new HttpError(400, 'Choose a supported notification locale');
  }
  return value as NativePushLocale;
}

function installationId(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'Send a valid installation id');
  return parseUuid(value, 'installation id');
}

function liveActivityId(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 128
    || !/^[A-Za-z0-9-]+$/.test(value)
  ) throw new HttpError(400, 'Send a valid Live Activity id');
  return value;
}

export function nativePushDevice(
  payload: JsonObject,
  registration = true,
): NativePushDeviceValues {
  const token = apnsToken(payload.token);
  if (!registration) {
    return {
      token,
      installationId: null,
      environment: 'production',
      locale: 'en',
      deviceName: null,
      sendTest: false,
    };
  }
  const environment = nativePushEnvironment(payload.environment);
  const locale = nativePushLocale(payload.locale);
  const parsedInstallationId = payload.installationId == null
    ? null
    : installationId(payload.installationId);
  if (typeof payload.sendTest !== 'boolean') throw new HttpError(400, 'SendTest must be true or false');
  if (payload.deviceName != null && typeof payload.deviceName !== 'string') {
    throw new HttpError(400, 'Device name must be text');
  }
  const deviceName = typeof payload.deviceName === 'string' ? payload.deviceName.trim() : '';
  if (codePointLength(deviceName) > 100) {
    throw new HttpError(400, 'Device name can be at most 100 characters');
  }
  return {
    token,
    installationId: parsedInstallationId,
    environment,
    locale,
    deviceName: deviceName || null,
    sendTest: payload.sendTest,
  };
}

export interface LiveActivityDeviceValues {
  revocationToken?: string;
  installationId: string;
  token: string;
  environment: NativePushEnvironment;
  locale: NativePushLocale;
}

export function liveActivityDevice(payload: JsonObject): LiveActivityDeviceValues {
  return {
    ...(payload.revocationToken === undefined ? {} : { revocationToken: liveActivityRevocationToken(payload.revocationToken) }),
    installationId: installationId(payload.installationId),
    token: apnsToken(payload.token, 'Live Activity push-to-start token'),
    environment: nativePushEnvironment(payload.environment),
    locale: nativePushLocale(payload.locale),
  };
}

export function deleteLiveActivityDevice(payload: JsonObject): { installationId: string } {
  return { installationId: installationId(payload.installationId) };
}

export interface LiveActivityUpdateTokenValues extends LiveActivityDeviceValues {
  activityId: string;
  parcelId: string;
}

export function liveActivityUpdateToken(payload: JsonObject): LiveActivityUpdateTokenValues {
  if (typeof payload.parcelId !== 'string') throw new HttpError(400, 'Invalid parcel id');
  return {
    ...liveActivityDevice(payload),
    activityId: liveActivityId(payload.activityId),
    parcelId: parseUuid(payload.parcelId, 'parcel id'),
  };
}

export function deleteLiveActivityUpdateToken(payload: JsonObject): {
  installationId: string;
  activityId: string;
} {
  return {
    installationId: installationId(payload.installationId),
    activityId: liveActivityId(payload.activityId),
  };
}

export interface NotificationPreferencesValues {
  enabledStages: string[];
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
  /** The delivery email, switched on or off. Null keeps the stored choice: the request left it out. */
  emailOnDelivery: boolean | null;
}

export function notificationPreferences(payload: JsonObject): NotificationPreferencesValues {
  const rawStages = payload.enabledStages;
  if (
    !Array.isArray(rawStages)
    || rawStages.length === 0
    || rawStages.length > NOTIFICATION_STAGES.size
    || rawStages.some((stage) => typeof stage !== 'string')
  ) throw new HttpError(400, 'Choose at least one notification event');
  const enabledStages = rawStages as string[];
  if (
    new Set(enabledStages).size !== enabledStages.length
    || enabledStages.some((stage) => !NOTIFICATION_STAGES.has(stage))
  ) throw new HttpError(400, 'Choose valid notification events');
  const quietHoursStart = payload.quietHoursStart;
  const quietHoursEnd = payload.quietHoursEnd;
  if ((quietHoursStart == null) !== (quietHoursEnd == null)) {
    throw new HttpError(400, 'Set both quiet-hour times or turn quiet hours off');
  }
  for (const value of [quietHoursStart, quietHoursEnd]) {
    if (value != null && (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))) {
      throw new HttpError(400, 'Use valid quiet-hour times');
    }
  }
  if (quietHoursStart != null && quietHoursStart === quietHoursEnd) {
    throw new HttpError(400, 'Quiet hours must have different start and end times');
  }
  if (typeof payload.timezone !== 'string' || payload.timezone.length < 1 || payload.timezone.length > 64) {
    throw new HttpError(400, 'Use a valid timezone');
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: payload.timezone }).format();
  } catch (error) {
    throw new HttpError(400, 'Use a valid timezone', undefined, { cause: error });
  }
  // Apps from before the delivery email send neither field; `emailAvailable` is the server's to say.
  const emailOnDelivery = payload.emailOnDelivery ?? null;
  if (emailOnDelivery !== null && typeof emailOnDelivery !== 'boolean') {
    throw new HttpError(400, 'Email on delivery must be true or false');
  }
  return {
    enabledStages,
    quietHoursStart: quietHoursStart as string | null,
    quietHoursEnd: quietHoursEnd as string | null,
    timezone: payload.timezone,
    emailOnDelivery,
  };
}

/** The preferences as stored, and whether this server can email the account at all. */
export function notificationPreferencesResponse(row: JsonObject, emailAvailable: boolean): JsonObject {
  const shortTime = (value: unknown) => typeof value === 'string' ? value.slice(0, 5) : null;
  return {
    enabledStages: Array.isArray(row.enabled_stages) ? row.enabled_stages : [],
    quietHoursStart: shortTime(row.quiet_hours_start),
    quietHoursEnd: shortTime(row.quiet_hours_end),
    timezone: typeof row.timezone === 'string' ? row.timezone : 'Europe/Zurich',
    emailOnDelivery: typeof row.email_on_delivery === 'boolean' ? row.email_on_delivery : null,
    emailAvailable,
  };
}

/** What to change about one parcel's notifications and delivery email: one of them, or both. */
export function packageNotificationValues(payload: JsonObject): { muted?: boolean; emailMuted?: boolean } {
  const { muted, emailMuted } = payload;
  if (muted !== undefined && typeof muted !== 'boolean') throw new HttpError(400, 'Muted must be true or false');
  if (emailMuted !== undefined && typeof emailMuted !== 'boolean') {
    throw new HttpError(400, 'Email muted must be true or false');
  }
  if (muted === undefined && emailMuted === undefined) {
    throw new HttpError(400, 'Muted or emailMuted must be true or false');
  }
  return { ...(muted === undefined ? {} : { muted }), ...(emailMuted === undefined ? {} : { emailMuted }) };
}

/** The token and the wanted state from the page an email links to. A switch left out turns the email off. */
export function deliveryEmailSwitch(payload: JsonObject): { token: unknown; enabled: boolean } {
  if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') {
    throw new HttpError(400, 'Enabled must be true or false');
  }
  return { token: payload.token, enabled: payload.enabled === true };
}

export function syncJobResponse(row: JsonObject): JsonObject {
  return {
    id: row.id ?? null,
    status: row.state ?? null,
    packageId: row.package_id ?? null,
    requestedAt: row.requested_at ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    result: row.result ?? null,
    error: row.last_error ?? null,
  };
}

export function liveActivityRevocationToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new HttpError(400, 'Invalid Live Activity revocation proof');
  }
  return value;
}
