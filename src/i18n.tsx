import { localizedCalendarDate } from './lib/format';
import { trackAction } from './lib/analytics';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Stage } from './types';
import trackingMessages from '../shared/tracking-messages.json';
import { detectLocale, isLocale, LOCALE_COOKIE, SUPPORTED_LOCALES, type Locale } from './lib/locale';

export { detectLocale, SUPPORTED_LOCALES, type Locale };

const STORAGE_KEY = 'deliveryTrackerLocale';

import en from '../shared/locales/en.json';

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

// English ships with the app. The server sends the page's own language with
// the page, and the others load only when someone chooses them.
const loaders: Record<Exclude<Locale, 'en'>, () => Promise<{ default: Messages }>> = {
  de: () => import('../shared/locales/de.json'),
  fr: () => import('../shared/locales/fr.json'),
  it: () => import('../shared/locales/it.json'),
  es: () => import('../shared/locales/es.json'),
  pt: () => import('../shared/locales/pt.json'),
  pl: () => import('../shared/locales/pl.json'),
};
const dictionaries = new Map<Locale, Messages>([['en', en]]);

export async function loadMessages(locale: Locale): Promise<Messages> {
  const loaded = dictionaries.get(locale);
  if (loaded) return loaded;
  const messages = (await loaders[locale as Exclude<Locale, 'en'>]()).default;
  dictionaries.set(locale, messages);
  return messages;
}

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

/** Translates with a loaded language; an unloaded one falls back to English. */
export function translate(
  locale: Locale,
  key: MessageKey,
  variables?: Record<string, string | number>,
  messages: Messages = dictionaries.get(locale) ?? en,
) {
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

export function I18nProvider({ children, initialLocale, initialMessages }: {
  children: ReactNode;
  initialLocale?: Locale;
  initialMessages?: Messages;
}) {
  // The server renders the language it expects the browser to choose and sends
  // its messages with the page, so hydration starts from the same text. A
  // different saved choice that is already loaded replaces it before the
  // first paint after hydration.
  const [language, setLanguage] = useState(() => {
    const locale = initialLocale ?? 'en';
    if (initialMessages) dictionaries.set(locale, initialMessages);
    const messages = dictionaries.get(locale);
    return messages ? { locale, messages } : { locale: 'en' as Locale, messages: en };
  });
  const requested = useRef(language.locale);

  const show = useCallback((next: Locale) => {
    requested.current = next;
    const loaded = dictionaries.get(next);
    if (loaded) {
      setLanguage((current) => current.locale === next ? current : { locale: next, messages: loaded });
      return;
    }
    void loadMessages(next).then((messages) => {
      if (requested.current === next) setLanguage({ locale: next, messages });
    }, () => {
      // A newer build replaced this language file. The cookie already names the
      // language, so the current build renders it after a reload.
      if (requested.current === next) window.location.reload();
    });
  }, []);

  useLayoutEffect(() => {
    const saved = savedLocale();
    if (saved) rememberLocaleCookie(saved);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only preference, applied before paint
    show(saved ?? initialLocale
      ?? detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language]));
  }, [initialLocale, show]);

  useEffect(() => {
    document.documentElement.lang = language.locale;
  }, [language.locale]);

  const chooseLocale = useCallback((next: Locale) => {
    rememberLocaleCookie(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Keep language switching functional even without persistent storage.
    }
    show(next);
  }, [show]);

  const value = useMemo<I18nValue>(() => ({
    locale: language.locale,
    languageTag: languageTags[language.locale],
    setLocale: chooseLocale,
    t: (key, variables) => translate(language.locale, key, variables, language.messages),
  }), [language, chooseLocale]);

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
  // Keep the choice selected while its language loads.
  const [chosen, setChosen] = useState<Locale | null>(null);
  return (
    <label className={`language-control ${className}`.trim()}>
      <span>{t('language.label')}</span>
      <select
        aria-label={t('language.label')}
        value={chosen ?? locale}
        onChange={(event) => {
          const next = event.target.value as Locale;
          setChosen(next);
          setLocale(next);
          trackAction('language-change');
        }}
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
