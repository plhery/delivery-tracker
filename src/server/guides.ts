import 'server-only';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GUIDE_LINKS, type GuideLink } from '../generated/guides';
import { parseGuide, typeset, type Guide } from '../guides/markdown';
import { guidePath } from '../guides/paths';
import { SUPPORTED_LOCALES, type Locale } from '../lib/locale';

// The build ships these files beside the server (`outputFileTracingIncludes` in `next.config.ts`).
const directory = path.join(process.cwd(), 'content', 'guides');
const read = new Map<string, Guide>();

/** The guides of a language, in the order the site shows them. */
export function guideLinks(locale: Locale): readonly GuideLink[] {
  return GUIDE_LINKS[locale];
}

/** The guide an address names, in the address's language. */
export function guideLinkBySlug(locale: Locale, slug: string): GuideLink | undefined {
  return GUIDE_LINKS[locale].find((link) => link.slug === slug);
}

/** A guide's text, set as its language sets it. Its file is read once; while developing, every time, so an edit shows. */
export function guide(locale: Locale, id: string): Guide {
  const key = `${id}/${locale}`;
  const kept = read.get(key);
  if (kept) return kept;
  const loaded = typeset(parseGuide(readFileSync(path.join(directory, id, `${locale}.md`), 'utf8'), `content/guides/${key}.md`), locale);
  if (process.env.NODE_ENV === 'production') read.set(key, loaded);
  return loaded;
}

/** Where one guide lives in every language, or the guides' own page when no guide is named. */
export function guideAddresses(id?: string): Record<Locale, string> {
  return Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [
    locale,
    guidePath(locale, id && GUIDE_LINKS[locale].find((link) => link.id === id)?.slug),
  ])) as Record<Locale, string>;
}

/**
 * A guide, or the guides' own page, in every language as search engines are told: each language's
 * address on `origin`, and the English one for a reader of none of them.
 */
export function guideAlternates(origin: URL, id?: string): Record<Locale | 'x-default', string> {
  const addresses = guideAddresses(id);
  return {
    ...Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, new URL(addresses[locale], origin).href])) as Record<Locale, string>,
    'x-default': new URL(addresses.en, origin).href,
  };
}
