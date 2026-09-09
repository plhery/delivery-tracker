import { localizedCalendarDate } from './lib/format';
import { trackAction } from './lib/analytics';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Stage } from './types';

export const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

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

export function detectLocale(languages: readonly string[] = []): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    if (SUPPORTED_LOCALES.includes(base as Locale)) return base as Locale;
  }
  return 'en';
}

function browserLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED_LOCALES.includes(saved as Locale)) return saved as Locale;
  } catch {
    // Locale detection still works when storage is unavailable.
  }
  return detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // The fixed initial locale keeps server and browser markup identical. The
  // user's preference is restored immediately after hydration.
  const [locale, setLocale] = useState<Locale>('en');
  const hydrated = useRef(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setLocale(browserLocale()), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Keep language switching functional even without persistent storage.
    }
  }, [locale]);

  const value = useMemo<I18nValue>(() => ({
    locale,
    languageTag: languageTags[locale],
    setLocale,
    t: (key, variables) => translate(locale, key, variables),
  }), [locale]);

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
  const messages: Record<string, MessageKey> = {
    'Tracking added': 'event.added',
    'Tracking added; the carrier has not announced it yet': 'event.waiting',
    'Carrier changed; waiting for tracking': 'event.carrierChanged',
  };
  const key = messages[description];
  return key ? t(key) : description;
}
