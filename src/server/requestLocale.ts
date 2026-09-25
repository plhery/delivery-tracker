import { cookies, headers } from 'next/headers';
import { acceptedLanguages, detectLocale, isLocale, LOCALE_COOKIE, type Locale } from '../lib/locale';

/** The language the browser will pick, so server markup is never replaced by a translation. */
export async function requestLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return detectLocale(acceptedLanguages((await headers()).get('accept-language')));
}
