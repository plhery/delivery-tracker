import { cookies, headers } from 'next/headers';
import type { Messages } from '../i18n';
import { acceptedLanguages, detectLocale, isLocale, LOCALE_COOKIE, type Locale } from '../lib/locale';
import de from '../../shared/locales/de.json';
import es from '../../shared/locales/es.json';
import fr from '../../shared/locales/fr.json';
import it from '../../shared/locales/it.json';
import pl from '../../shared/locales/pl.json';
import pt from '../../shared/locales/pt.json';

const MESSAGES: Record<Exclude<Locale, 'en'>, Messages> = { de, fr, it, es, pt, pl };

/** The language the browser will pick, so server markup is never replaced by a translation. */
export async function requestLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return detectLocale(acceptedLanguages((await headers()).get('accept-language')));
}

/** The request's language with its messages; English ships with the client already. */
export async function requestLanguage(): Promise<{ initialLocale: Locale; initialMessages?: Messages }> {
  const locale = await requestLocale();
  return locale === 'en' ? { initialLocale: locale } : { initialLocale: locale, initialMessages: MESSAGES[locale] };
}
