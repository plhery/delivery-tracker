import { EVENT_STAGE_ORDER } from '../lib/stages';
import 'server-only';

import { connect, constants as http2Constants } from 'node:http2';
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { SignJWT } from 'jose';
import { DateTime, IANAZone } from 'luxon';
import webpush from 'web-push';
import { CARRIER_CAPABILITIES, type ApiParcelAlertPreset } from '../generated/apiContract';
import { isLocale, type Locale } from '../lib/locale';
import { languageTags } from '../lib/messages';
import { ALERT_PRESET_STAGES } from '../lib/notificationPresets';
import { capitalized } from '../peek/parcel/summary';
import { recordParcelAlertRemoved, recordParcelAlertSent } from './metrics';
import { logOperationalEvent } from './observability';
import { relayRepeats } from './relayCopies';
import { messagesFor } from './requestLocale';
import type { SupabaseServiceClient } from './supabase';
import { errorMessage, isRecord, type JsonObject } from './types';

/**
 * What a notification says beyond the app's own words for a parcel's stages.
 * Its title is the news; the line under it names the parcel, then says when it
 * arrives or what the step means. Those sentences start in lower case where
 * their language allows, and are capitalised when no name comes before them.
 * Nothing assumes the reader is the recipient: an account also follows the
 * parcels it sends.
 */
const PUSH_COPY: Record<Locale, Record<string, string>> = {
  en: {
    test_title: 'You’ll hear from Peek',
    test_body: 'This device gets a ping for the steps you chose. Change them anytime in Settings.',
    friend_title: '{{name}} is in',
    friend_body: 'Your passports are side by side now. Have a peek.',
    update: 'Parcel update',
    title_registered: 'Announced by the sender',
    title_in_transit: 'On its way',
    title_ready_for_pickup: 'Ready to collect',
    title_delivered: 'It’s arrived',
    title_failed_attempt: 'Delivery missed',
    title_returned: 'On its way back',
    body_update: 'tap to see what’s new',
    body_pending: 'waiting for the carrier’s first scan',
    body_registered: 'the carrier doesn’t have it yet',
    body_accepted: 'off it goes',
    body_in_transit: 'one step closer',
    body_customs: 'Peek is keeping an eye on it',
    body_exception: 'the carrier flagged a problem. Tap to see what to do.',
    body_out_for_delivery: 'almost there',
    body_ready_for_pickup: 'waiting at the pickup point',
    body_delivered: 'delivered',
    body_failed_attempt: 'the carrier couldn’t deliver it. Tap to see what happens next.',
    body_returned: 'returning to the sender',
    delivered_time: 'delivered at {{time}}',
    delivered_date: 'delivered on {{date}} at {{time}}',
    eta_day: 'arriving {{date}}',
    eta_date: 'arriving {{date}}',
    eta_changed_day: 'now arriving {{date}}',
    eta_changed_date: 'now arriving {{date}}',
  },
  de: {
    test_title: 'Peek meldet sich bei dir',
    test_body: 'Dieses Gerät bekommt Meldungen für die Schritte, die du gewählt hast. Ändern kannst du sie jederzeit in den Einstellungen.',
    friend_title: '{{name}} ist dabei',
    friend_body: 'Eure Reisepässe liegen jetzt nebeneinander. Wirf einen Blick drauf.',
    update: 'Neues vom Paket',
    title_registered: 'Vom Absender angekündigt',
    title_in_transit: 'Unterwegs',
    title_ready_for_pickup: 'Abholbereit',
    title_delivered: 'Angekommen',
    title_failed_attempt: 'Zustellung nicht geklappt',
    title_returned: 'Auf dem Rückweg',
    body_update: 'tippe, um zu sehen, was sich getan hat',
    body_pending: 'wartet auf den ersten Scan des Paketdienstes',
    body_registered: 'der Paketdienst hat es noch nicht',
    body_accepted: 'und los geht’s',
    body_in_transit: 'wieder ein Stück näher',
    body_customs: 'Peek behält es im Auge',
    body_exception: 'tippe, um zu sehen, was zu tun ist',
    body_out_for_delivery: 'fast da',
    body_ready_for_pickup: 'wartet am Abholort',
    body_delivered: 'zugestellt',
    body_failed_attempt: 'der Paketdienst konnte es nicht zustellen. Tippe, um zu sehen, wie es weitergeht.',
    body_returned: 'geht zurück an den Absender',
    delivered_time: 'um {{time}} Uhr zugestellt',
    delivered_date: 'am {{date}} um {{time}} Uhr zugestellt',
    eta_day: 'kommt {{date}}',
    eta_date: 'kommt am {{date}}',
    eta_changed_day: 'neuer Liefertermin: {{date}}',
    eta_changed_date: 'neuer Liefertermin: {{date}}',
  },
  fr: {
    test_title: 'Peek te tient au courant',
    test_body: 'Cet appareil reçoit des alertes pour les étapes que tu as choisies. Change-les quand tu veux dans les réglages.',
    friend_title: '{{name}} est de la partie',
    friend_body: 'Vos passeports sont maintenant côte à côte. Jette un œil.',
    update: 'Des nouvelles du colis',
    title_registered: 'Annoncé par l’expéditeur',
    title_in_transit: 'En route',
    title_ready_for_pickup: 'Prêt à être retiré',
    title_delivered: 'Bien arrivé',
    title_failed_attempt: 'Livraison manquée',
    title_returned: 'Sur le chemin du retour',
    body_update: 'touche pour voir ce qui a changé',
    body_pending: 'en attente du premier scan du transporteur',
    body_registered: 'le transporteur ne l’a pas encore reçu',
    body_accepted: 'c’est parti',
    body_in_transit: 'il se rapproche',
    body_customs: 'Peek garde un œil dessus',
    body_exception: 'touche pour savoir quoi faire',
    body_out_for_delivery: 'presque arrivé',
    body_ready_for_pickup: 'il attend au point de retrait',
    body_delivered: 'livré',
    body_failed_attempt: 'le transporteur n’a pas pu le livrer. Touche pour voir la suite.',
    body_returned: 'il repart chez l’expéditeur',
    delivered_time: 'livré à {{time}}',
    delivered_date: 'livré le {{date}} à {{time}}',
    eta_day: 'arrive {{date}}',
    eta_date: 'arrive le {{date}}',
    eta_changed_day: 'arrive finalement {{date}}',
    eta_changed_date: 'arrive finalement le {{date}}',
  },
  it: {
    test_title: 'Peek ti terrà al corrente',
    test_body: 'Questo dispositivo riceve gli avvisi per i passaggi che hai scelto. Puoi cambiarli quando vuoi nelle impostazioni.',
    friend_title: '{{name}} è dei nostri',
    friend_body: 'I vostri passaporti ora sono fianco a fianco. Dai un’occhiata.',
    update: 'Novità sul pacco',
    title_registered: 'Annunciato dal mittente',
    title_in_transit: 'In viaggio',
    title_ready_for_pickup: 'Pronto per il ritiro',
    title_delivered: 'È arrivato',
    title_failed_attempt: 'Consegna mancata',
    title_returned: 'Sulla via del ritorno',
    body_update: 'tocca per vedere cos’è cambiato',
    body_pending: 'in attesa della prima scansione del corriere',
    body_registered: 'il corriere non ce l’ha ancora',
    body_accepted: 'si parte',
    body_in_transit: 'un passo più vicino',
    body_customs: 'Peek lo tiene d’occhio',
    body_exception: 'tocca per vedere cosa fare',
    body_out_for_delivery: 'ci siamo quasi',
    body_ready_for_pickup: 'in attesa al punto di ritiro',
    body_delivered: 'consegnato',
    body_failed_attempt: 'il corriere non è riuscito a consegnarlo. Tocca per vedere cosa succede ora.',
    body_returned: 'sta tornando al mittente',
    delivered_time: 'consegnato alle {{time}}',
    delivered_date: 'consegnato il giorno {{date}} alle {{time}}',
    eta_day: 'arriva {{date}}',
    eta_date: 'arrivo previsto: {{date}}',
    eta_changed_day: 'ora arriva {{date}}',
    eta_changed_date: 'nuova data prevista: {{date}}',
  },
  es: {
    test_title: 'Peek te mantendrá al tanto',
    test_body: 'Este dispositivo recibe avisos de los pasos que has elegido. Cámbialos cuando quieras en los ajustes.',
    friend_title: '{{name}} se apunta',
    friend_body: 'Vuestros pasaportes ya están uno al lado del otro. Echa un vistazo.',
    update: 'Novedades del paquete',
    title_registered: 'Anunciado por el remitente',
    title_in_transit: 'En camino',
    title_ready_for_pickup: 'Listo para recoger',
    title_delivered: 'Ha llegado',
    title_failed_attempt: 'Entrega fallida',
    title_returned: 'Camino de vuelta',
    body_update: 'toca para ver qué hay de nuevo',
    body_pending: 'esperando el primer escaneo del transportista',
    body_registered: 'el transportista aún no lo tiene',
    body_accepted: 'en marcha',
    body_in_transit: 'un paso más cerca',
    body_customs: 'Peek no lo pierde de vista',
    body_exception: 'toca para ver qué hacer',
    body_out_for_delivery: 'ya casi está',
    body_ready_for_pickup: 'esperando en el punto de recogida',
    body_delivered: 'entregado',
    body_failed_attempt: 'el transportista no ha podido entregarlo. Toca para ver qué pasa ahora.',
    body_returned: 'se devuelve al remitente',
    delivered_time: 'entregado a las {{time}}',
    delivered_date: 'entregado el {{date}} a las {{time}}',
    eta_day: 'llega {{date}}',
    eta_date: 'llega el {{date}}',
    eta_changed_day: 'ahora llega {{date}}',
    eta_changed_date: 'ahora llega el {{date}}',
  },
  pt: {
    test_title: 'O Peek vai dando notícias',
    test_body: 'Este dispositivo recebe alertas para os passos que escolheste. Podes alterá-los quando quiseres nas definições.',
    friend_title: '{{name}} juntou-se a ti',
    friend_body: 'Os vossos passaportes já estão lado a lado. Dá uma espreitadela.',
    update: 'Atualização do envio',
    title_registered: 'Anunciado pelo remetente',
    title_in_transit: 'A caminho',
    title_ready_for_pickup: 'Pronto para levantamento',
    title_delivered: 'Chegou',
    title_failed_attempt: 'Entrega falhada',
    title_returned: 'De regresso',
    body_update: 'toca para ver as novidades',
    body_pending: 'à espera da primeira leitura da transportadora',
    body_registered: 'a transportadora ainda não o tem',
    body_accepted: 'a viagem começou',
    body_in_transit: 'um passo mais perto',
    body_customs: 'o Peek está de olho nele',
    body_exception: 'toca para ver o que fazer',
    body_out_for_delivery: 'quase a chegar',
    body_ready_for_pickup: 'à espera no ponto de recolha',
    body_delivered: 'entregue',
    body_failed_attempt: 'a transportadora não conseguiu entregá-lo. Toca para ver o que se segue.',
    body_returned: 'a ser devolvido ao remetente',
    delivered_time: 'entregue às {{time}}',
    delivered_date: 'entregue a {{date}} às {{time}}',
    eta_day: 'chega {{date}}',
    eta_date: 'chega a {{date}}',
    eta_changed_day: 'afinal chega {{date}}',
    eta_changed_date: 'afinal chega a {{date}}',
  },
  pl: {
    test_title: 'Peek da Ci znać',
    test_body: 'To urządzenie dostaje powiadomienia o wybranych przez Ciebie krokach. Zmienisz je w każdej chwili w ustawieniach.',
    friend_title: '{{name}} jest już w Twoim kręgu',
    friend_body: 'Wasze paszporty leżą teraz obok siebie. Zerknij.',
    update: 'Nowe wieści o przesyłce',
    title_registered: 'Zgłoszona przez nadawcę',
    title_in_transit: 'W drodze',
    title_ready_for_pickup: 'Gotowa do odbioru',
    title_delivered: 'Dotarła',
    title_failed_attempt: 'Nieudane doręczenie',
    title_returned: 'W drodze powrotnej',
    body_update: 'stuknij, aby zobaczyć szczegóły',
    body_pending: 'czeka na pierwszy skan przewoźnika',
    body_registered: 'przewoźnik jeszcze jej nie ma',
    body_accepted: 'ruszyła w drogę',
    body_in_transit: 'o krok bliżej',
    body_customs: 'Peek ma ją na oku',
    body_exception: 'stuknij, aby zobaczyć, co zrobić',
    body_out_for_delivery: 'już prawie na miejscu',
    body_ready_for_pickup: 'czeka w punkcie odbioru',
    body_delivered: 'dostarczona',
    body_failed_attempt: 'przewoźnik nie mógł jej doręczyć. Stuknij, aby zobaczyć, co dalej.',
    body_returned: 'wraca do nadawcy',
    delivered_time: 'dostarczona o {{time}}',
    delivered_date: 'dostarczona {{date}} o {{time}}',
    eta_day: 'dotrze {{date}}',
    eta_date: 'dotrze {{date}}',
    eta_changed_day: 'nowy termin: {{date}}',
    eta_changed_date: 'nowy termin: {{date}}',
  },
};

/**
 * The pictures a browser draws with a notification. Android keeps only the
 * outline of the badge, for the status bar: the mark's eyes on nothing.
 */
export const WEB_NOTIFICATION_PICTURES = { icon: '/icons/icon-192.png', badge: '/icons/badge-96.png' };

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

/** The language a notification is written in: its device's, or English. */
function notificationLocale(value: unknown): Locale {
  const locale = typeof value === 'string'
    ? value.trim().split(/[-_]/, 1)[0]!.toLowerCase()
    : 'en';
  return isLocale(locale) ? locale : 'en';
}

/** What tells someone a friend took their invitation, in the language of the device it goes to. */
export function friendNotificationCopy(language: unknown, name: string): { locale: Locale; title: string; body: string } {
  const locale = notificationLocale(language);
  const copy = PUSH_COPY[locale];
  // A function, so that a nickname with a dollar sign is written as it is.
  return { locale, title: copy.friend_title!.replace('{{name}}', () => name), body: copy.friend_body! };
}

/** One of the app's own words in a notification's language, so both say the same. */
function appWord(locale: Locale, key: string): string | undefined {
  const messages: Record<string, string> = messagesFor(locale);
  return Object.hasOwn(messages, key) ? messages[key] : undefined;
}

/** A day of the year as a sentence names it: "9 October", without the year. */
function notificationDay(day: DateTime, locale: Locale): string {
  return day.setLocale(languageTags[locale]).toLocaleString({ day: 'numeric', month: 'long' });
}

interface ExpectedDelivery {
  text: string;
  /** Whether it names a day of the year rather than today or tomorrow: a sentence may need another word before it. */
  dated: boolean;
}

function expectedDelivery(
  value: unknown,
  locale: Locale,
  timezone: string,
  now: number,
): ExpectedDelivery | null {
  const cleaned = notificationText(value, 100);
  if (!cleaned) return null;
  const zone = IANAZone.isValidZone(timezone) ? timezone : 'Europe/Zurich';
  const today = DateTime.fromMillis(now, { zone });

  const formattedDay = (raw: string, time = ''): ExpectedDelivery | null => {
    const expected = DateTime.fromISO(raw, { zone });
    if (!expected.isValid || !today.isValid || expected.startOf('day') < today.startOf('day')) return null;
    const relative = expected.toISODate() === today.toISODate() ? 'time.today'
      : expected.toISODate() === today.plus({ days: 1 }).toISODate() ? 'time.tomorrow' : null;
    const day = relative ? appWord(locale, relative)! : notificationDay(expected, locale);
    return { text: time ? `${day}, ${time}` : day, dated: !relative };
  };

  const window = /^(\d{4}-\d{2}-\d{2})[ T]+(\d{2}:\d{2})(?:[–-](\d{2}:\d{2}))?$/.exec(
    cleaned,
  );
  if (window) return formattedDay(window[1]!, `${window[2]}${window[3] ? `–${window[3]}` : ''}`);
  const expected = DateTime.fromISO(cleaned, { zone });
  if (expected.isValid && /T\d{2}:\d{2}/.test(cleaned)) {
    return formattedDay(expected.toISODate()!, expected.toFormat('HH:mm'));
  }
  return formattedDay(cleaned);
}

/** When a parcel is expected, as a notification writes it: "tomorrow, 09:00–12:00". Empty for a day that has passed. */
export function notificationExpectedDelivery(
  value: unknown,
  locale = 'en',
  timezone = 'Europe/Zurich',
  now = Date.now(),
): string {
  return expectedDelivery(value, notificationLocale(locale), timezone, now)?.text ?? '';
}

function deliveredMessage(row: JsonObject, locale: Locale, now: number): string {
  const copy = PUSH_COPY[locale];
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
    .replace('{{date}}', notificationDay(delivered, locale));
}

const ETA_NOTIFICATION_STAGES = new Set([
  'registered', 'accepted', 'in_transit', 'customs', 'out_for_delivery',
]);

/** The news a notification leads with: a title of its own, or the app's word for the stage. */
function notificationTitle(row: JsonObject, locale: Locale): string {
  const stage = stringField(row, 'stage');
  const copy = PUSH_COPY[locale];
  return notificationText(copy[`title_${stage}`] ?? appWord(locale, `stage.${stage}`) ?? copy.update, 80);
}

/** What the step means: when the parcel arrives if that is known, the stage's own sentence otherwise. */
function notificationDetail(row: JsonObject, locale: Locale, now: number): string {
  const stage = stringField(row, 'stage');
  const copy = PUSH_COPY[locale];
  if (stage === 'delivered') return deliveredMessage(row, locale, now);
  const expected = ETA_NOTIFICATION_STAGES.has(stage)
    ? expectedDelivery(row.expected_delivery, locale, stringField(row, 'timezone') || 'Europe/Zurich', now)
    : null;
  if (!expected) return copy[`body_${stage}`] ?? copy.body_update!;
  const changed = row.expected_delivery_changed === true ? 'eta_changed' : 'eta';
  return copy[`${changed}_${expected.dated ? 'date' : 'day'}`]!.replace('{{date}}', expected.text);
}

/**
 * The line under the title: what leads it (the parcel's name, for whoever may
 * read it), then the detail, then the scan's place on a line of its own.
 */
function notificationBody(row: JsonObject, locale: Locale, now: number, lead = row.label): string {
  const name = notificationText(lead, 80);
  const detail = notificationDetail(row, locale, now);
  const primary = notificationText(name ? `${name} · ${detail}` : capitalized(detail, languageTags[locale]), 220);
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

/**
 * What a batch of new scans is measured against, by parcel: its newest stored
 * scan, when it joined its account, the relay copies that reached it after
 * the scan they pair with (relayCopies.ts), and whether it is archived.
 */
interface ParcelTimes {
  latest: ReadonlyMap<string, string>;
  joined: ReadonlyMap<string, string>;
  repeats: ReadonlySet<string>;
  archived: ReadonlySet<string>;
}

/** A lookup that fails leaves its answer empty, and its rule then announces every batch as before. */
async function parcelTimes(client: SupabaseServiceClient, batches: Iterable<JsonObject[]>): Promise<ParcelTimes> {
  const ids = [...batches].map((events) => stringField(events[0]!, 'package_id')).filter(Boolean);
  const read = async <T>(load: () => Promise<T>, none: T) => {
    try { return await load(); } catch { return none; }
  };
  const [latest, joined, handoffs, archived] = await Promise.all([
    read(() => client.latestScanTimes(ids), new Map<string, string>()),
    read(() => client.packageJoinTimes(ids), new Map<string, string>()),
    read(() => client.handoffScans(ids), []),
    read(() => client.archivedPackageIds(ids), new Set<string>()),
  ]);
  return { latest, joined, repeats: new Set(handoffs.flatMap((row) => [...relayRepeats(row)])), archived };
}

/**
 * The scan a batch announces: its newest, leaving out the row of a relay pair
 * that reached the parcel second, which repeats news the parcel already had.
 * None when that is all the batch holds.
 */
function announcedScan(events: readonly JsonObject[], { repeats }: ParcelTimes): JsonObject | undefined {
  return events.filter((event) => !repeats.has(stringField(event, 'event_id'))).sort(compareNotificationEvents)[0];
}

const BACKFILL_TOLERANCE_MS = 60 * 60 * 1_000;
/** The check that runs as a parcel is added stores its history within this. */
const ADD_CHECK_MS = 5 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * A batch is announced by its newest scan (`announcedScan`), unless that scan
 * is not news; the batch is then recorded as handled without a notification.
 *
 * - Backfilled: older than the parcel's newest scan, give or take an hour of
 *   clock skew (partner scans can run ahead). A carrier change backfills
 *   history, a provider reports a scan late.
 * - Known when added: from before the parcel joined its account, and either
 *   stored by the check that runs as it is added (the carrier had it then; a
 *   scan with a clock must also be from before) or more than a day older than
 *   the add, counting a whole day for a scan without a clock. That first check
 *   finds the history the owner added the parcel with, whose newest scan is
 *   always the parcel's newest. A first history that only arrives later, with
 *   scans from the hours before the add, is still announced.
 * - Stale: more than a day old when it would be announced. A leg a provider
 *   reports days late is stored and shown, but no longer worth a
 *   notification. A scan without a clock has no age to judge.
 */
export function isOldNews(newest: JsonObject, { latest, joined }: ParcelTimes, now: number): boolean {
  const packageId = stringField(newest, 'package_id');
  const scanned = Date.parse(stringField(newest, 'occurred_at'));
  const clockless = newest.event_has_time === false;
  if (!clockless && scanned < now - DAY_MS) return true;
  const parcel = Date.parse(latest.get(packageId) ?? '');
  if (Number.isFinite(scanned) && Number.isFinite(parcel) && scanned < parcel - BACKFILL_TOLERANCE_MS) return true;
  const since = Date.parse(joined.get(packageId) ?? '');
  if (!Number.isFinite(since)) return false;
  const stored = Date.parse(stringField(newest, 'event_created_at'));
  if (stored < since + ADD_CHECK_MS && (clockless || scanned < since)) return true;
  return scanned + (clockless ? DAY_MS : 0) < since - DAY_MS;
}

/**
 * Whether the parcel's account put it away, which its owner is not told about:
 * the daily check that follows it there updates it silently, and bringing it
 * back does not announce what was recorded meanwhile. Someone it was shared
 * with still gets their link's alerts.
 */
function putAway(newest: JsonObject, { archived }: ParcelTimes): boolean {
  return archived.has(stringField(newest, 'package_id'));
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
    const times = await parcelTimes(this.client, grouped.values());
    for (const events of grouped.values()) {
      signal?.throwIfAborted();
      const newest = announcedScan(events, times);
      const subscriptionId = stringField(events[0]!, 'subscription_id');
      if (!newest || putAway(newest, times) || isOldNews(newest, times, this.now())) {
        await this.client.recordPushDeliveries(subscriptionId, events.map((event) => stringField(event, 'event_id')).filter(Boolean));
        continue;
      }
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
    const locale = notificationLocale(subscription.locale);
    const copy = PUSH_COPY[locale];
    await this.send(subscription, {
      title: copy.test_title,
      body: copy.test_body,
      ...WEB_NOTIFICATION_PICTURES,
      tag: 'parcel-post-ready',
      lang: locale,
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
    const packageId = stringField(row, 'package_id');
    return {
      title: notificationTitle(row, locale),
      body: notificationBody(row, locale, this.now()),
      ...WEB_NOTIFICATION_PICTURES,
      tag: `parcel-${packageId}`,
      lang: locale,
      data: { url: `/?parcel=${packageId}` },
    };
  }
}

/** The push service says the subscription is gone, as for an account's. */
const GONE_SUBSCRIPTION = new Set([404, 410]);
/** An alert whose sends keep failing is removed after this many in a row. */
const MAX_LINK_ALERT_FAILURES = 3;
const FINISHED_STAGES = new Set(['delivered', 'returned']);

/**
 * Browser notifications for parcel links, for people without an account. An
 * alert is told about its parcel's scans with the words an account gets, in
 * the alert's language, when its preset covers the scan's stage. It never
 * carries the parcel's name or number.
 *
 * - A batch of new scans announces its newest covered one, unless that is not
 *   news (`isOldNews`), as for accounts. A parcel its account archived is
 *   still announced to the people it was shared with, not to its owner.
 * - A gift on its way is announced as one: without the place of a scan, and
 *   without the scans its page leaves out.
 * - An alert on a browser the parcel's owner gets account notifications on is
 *   passed over, so nobody is told twice.
 * - An alert ends with the journey, when the push service says its
 *   subscription is gone, and after a few failed sends in a row. A failed send
 *   is not repeated: anyone with a link can add an endpoint, so one that never
 *   works must cost a bounded number of requests. For the same reason failures
 *   are logged and counted in metrics, not reported as errors.
 */
export class ParcelLinkAlertService {
  constructor(readonly web: WebPushNotificationService) {}

  async dispatch(signal?: AbortSignal): Promise<PushSummary> {
    signal?.throwIfAborted();
    const { client } = this.web;
    const grouped = new Map<string, JsonObject[]>();
    for (const row of await client.listPendingParcelLinkAlerts()) {
      const alertId = stringField(row, 'alert_id');
      grouped.set(alertId, [...(grouped.get(alertId) ?? []), row]);
    }
    const summary = emptySummary();
    let failed = 0;
    const times = await parcelTimes(client, grouped.values());
    for (const [alertId, events] of grouped) {
      signal?.throwIfAborted();
      const newest = announcedScan(events.filter((event) => this.announces(event)), times);
      const finished = FINISHED_STAGES.has(stringField(events[0]!, 'package_stage'));
      const failures = Number(events[0]!.failures ?? 0);
      const eventIds = events.map((event) => stringField(event, 'event_id')).filter(Boolean);
      const remove = async (reason: 'delivered' | 'expired' | 'failed') => {
        await client.deleteParcelLinkAlert(alertId);
        recordParcelAlertRemoved(reason);
      };
      /** The batch is handled, whatever became of it; a journey that is over needs no alert. */
      const settle = async (failuresNow: number) => {
        if (finished) return await remove('delivered');
        await client.recordParcelLinkAlertDeliveries(alertId, eventIds);
        if (failuresNow !== failures) await client.setParcelLinkAlertFailures(alertId, failuresNow);
      };

      if (!newest || newest.account_endpoint === true || (newest.owner === true && putAway(newest, times))
        || isOldNews(newest, times, this.web.now())) {
        await settle(failures);
        recordParcelAlertSent('skipped');
        continue;
      }
      summary.attempted += 1;
      try {
        await this.web.send(newest, this.payload(newest));
      } catch (error) {
        signal?.throwIfAborted();
        const status = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 0;
        if (GONE_SUBSCRIPTION.has(status)) {
          await remove('expired');
          recordParcelAlertSent('expired');
          summary.expired += 1;
        } else {
          failed += 1;
          recordParcelAlertSent('failed');
          if (failures + 1 >= MAX_LINK_ALERT_FAILURES) await remove('failed');
          else await settle(failures + 1);
        }
        continue;
      }
      signal?.throwIfAborted();
      await settle(0);
      recordParcelAlertSent('sent');
      summary.sent += 1;
    }
    if (failed > 0) logOperationalEvent('parcel_link_alerts_failed', { failed }, 'error');
    return summary;
  }

  /** Whether the alert's preset covers the scan. A gift on its way is not told what its page leaves out. */
  announces(row: JsonObject): boolean {
    const preset = stringField(row, 'preset');
    const stage = stringField(row, 'stage');
    const stages: readonly string[] = Object.hasOwn(ALERT_PRESET_STAGES, preset)
      ? ALERT_PRESET_STAGES[preset as ApiParcelAlertPreset] : [];
    return stages.includes(stage) && !(this.wrappedGift(row) && stage === 'registered');
  }

  /** A gift that has not arrived, for everyone but the lookup's owner. */
  private wrappedGift(row: JsonObject): boolean {
    return row.gift === true && row.owner !== true && stringField(row, 'package_stage') !== 'delivered';
  }

  payload(row: JsonObject): JsonObject {
    const locale = notificationLocale(row.locale);
    const linkId = stringField(row, 'link_id');
    const stage = stringField(row, 'stage');
    const news = notificationTitle(row, locale);
    // A gift is announced as one while it travels and when it lands, in its page's words. The step it is at
    // then leads the line below, unless the title has just said it.
    const gift = row.gift === true && row.owner !== true && stage !== 'returned';
    const title = gift ? appWord(locale, stage === 'delivered' ? 'share.gift.here' : 'share.gift.headline')! : news;
    const lead = gift && stage !== 'delivered' && stage !== 'in_transit' ? news : '';
    return {
      title: notificationText(title, 80),
      // Neither the parcel's name nor its number: both are its owner's. The scan's place is part of what a gift
      // keeps to itself. Nobody chose a timezone: Zurich's, as for an account without one.
      body: notificationBody(
        { ...row, timezone: 'Europe/Zurich', location: this.wrappedGift(row) ? null : row.location },
        locale, this.web.now(), lead,
      ),
      ...WEB_NOTIFICATION_PICTURES,
      tag: `parcel-link-${linkId}`,
      lang: locale,
      data: { url: `/p/${linkId}` },
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
    const times = await parcelTimes(this.client, grouped.values());
    for (const events of grouped.values()) {
      signal?.throwIfAborted();
      const newest = announcedScan(events, times);
      const deviceId = stringField(events[0]!, 'device_id');
      if (!newest || newest.live_activity_delivered === true || putAway(newest, times)
        || isOldNews(newest, times, this.now() * 1_000)) {
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
    const copy = PUSH_COPY[this.locale(device)];
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
    return this.payload(
      notificationTitle(row, locale),
      notificationBody(row, locale, this.now() * 1_000),
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

  locale(row: JsonObject): Locale {
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
  'exception',
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
    const stage = stringField(row, 'stage');
    // The words the app writes on the activities it starts itself.
    const status = appWord(locale, `stage.${stage}`) ?? PUSH_COPY[locale].update!;
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
        label: notificationText(row.label || appWord(locale, 'common.parcel'), 80),
        carrier: notificationText(carrierDisplayName(row.carrier), 80),
        status: notificationText(status, 80),
        // Older app versions already suppress a detail equal to the status.
        detail: notificationText(stage === 'out_for_delivery' && expected && expected !== appWord(locale, 'time.today')
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
        title: notificationTitle(row, locale),
        body: notificationBody(row, locale, timestamp * 1_000),
      };
    } else if (kind === 'update') {
      aps['stale-date'] = timestamp + 30 * 60;
    } else {
      const graceSeconds = stage === 'failed_attempt' || stage === 'ready_for_pickup' || stage === 'exception'
        ? 60 * 60
        : LIVE_ACTIVITY_PHASES.has(stage) ? 30 * 60 : -1;
      aps['dismissal-date'] = timestamp + graceSeconds;
      aps.alert = {
        title: notificationTitle(row, locale),
        body: notificationBody(row, locale, timestamp * 1_000),
      };
    }
    return { aps };
  }
}

/** Carries what the healthy channels delivered when another channel failed. */
export class PushDispatchError extends AggregateError {
  constructor(errors: unknown[], readonly summary: PushSummary) {
    super(errors, `${errors.length} push channel(s) failed`);
    this.name = 'PushDispatchError';
  }
}

export class CompositePushNotificationService {
  constructor(
    readonly web: WebPushNotificationService | null,
    readonly native: NativePushNotificationService | null,
    readonly liveActivities: DeliveryLiveActivityNotificationService | null,
    readonly linkAlerts: ParcelLinkAlertService | null = null,
  ) {}

  async dispatch(signal?: AbortSignal): Promise<PushSummary> {
    signal?.throwIfAborted();
    const combined = emptySummary();
    const errors: unknown[] = [];
    // Accounts first: a parcel link's alerts come on top of its owner's notifications.
    for (const service of [this.liveActivities, this.web, this.native, this.linkAlerts]) {
      if (!service) continue;
      try {
        const summary = await service.dispatch(signal);
        combined.attempted += summary.attempted;
        combined.sent += summary.sent;
        combined.failed += summary.failed;
        combined.expired += summary.expired;
      } catch (error) {
        signal?.throwIfAborted();
        // One channel's outage or schema drift must not hold back the others.
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new PushDispatchError(errors, combined);
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
    // Push services ask who sends: the site itself, unless a contact is set.
    subject: process.env.VAPID_SUBJECT?.trim() || process.env.CANONICAL_ORIGIN?.trim() || 'https://peektracker.com',
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
        web ? new ParcelLinkAlertService(web) : null,
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
