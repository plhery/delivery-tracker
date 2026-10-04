import 'server-only';
import type { Locale } from '../lib/locale';
import { translateMessage, type Translate } from '../lib/messages';
import { peekPicturePath } from '../lib/peekPicture';
import { messagesFor } from './requestLocale';

/** The language of a preview as Open Graph names it. */
export const PREVIEW_LOCALES: Record<Locale, string> = {
  en: 'en_US', de: 'de_DE', fr: 'fr_FR', it: 'it_IT', es: 'es_ES', pt: 'pt_PT', pl: 'pl_PL',
};

/** The words the server writes in a language: a page's title, its description, its picture. */
export function wordsIn(locale: Locale): Translate {
  const messages = messagesFor(locale);
  return (key, variables) => translateMessage(locale, key, variables, messages);
}

/** Peek's name with what it is: the title of a page that has none of its own. */
export function siteTitle(t: Translate): string {
  return `${t('app.title')} — ${t('app.tagline')}`;
}

/** The landing's title: the question it answers, then what Peek is, for someone searching for one. */
export function landingTitle(t: Translate): string {
  return `${t('app.title')} — ${t('peek.title')} ${t('app.tagline')}`;
}

/** Peek's own picture in a language, as a preview links it. */
export function sitePicture(origin: URL, locale: Locale) {
  const t = wordsIn(locale);
  return {
    url: new URL(peekPicturePath(locale), origin).href,
    width: 1_200,
    height: 630,
    alt: `${siteTitle(t)}: ${t('peek.title')}`,
  };
}
