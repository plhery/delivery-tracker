import { cookies, headers } from 'next/headers';
import type { Messages } from '../i18n';
import { acceptedLanguages, detectLocale, isLocale, LOCALE_COOKIE, type Locale } from '../lib/locale';
import de from '../../shared/locales/de.json';
import en from '../../shared/locales/en.json';
import es from '../../shared/locales/es.json';
import fr from '../../shared/locales/fr.json';
import it from '../../shared/locales/it.json';
import pl from '../../shared/locales/pl.json';
import pt from '../../shared/locales/pt.json';

const MESSAGES: Record<Exclude<Locale, 'en'>, Messages> = { de, fr, it, es, pt, pl };

/** The messages of a language, for what the server writes itself: a link preview's title and image. */
export function messagesFor(locale: Locale): Messages {
  return locale === 'en' ? en : MESSAGES[locale];
}

/**
 * The language the browser will pick, so server markup is never replaced by a
 * translation. At a language address such as `/de`, and at a guides address
 * such as `/de/guides/…` or `/guides/…`, that is the address's language: the
 * proxy answers for the cookie there, whatever the browser sent.
 */
export async function requestLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return detectLocale(acceptedLanguages((await headers()).get('accept-language')));
}

/** A language with its messages, as a page hands them to the client; English ships with the client already. */
export function languageFor(locale: Locale): { initialLocale: Locale; initialMessages?: Messages } {
  return locale === 'en' ? { initialLocale: locale } : { initialLocale: locale, initialMessages: MESSAGES[locale] };
}

/** The request's language with its messages. */
export async function requestLanguage(): Promise<{ initialLocale: Locale; initialMessages?: Messages }> {
  return languageFor(await requestLocale());
}
