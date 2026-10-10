import type { MetadataRoute } from 'next';
import { CARRIER_LINKS } from '../src/generated/carriers';
import { GUIDE_LINKS } from '../src/generated/guides';
import { SUPPORTED_LOCALES, type Locale } from '../src/lib/locale';
import { carrierAlternates, carrierLanguages, carrierText } from '../src/server/carrierTexts';
import { guide, guideAlternates } from '../src/server/guides';
import { landingAddress, landingAlternates } from '../src/server/landingMetadata';
import { siteOrigin } from '../src/server/requestOrigin';

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
/** An address as XML text. The file is written from these strings as they are, and a request's host may hold any of the five. */
const xml = (address: string) => address.replace(/[&<>"']/g, (character) => entities[character]);
/** A page's address in every language it is written in, as XML text. */
const xmlAddresses = <Addresses extends Partial<Record<string, string>>>(addresses: Addresses) =>
  Object.fromEntries(Object.entries(addresses).flatMap(([language, address]) => (address === undefined ? [] : [[language, xml(address)]]))) as Addresses;

/** The day the newest guide of a language was last checked: when its list last changed. */
const lastChecked = (locale: Locale) => GUIDE_LINKS[locale].map(({ id }) => guide(locale, id).updated).sort().at(-1);
/** The day the newest carrier's page of a language was last checked; none for a language with none yet. */
const carriersChecked = (locale: Locale) => CARRIER_LINKS[locale].map(({ id }) => carrierText(locale, id).updated).sort().at(-1);

/**
 * The pages meant to be found: the landing in each language, the guides' own
 * page and every guide in each language, each naming the others, the
 * carriers' own page in each language and every carrier's page in each of its
 * languages, naming only those, the privacy notice and the help page. A guide
 * or a carrier's page is dated by the day its facts were last checked. A
 * parcel, an invitation and the demo are not listed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin();
  const languages = xmlAddresses(landingAlternates(origin));
  const index = xmlAddresses(guideAlternates(origin));
  const carriers = xmlAddresses(carrierAlternates(origin));
  return [
    ...SUPPORTED_LOCALES.map((locale) => ({ url: xml(landingAddress(origin, locale)), alternates: { languages } })),
    ...SUPPORTED_LOCALES.map((locale) => ({ url: index[locale], lastModified: lastChecked(locale), alternates: { languages: index } })),
    ...GUIDE_LINKS.en.flatMap(({ id }) => {
      const addresses = xmlAddresses(guideAlternates(origin, id));
      return SUPPORTED_LOCALES.map((locale) => ({ url: addresses[locale], lastModified: guide(locale, id).updated, alternates: { languages: addresses } }));
    }),
    ...SUPPORTED_LOCALES.map((locale) => ({ url: carriers[locale]!, lastModified: carriersChecked(locale), alternates: { languages: carriers } })),
    ...CARRIER_LINKS.en.flatMap(({ id }) => {
      const addresses = xmlAddresses(carrierAlternates(origin, id));
      return carrierLanguages(id).map((locale) => ({ url: addresses[locale]!, lastModified: carrierText(locale, id).updated, alternates: { languages: addresses } }));
    }),
    { url: xml(new URL('/privacy.html', origin).href) },
    { url: xml(new URL('/support.html', origin).href) },
  ];
}
