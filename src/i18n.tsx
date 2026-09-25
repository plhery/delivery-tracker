import { localizedCalendarDate } from './lib/format';
import { trackAction } from './lib/analytics';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Stage } from './types';
import trackingMessages from '../shared/tracking-messages.json';
import { detectLocale, isLocale, LOCALE_COOKIE, SUPPORTED_LOCALES, type Locale } from './lib/locale';

export { detectLocale, SUPPORTED_LOCALES, type Locale };

const STORAGE_KEY = 'deliveryTrackerLocale';

import en from '../shared/locales/en.json';
import de from '../shared/locales/de.json';
import fr from '../shared/locales/fr.json';
import it from '../shared/locales/it.json';
import es from '../shared/locales/es.json';
import pt from '../shared/locales/pt.json';
import pl from '../shared/locales/pl.json';

export type MessageKey = keyof typeof en;
type Messages = Record<MessageKey, string>;

const dictionaries: Record<Locale, Messages> = { en, de, fr, it, es, pt, pl };
const languageTags: Record<Locale, string> = { en: 'en-CH', de: 'de-CH', fr: 'fr-CH', it: 'it-CH', es: 'es-ES', pt: 'pt-PT', pl: 'pl-PL' };
const polishPluralRules = new Intl.PluralRules('pl-PL');

export type Translate = (
  key: MessageKey,
  variables?: Record<string, string | number>,
) => string;

interface I18nValue {
  locale: Locale;
  languageTag: string;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

export function translate(locale: Locale, key: MessageKey, variables?: Record<string, string | number>) {
  const messages = dictionaries[locale];
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

const defaultValue: I18nValue = {
  locale: 'en',
  languageTag: 'en-CH',
  setLocale: () => undefined,
  t: (key, variables) => translate('en', key, variables),
};

const I18nContext = createContext<I18nValue>(defaultValue);

function savedLocale(): Locale | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(saved) ? saved : null;
  } catch {
    // Locale detection still works when storage is unavailable.
    return null;
  }
}

/** Lets the server render the next page in a chosen language. */
function rememberLocaleCookie(locale: Locale) {
  if (document.cookie.split('; ').includes(`${LOCALE_COOKIE}=${locale}`)) return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  // The server renders the language it expects the browser to choose, and
  // hydration starts from the same one. A different saved choice replaces it
  // before the first paint after hydration, never after the app is visible.
  const [locale, setLocale] = useState<Locale>(initialLocale ?? 'en');

  useLayoutEffect(() => {
    const saved = savedLocale();
    if (saved) rememberLocaleCookie(saved);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only preference, applied before paint
    setLocale(saved ?? initialLocale
      ?? detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language]));
  }, [initialLocale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const chooseLocale = useCallback((next: Locale) => {
    setLocale(next);
    rememberLocaleCookie(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Keep language switching functional even without persistent storage.
    }
  }, []);

  const value = useMemo<I18nValue>(() => ({
    locale,
    languageTag: languageTags[locale],
    setLocale: chooseLocale,
    t: (key, variables) => translate(locale, key, variables),
  }), [locale, chooseLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export function stageLabel(t: Translate, stage: Stage): string {
  return t(`stage.${stage}` as MessageKey);
}

export function LanguageControl({ className = '' }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={`language-control ${className}`.trim()}>
      <span>{t('language.label')}</span>
      <select
        aria-label={t('language.label')}
        value={locale}
        onChange={(event) => { setLocale(event.target.value as Locale); trackAction('language-change'); }}
      >
        {SUPPORTED_LOCALES.map((option) => (
          <option key={option} value={option}>{t(`language.${option}`)}</option>
        ))}
      </select>
    </label>
  );
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
