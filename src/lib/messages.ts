import trackingMessages from '../../shared/tracking-messages.json';
import type en from '../../shared/locales/en.json';
import type { Stage } from '../types';
import { localizedCalendarDate } from './format';
import type { Locale } from './locale';

/**
 * The words of the app without its React side: message types, translation and
 * the phrases built from them. The server uses these for link previews; the
 * client reaches them through `src/i18n.tsx`.
 */
export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

export type Translate = (
  key: MessageKey,
  variables?: Record<string, string | number>,
) => string;

export const languageTags: Record<Locale, string> = { en: 'en-CH', de: 'de-CH', fr: 'fr-CH', it: 'it-CH', es: 'es-ES', pt: 'pt-PT', pl: 'pl-PL' };
const polishPluralRules = new Intl.PluralRules('pl-PL');

/** One message of a language, with its count form and its variables filled in. */
export function translateMessage(
  locale: Locale,
  key: MessageKey,
  variables: Record<string, string | number> | undefined,
  messages: Messages,
): string {
  const count = variables?.count;
  const category = typeof count === 'number' && locale === 'pl'
    ? polishPluralRules.select(count) : count === 1 ? 'one' : 'other';
  const baseKey = key.replace(/\.(one|few|many)$/, '');
  const pluralKey = `${baseKey}.${category}` as MessageKey;
  let message: string = category !== 'other' && pluralKey in messages ? messages[pluralKey] : messages[key];
  for (const [name, value] of Object.entries(variables ?? {})) {
    message = message.replaceAll(`{{${name}}}`, String(value));
  }
  return message;
}

export function stageLabel(t: Translate, stage: Stage): string {
  return t(`stage.${stage}` as MessageKey);
}

export function localizedRelativeTime(
  iso: string,
  t: Translate,
  languageTag: string,
  now: number = Date.now(),
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('time.daysAgo', { count: days });
  return localizedCalendarDate(new Date(iso), languageTag);
}

/** Relative labels for nearby local calendar days, otherwise a compact date. */
export function localizedDeliveryDate(
  date: Date,
  t: Translate,
  languageTag: string,
  now: number = Date.now(),
): string {
  const today = new Date(now);
  for (const [offset, key] of [[-1, 'time.yesterday'], [0, 'time.today'], [1, 'time.tomorrow']] as const) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    if (date.getFullYear() === day.getFullYear() &&
        date.getMonth() === day.getMonth() && date.getDate() === day.getDate()) return t(key);
  }
  return localizedCalendarDate(date, languageTag);
}

export function localizedExpectedDelivery(
  value: string,
  t: Translate,
  languageTag: string,
  now: number = Date.now(),
): string {
  const windowMatch = /^(\d{4}-\d{2}-\d{2})[ T]+(\d{2}:\d{2})(?:[–-](\d{2}:\d{2}))?$/.exec(value.trim());
  if (windowMatch) {
    const date = localizedExpectedDelivery(windowMatch[1], t, languageTag, now);
    return `${date}, ${windowMatch[2]}${windowMatch[3] ? `–${windowMatch[3]}` : ''}`;
  }
  const expected = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(expected.getTime())) return value;
  const day = localizedDeliveryDate(expected, t, languageTag, now);
  if (/T\d{2}:\d{2}/.test(value)) {
    const time = new Intl.DateTimeFormat(languageTag, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(expected);
    return `${day}, ${time}`;
  }
  return day;
}

/** Calendar dates need a preposition; relative dates such as "today" do not. */
export function localizedDatePhrase(date: string, t: Translate): string {
  const relative = (['time.yesterday', 'time.today', 'time.tomorrow'] as const)
    .some((key) => date === t(key));
  return relative ? date : t('parcel.onDate', { date });
}

/** Translate messages created by this app; preserve the carrier’s original scan notes. */
export function localizedEventDescription(description: string, t: Translate): string {
  const messages: Record<string, { key: string; variables: Record<string, string> }> = trackingMessages.events;
  const message = Object.hasOwn(messages, description) ? messages[description] : undefined;
  return message ? t(message.key as MessageKey, message.variables) : description;
}

/** Only stable service codes select specific copy; diagnostics never reach the UI. */
export function trackingFailureMessage(error: string | undefined, t: Translate): string {
  const kind = error?.startsWith('carrier:') ? error.slice('carrier:'.length) : '';
  const messages: Record<string, string> = trackingMessages.failures;
  return t((Object.hasOwn(messages, kind) ? messages[kind] : 'detail.trackingUnavailable') as MessageKey);
}

export function localizedDeliveryWindow(from: string | undefined, to: string, t: Translate, languageTag: string, now = Date.now()): string {
  const end = localizedExpectedDelivery(to, t, languageTag, now);
  if (!from || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) return end;
  const start = localizedExpectedDelivery(from, t, languageTag, now);
  return `${start} – ${end}`;
}
