import {
  localizedDeliveryDate,
  localizedDeliveryWindow,
  localizedRelativeTime,
  type MessageKey,
  type Translate,
} from '../../lib/messages';
import { parcelAttention, type ParcelAttention } from '../../lib/parcelPriority';
import { parcelDeliveryEstimate, parcelDisplayStatusKey, parcelHasCarrierUpdate } from '../../lib/parcelStatus';
import { currentEvent, isFinal } from '../../lib/stages';
import type { ParcelWithEvents, Stage } from '../../types';

/**
 * What a parcel's card, its tab and its link preview say. Nothing here needs
 * a browser: the server writes previews with the same words.
 */
export interface Wording {
  t: Translate;
  languageTag: string;
  now?: number;
}

const DAY = 86_400_000;
/** A day after the journey ended the page winds down: the card shrinks and the forget date takes the stage. */
const AFTERWARDS_MS = DAY;

export function capitalized(text: string, languageTag: string): string {
  const [first = '', ...rest] = [...text];
  return first.toLocaleUpperCase(languageTag) + rest.join('');
}

function clock(date: Date, languageTag: string): string {
  return new Intl.DateTimeFormat(languageTag, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** A moment inside a sentence: the time when it is today, else the day and the time ("yesterday, 08:12"). */
export function momentLabel(iso: string, { t, languageTag, now = Date.now() }: Wording): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return sameDay(date, new Date(now)) ? clock(date, languageTag)
    : `${localizedDeliveryDate(date, t, languageTag, now)}, ${clock(date, languageTag)}`;
}

/** An estimate the way the card writes it: "Today, 13:00–17:00" for a day close by, "Expected: Fri 2 oct" otherwise. */
function estimateLine(parcel: ParcelWithEvents, estimate: string, wording: Wording): string {
  const { t, languageTag, now = Date.now() } = wording;
  const text = localizedDeliveryWindow(parcel.expectedDeliveryFrom, estimate, t, languageTag, now);
  const nearby = (['time.today', 'time.tomorrow', 'time.yesterday'] as const).some((key) => text.startsWith(t(key)));
  return nearby ? capitalized(text, languageTag) : t('detail.expected', { date: text });
}

export function parcelStage(parcel: ParcelWithEvents): Stage | null {
  const current = currentEvent(parcel.events);
  return current && current.stage !== 'pending' ? current.stage : null;
}

/** The headline: the parcel's status. */
export function parcelHeadline(parcel: ParcelWithEvents, t: Translate): string {
  return t(parcelDisplayStatusKey(parcel));
}

/**
 * The line under the headline: when it arrives, when it arrived, or that
 * nobody knows yet. `clockTime` is off where the reader's time zone is not
 * known, as on the server.
 */
export function parcelDetail(parcel: ParcelWithEvents, wording: Wording, clockTime = true): string | null {
  const { t, languageTag, now = Date.now() } = wording;
  const current = currentEvent(parcel.events);
  const stage = parcelStage(parcel);
  const at = current ? new Date(current.occurredAt) : null;
  const dated = at && !Number.isNaN(at.getTime()) ? at : null;
  if (stage === 'delivered') {
    if (!dated) return null;
    const day = capitalized(localizedDeliveryDate(dated, t, languageTag, now), languageTag);
    return clockTime ? `${day}, ${clock(dated, languageTag)}` : day;
  }
  if (stage === 'returned') {
    return dated ? t('link.returnedSince', { date: localizedDeliveryDate(dated, t, languageTag, now) }) : null;
  }
  const estimate = parcelDeliveryEstimate(parcel, now);
  if (estimate) return estimateLine(parcel, estimate, wording);
  return stage && ['registered', 'accepted', 'in_transit', 'customs'].includes(stage) ? t('link.noDate') : null;
}

/** The estimate the carrier gave before it changed it: "Was: today, 13:00–17:00". */
export function previousEstimateLine(previous: string | null, parcel: ParcelWithEvents, wording: Wording): string | null {
  const { t, languageTag, now = Date.now() } = wording;
  if (!previous || previous === parcel.expectedDelivery || !parcelDeliveryEstimate(parcel, now)) return null;
  return t('link.was', { date: localizedDeliveryWindow(undefined, previous, t, languageTag, now) });
}

/** What needs a word on the card, as the deliveries list would flag it. Waiting at a pickup point is the headline already. */
export function parcelFlag(parcel: ParcelWithEvents, now = Date.now()): Exclude<ParcelAttention, 'ready_for_pickup'> | null {
  const reason = parcelAttention(parcel, now);
  return reason === 'ready_for_pickup' ? null : reason;
}

export const flagKey = (flag: ParcelAttention) => `attention.${flag}` as MessageKey;

/** Whether the journey ended long enough ago for the page to wind down. */
export function journeyEndedBefore(parcel: ParcelWithEvents, now = Date.now()): boolean {
  const current = currentEvent(parcel.events);
  if (!current || !isFinal(current.stage)) return false;
  const ended = Date.parse(current.occurredAt);
  return Number.isFinite(ended) && now - ended >= AFTERWARDS_MS;
}

/** The day a link is forgotten, written as the app writes its dates: "30 oct". */
export function forgetDate(forgetAt: string | null, languageTag: string): string | null {
  const date = forgetAt ? new Date(forgetAt) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat(new Intl.Locale(languageTag).language, { day: 'numeric', month: 'short' }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)!.value.replaceAll('.', '');
  return `${part('day')} ${part('month').toLocaleLowerCase(languageTag)}`;
}

export interface Freshness {
  /** `live`: watching, nothing to date yet. `ended`: the journey is over. `stale`: the last read or check failed. */
  kind: 'live' | 'updated' | 'checked' | 'stale' | 'offline' | 'ended';
  /** The whole label: "Updated: 2 min ago". */
  label: string;
  /** What is left where there is no room: "2 min ago". */
  short: string;
  /** Whether the dot is drawn, and whether it pulses. */
  dot: boolean;
  pulse: boolean;
}

/**
 * The marker beside the carrier: how fresh the card is. It says "updated"
 * while the parcel moves, "last checked" while there is nothing new to tell,
 * and pulses only while the page is reading on its own.
 */
export function parcelFreshness({ parcel, checking, live, offline, trouble, seenAt }: {
  parcel: ParcelWithEvents;
  /** The carrier has not been asked yet. */
  checking: boolean;
  /** The page is reading on its own. */
  live: boolean;
  offline: boolean;
  /** The newest read failed. */
  trouble: boolean;
  /** When this device last got an answer. */
  seenAt: string | null;
}, wording: Wording): Freshness {
  const { t, languageTag, now = Date.now() } = wording;
  if (offline) {
    const label = t('link.offlineLabel');
    return { kind: 'offline', label, short: label, dot: true, pulse: false };
  }
  const current = currentEvent(parcel.events);
  const stage = parcelStage(parcel);
  if (stage && isFinal(stage) && current) {
    const label = capitalized(localizedRelativeTime(current.occurredAt, t, languageTag, now), languageTag);
    return { kind: 'ended', label, short: label, dot: false, pulse: false };
  }
  const checkedAt = parcel.lastSyncedAt ?? seenAt;
  if (checking || !checkedAt || Number.isNaN(Date.parse(checkedAt))) {
    const label = t('link.live');
    return { kind: 'live', label, short: label, dot: true, pulse: live };
  }
  if (trouble || parcel.syncStatus === 'error') {
    const label = t('link.asOf', { time: momentLabel(checkedAt, wording) });
    return { kind: 'stale', label, short: label, dot: false, pulse: false };
  }
  const ago = localizedRelativeTime(checkedAt, t, languageTag, now);
  const quiet = !parcelHasCarrierUpdate(parcel) || stage === 'registered' || parcelAttention(parcel, now) === 'stalled';
  return {
    kind: quiet ? 'checked' : 'updated',
    label: t(quiet ? 'detail.lastChecked' : 'parcel.updated', { date: ago }),
    short: capitalized(ago, languageTag),
    dot: true,
    pulse: live,
  };
}

/** The estimate as short as a tab can carry it: the hours when it is today, else the day. */
function shortEstimate(parcel: ParcelWithEvents, wording: Wording): string | null {
  const { t, languageTag, now = Date.now() } = wording;
  const estimate = parcelDeliveryEstimate(parcel, now);
  if (!estimate) return null;
  const text = localizedDeliveryWindow(parcel.expectedDeliveryFrom, estimate, t, languageTag, now);
  const today = `${t('time.today')}, `;
  return text.startsWith(today) ? text.slice(today.length) : text;
}

/**
 * The tab's title follows the parcel: "Out for delivery · 13:00–17:00",
 * "(1) In transit · Peek" when a scan landed in a background tab,
 * "Delivered at 14:12 · Peek".
 */
export function parcelTabTitle({ parcel, name, checking, unseen = 0 }: {
  parcel: ParcelWithEvents;
  name?: string | null;
  checking?: boolean;
  unseen?: number;
}, wording: Wording): string {
  const { t, languageTag, now = Date.now() } = wording;
  const app = t('app.title');
  if (checking) return `${t('link.title.checking')} · ${app}`;
  const current = currentEvent(parcel.events);
  const at = current ? new Date(current.occurredAt) : null;
  const deliveredToday = parcelStage(parcel) === 'delivered' && at && sameDay(at, new Date(now));
  const status = deliveredToday ? t('link.title.delivered', { time: clock(at, languageTag) }) : parcelHeadline(parcel, t);
  const estimate = shortEstimate(parcel, wording);
  const title = [name, status, estimate ?? app].filter(Boolean).join(' · ');
  return unseen > 0 ? `(${unseen}) ${title}` : title;
}

/** The link preview's two lines: "Out for delivery · DHL" and "Today, 13:00–17:00. Follow it on Peek." */
export function parcelPreviewText(parcel: ParcelWithEvents, carrierName: string, wording: Wording): { title: string; description: string; headline: string; detail: string | null } {
  const headline = parcelHeadline(parcel, wording.t);
  const detail = parcelDetail(parcel, wording, false);
  const follow = wording.t('link.preview.follow');
  return {
    headline,
    detail,
    title: `${headline} · ${carrierName}`,
    description: detail ? `${detail}${/[.!?…]$/.test(detail) ? '' : '.'} ${follow}` : follow,
  };
}
