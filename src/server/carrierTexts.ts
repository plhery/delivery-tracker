import 'server-only';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { carrierPath } from '../carriers/paths';
import { CARRIER_LINKS, type CarrierLink } from '../generated/carriers';
import { parseCarrierText, typeset, type CarrierText } from '../guides/markdown';
import { SUPPORTED_LOCALES, type Locale } from '../lib/locale';

// The build ships these files beside the server (`outputFileTracingIncludes` in `next.config.ts`).
// `./carriers` is the scraper's list of every carrier Peek tracks; this is the few with a page of their own.
const directory = path.join(process.cwd(), 'content', 'carriers');
const read = new Map<string, CarrierText>();

/** The carriers with a page in a language, in the order the site shows them. */
export function carrierLinks(locale: Locale): readonly CarrierLink[] {
  return CARRIER_LINKS[locale];
}

/** The carrier's page an address names, in the address's language. */
export function carrierLinkBySlug(locale: Locale, slug: string): CarrierLink | undefined {
  return CARRIER_LINKS[locale].find((link) => link.slug === slug);
}

/** The languages a carrier's page is written in, in the site's order. */
export function carrierLanguages(id: string): Locale[] {
  return SUPPORTED_LOCALES.filter((locale) => CARRIER_LINKS[locale].some((link) => link.id === id));
}

/** A carrier's page, set as its language sets it. Its file is read once; while developing, every time, so an edit shows. */
export function carrierText(locale: Locale, id: string): CarrierText {
  const key = `${id}/${locale}`;
  const kept = read.get(key);
  if (kept) return kept;
  const loaded = typeset(parseCarrierText(readFileSync(path.join(directory, id, `${locale}.md`), 'utf8'), `content/carriers/${key}.md`), locale);
  if (process.env.NODE_ENV === 'production') read.set(key, loaded);
  return loaded;
}

/**
 * Where a carrier's page lives in every language: its own page in a language it is written in, the
 * carriers' own page of any other. With no carrier named, the carriers' own page, which every language has.
 */
export function carrierAddresses(id?: string): Record<Locale, string> {
  return Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [
    locale,
    carrierPath(locale, id && CARRIER_LINKS[locale].find((link) => link.id === id)?.slug),
  ])) as Record<Locale, string>;
}

/**
 * A carrier's page, or the carriers' own page, in the languages it is written in, as search engines are
 * told: each language's address on `origin`, and the English one for a reader of none of them. A
 * carrier's page names only its own languages; the carriers' own page is written in all of them.
 */
export function carrierAlternates(origin: URL, id?: string): Partial<Record<Locale, string>> & Record<'x-default', string> {
  const addresses = carrierAddresses(id);
  return {
    ...Object.fromEntries((id ? carrierLanguages(id) : SUPPORTED_LOCALES).map((locale) => [locale, new URL(addresses[locale], origin).href])),
    'x-default': new URL(addresses.en, origin).href,
  };
}
