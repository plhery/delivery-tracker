import { CARRIER_DEFINITIONS } from './definitions';
import { matchesDomain } from './linkRules';
import type { CarrierId } from '../../generated/catalog';

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

// Postal lookup candidates, not proof of which operator delivers a shipment.
// Only operators with a dedicated adapter are useful here. The host also
// checks adapter availability and required inputs before making a request.
const NATIONAL_POSTS: ReadonlyMap<string, CarrierId> = new Map([
  ['CA', 'canada-post'], ['CH', 'swiss-post'], ['DE', 'dhl'],
  ['ES', 'correos-spain'], ['FI', 'posti'], ['FR', 'la-poste'],
  ['GB', 'royal-mail'], ['IN', 'india-post'], ['IT', 'poste-italiane'],
  ['MY', 'pos-malaysia'], ['NL', 'spring-gds'], ['PT', 'ctt'], ['US', 'usps'],
]);
const englishCountries = new Intl.DisplayNames(['en'], { type: 'region' });

/** Accept ISO codes or exact English country names supplied by a provider. */
export function nationalPostCandidate(country: unknown): CarrierId | undefined {
  if (typeof country !== 'string') return undefined;
  const value = country.trim().toUpperCase();
  const direct = NATIONAL_POSTS.get(value);
  if (direct) return direct;
  return [...NATIONAL_POSTS].find(([code]) => englishCountries.of(code)?.toUpperCase() === value)?.[1];
}

/** A name is only a lookup hint; the destination adapter still has to verify the parcel. */
export function carrierIdFromName(name: string): string | undefined {
  const normalized = key(name);
  // These brands have several regional/service adapters.
  if (['dhl', 'dpd', 'gls', 'hermes', 'post'].includes(normalized)) return undefined;
  const aliases: Record<string, string> = {
    ups: 'ups', swisspost: 'swiss-post', laposte: 'la-poste', colissimo: 'la-poste',
    dhlecommerce: 'dhl-ecommerce', cainiao: 'aliexpress', postnl: 'spring-gds',
    asendiausa: 'asendia',
  };
  if (Object.hasOwn(aliases, normalized)) return aliases[normalized];
  const matches = Object.entries(CARRIER_DEFINITIONS)
    .filter(([id, definition]) => id !== 'unknown' && key(definition.displayName) === normalized);
  return matches.length === 1 ? matches[0][0] : undefined;
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
