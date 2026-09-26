import { CARRIER_DEFINITIONS } from './definitions';
import { matchesDomain } from './linkRules';
import { countryTimeZone } from '../time';
import type { CarrierId } from '../../generated/catalog';

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

// These brands have several regional/service adapters.
const AMBIGUOUS_BRANDS = ['dhl', 'dpd', 'gls', 'hermes', 'post'];
// Brands whose other networks keep the brand in front ("DHL Express", "GLS
// Italy"). "post" is left out: it also starts unrelated names.
const NETWORK_BRANDS = ['dhl', 'dpd', 'gls', 'hermes'];
const NAME_ALIASES: Readonly<Record<string, string>> = {
  ups: 'ups', swisspost: 'swiss-post', laposte: 'la-poste', colissimo: 'la-poste',
  dhlecommerce: 'dhl-ecommerce', cainiao: 'aliexpress', postnl: 'spring-gds',
  asendiausa: 'asendia',
};
const CATALOG_NAMES = new Set([
  ...Object.entries(CARRIER_DEFINITIONS).filter(([id]) => id !== 'unknown')
    .map(([, definition]) => key(definition.displayName)),
  ...Object.keys(NAME_ALIASES), ...AMBIGUOUS_BRANDS,
]);

// Postal lookup candidates, not proof of which operator delivers a shipment.
// Only operators with a dedicated adapter are useful here. The host also
// checks adapter availability and required inputs before making a request.
const NATIONAL_POSTS: ReadonlyMap<string, CarrierId> = new Map([
  ['CA', 'canada-post'], ['CH', 'swiss-post'], ['DE', 'dhl'],
  ['ES', 'correos-spain'], ['FI', 'posti'], ['FR', 'la-poste'],
  ['GB', 'royal-mail'], ['IN', 'india-post'], ['IT', 'poste-italiane'],
  ['JP', 'japan-post'], ['MY', 'pos-malaysia'], ['NL', 'spring-gds'], ['PT', 'ctt'], ['US', 'usps'],
]);
const englishCountries = new Intl.DisplayNames(['en'], { type: 'region' });
// Deprecated codes carry their successor's name, so fold them into it ("FX" is France).
const currentRegion = (code: string) => new Intl.Locale(`und-${code}`).region ?? code;
// Every region's English name, plus the common short forms, by name key.
const COUNTRY_CODES: ReadonlyMap<string, string> = new Map([
  ...Array.from({ length: 26 * 26 }, (_, index) =>
    String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26)))
    .map((code) => [key(englishCountries.of(code) ?? ''), currentRegion(code)] as const)
    .filter(([name, code]) => name !== '' && name !== code.toLowerCase()),
  ['uk', 'GB'], ['usa', 'US'],
]);

/** Accept ISO codes or exact English country names supplied by a provider. */
export function nationalPostCandidate(country: unknown): CarrierId | undefined {
  if (typeof country !== 'string') return undefined;
  const value = country.trim().toUpperCase();
  const direct = NATIONAL_POSTS.get(value);
  if (direct) return direct;
  return [...NATIONAL_POSTS].find(([code]) => englishCountries.of(code)?.toUpperCase() === value)?.[1];
}

function catalogCarrier(normalized: string): string | undefined {
  if (AMBIGUOUS_BRANDS.includes(normalized)) return undefined;
  if (Object.hasOwn(NAME_ALIASES, normalized)) return NAME_ALIASES[normalized];
  const matches = Object.entries(CARRIER_DEFINITIONS)
    .filter(([id, definition]) => id !== 'unknown' && key(definition.displayName) === normalized);
  return matches.length === 1 ? matches[0][0] : undefined;
}

/** "Chronopost France", "Royal Mail (UK)": the name before a trailing country, and its ISO code. */
function countryQualified(name: string): { base: string; country: string } | undefined {
  const words = name.replace(/[()]/g, ' ').trim().split(/\s+/);
  for (let size = Math.min(3, words.length - 1); size > 0; size--) {
    const tail = words.slice(-size).join(' ');
    const country = COUNTRY_CODES.get(key(tail))
      ?? (/^[A-Z]{2}$/.test(tail) && englishCountries.of(tail) !== tail ? currentRegion(tail) : undefined);
    if (country) return { base: words.slice(0, -size).join(' '), country };
  }
  return undefined;
}

/** A name is only a lookup hint; the destination adapter still has to verify the parcel. */
export function carrierIdFromName(name: string): string | undefined {
  const exact = catalogCarrier(key(name));
  if (exact) return exact;
  // The carrier's own country names the same carrier; another country can be a
  // different company under the brand, and a multi-zone country cannot tell.
  const qualified = countryQualified(name);
  const carrier = qualified && catalogCarrier(key(qualified.base));
  const zone = qualified && countryTimeZone(qualified.country);
  return carrier && zone && CARRIER_DEFINITIONS[carrier as CarrierId]?.timezone === zone ? carrier : undefined;
}

/**
 * Whether a reported carrier name is already in the catalog: a carrier or alias,
 * another network of a brand that has several ("DHL Express", "GLS Italy"), or
 * one of those followed by a country. Any other name is a carrier new to us.
 */
export function isKnownCarrierName(name: string): boolean {
  const qualified = countryQualified(name);
  return [key(name), ...(qualified ? [key(qualified.base)] : [])].some((candidate) =>
    CATALOG_NAMES.has(candidate) || NETWORK_BRANDS.some((brand) => candidate.startsWith(brand)));
}

/** Known portal hosts only. This identifies a lookup hint; it never follows the URL. */
function carriersFromUrl(raw: string): string[] {
  let url: URL;
  try { url = new URL(raw); } catch { return []; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return [];
  // Arrival notices also use the Swiss Post homepage instead of its tracking subdomain.
  if (['post.ch', 'www.post.ch'].includes(url.hostname)) return ['swiss-post'];
  return Object.entries(CARRIER_DEFINITIONS).filter(([, definition]) =>
    definition.linkRules.some((rule) => rule.domains.some((domain) => matchesDomain(url.hostname, domain))),
  ).map(([id]) => id);
}

/** Reconcile a structured partner name and optional official link, without country guesses. */
export function carrierIdFromPartner(name: string, url = ''): string | undefined {
  const named = carrierIdFromName(name);
  const linked = carriersFromUrl(url);
  if (named) return !linked.length || linked.includes(named) ? named : undefined;
  return linked.length === 1 ? linked[0] : undefined;
}

/** Retain ambiguity so weaker hints cannot override conflicting partner links. */
export function carrierIdsFromPartnerLinks(descriptions: (string | null | undefined)[], origin: string): string[] {
  const candidates = new Set(descriptions.flatMap((description) =>
    [...String(description ?? '').matchAll(/https?:\/\/[^\s<>"')]+/gi)]
      .flatMap(([url]) => carriersFromUrl(url)).filter((carrier) => carrier !== origin),
  ));
  return [...candidates];
}

/** An unambiguous partner link in carrier wording may propose one confirmation lookup. */
export function carrierIdFromPartnerLinks(descriptions: (string | null | undefined)[], origin: string): string | undefined {
  const candidates = carrierIdsFromPartnerLinks(descriptions, origin);
  return candidates.length === 1 ? candidates[0] : undefined;
}
