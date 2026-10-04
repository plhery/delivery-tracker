import type { MetadataRoute } from 'next';
import { SUPPORTED_LOCALES } from '../src/lib/locale';
import { landingAddress, landingAlternates } from '../src/server/landingMetadata';
import { siteOrigin } from '../src/server/requestOrigin';

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
/** An address as XML text. The file is written from these strings as they are, and a request's host may hold any of the five. */
const xml = (address: string) => address.replace(/[&<>"']/g, (character) => entities[character]);

/**
 * The pages meant to be found: the landing in each language, every one of
 * them naming the others, and the privacy notice. A parcel, an invitation and
 * the demo are not.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin();
  const languages = Object.fromEntries(Object.entries(landingAlternates(origin)).map(([language, address]) => [language, xml(address)]));
  return [
    ...SUPPORTED_LOCALES.map((locale) => ({ url: xml(landingAddress(origin, locale)), alternates: { languages } })),
    { url: xml(new URL('/privacy.html', origin).href) },
  ];
}
