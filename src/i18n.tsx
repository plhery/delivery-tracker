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
import { detectLocale, documentLanguage, isLocale, languagePath, LOCALE_COOKIE, manifestPath, pathLanguage, SUPPORTED_LOCALES, type Locale } from './lib/locale';
import { languageTags, translateMessage, type MessageKey, type Messages, type Translate } from './lib/messages';

export { detectLocale, SUPPORTED_LOCALES, type Locale };
// The words themselves have no React in them, so the server can use them too.
export {
  localizedDatePhrase,
  localizedDeliveryDate,
  localizedDeliveryWindow,
  localizedEventDescription,
  localizedExpectedDelivery,
  localizedRelativeTime,
  stageLabel,
  trackingFailureMessage,
} from './lib/messages';
export type { MessageKey, Messages, Translate };

const STORAGE_KEY = 'deliveryTrackerLocale';

import en from '../shared/locales/en.json';

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
  return translateMessage(locale, key, variables, messages);
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

/** The language of the address, where the landing has an address per language: there it is the page's language. */
const addressLanguage = () => pathLanguage(window.location.pathname);

/** Lets the server render the next page in a chosen language. */
function rememberLocaleCookie(locale: Locale) {
  if (document.cookie.split('; ').includes(`${LOCALE_COOKIE}=${locale}`)) return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export function I18nProvider({ children, initialLocale, initialMessages, addressLocale }: {
  children: ReactNode;
  initialLocale?: Locale;
  initialMessages?: Messages;
  /** The language the page's address names in its query, as a delivery email's link does: it decides like a language address. */
  addressLocale?: Locale;
}) {
  // The server renders the language it expects the browser to choose and sends
  // its messages with the page, so hydration starts from the same text. A
  // different saved choice that is already loaded replaces it before the
  // first paint after hydration. At a language address the address decides:
  // a saved choice does not replace it, and the visit saves nothing.
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
    show(addressLanguage() ?? addressLocale ?? saved ?? initialLocale
      ?? detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language]));
  }, [initialLocale, addressLocale, show]);

  // Arriving at a language address without a page load, as Back does, shows its language.
  // Leaving one keeps the language on screen until the next page load.
  useEffect(() => {
    const follow = () => {
      const language = addressLanguage();
      if (language) show(language);
    };
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, [show]);

  useEffect(() => {
    document.documentElement.lang = documentLanguage(language.locale);
    // The app a browser installs from this page is named in the language the page shows.
    const manifest = document.querySelector('link[rel="manifest"]');
    const path = manifestPath(language.locale);
    if (manifest && manifest.getAttribute('href') !== path) manifest.setAttribute('href', path);
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

/**
 * Moves a language address to the landing's address in the language just
 * chosen, in place: the page stays, and Back leaves it as before.
 */
function moveLanguageAddress(path: string) {
  if (window.location.pathname === path) return;
  window.history.replaceState(window.history.state, '', `${path}${window.location.search}${window.location.hash}`);
  // Told the way the browser tells a step in the history, so everything that follows the address hears it.
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function LanguageControl({ className = '', englishAddress }: {
  className?: string;
  /** Where a language address leads for English, when `/` is not the landing for this reader. */
  englishAddress?: () => string;
}) {
  const { locale, setLocale, t } = useI18n();
  // Keep the choice selected while its language loads. Once it shows, the page's language is what the menu says:
  // an address may change it afterwards.
  const [chosen, setChosen] = useState<Locale | null>(null);
  if (chosen === locale) setChosen(null);
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
          // At a language address the choice is also where the page is: the address follows it.
          if (addressLanguage()) moveLanguageAddress((next === 'en' ? englishAddress?.() : undefined) ?? languagePath(next));
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
