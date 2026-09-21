import { CARRIER_DEFINITIONS } from './definitions';
import { matchesDomain } from './linkRules';

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A name is only a lookup hint; the destination adapter still has to verify the parcel. */
export function carrierIdFromName(name: string): string | undefined {
  const normalized = key(name);
  // These brands have several regional/service adapters.
  if (['dhl', 'dpd', 'gls', 'hermes', 'post'].includes(normalized)) return undefined;
  const aliases: Record<string, string> = {
    ups: 'ups', swisspost: 'swiss-post', laposte: 'la-poste', colissimo: 'la-poste',
    dhlecommerce: 'dhl-ecommerce', cainiao: 'aliexpress', postnl: 'spring-gds',
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

/** An unambiguous partner link in carrier wording may propose one confirmation lookup. */
export function carrierIdFromPartnerLinks(descriptions: (string | null | undefined)[], origin: string): string | undefined {
  const candidates = new Set(descriptions.flatMap((description) =>
    [...String(description ?? '').matchAll(/https?:\/\/[^\s<>"')]+/gi)]
      .flatMap(([url]) => carriersFromUrl(url)).filter((carrier) => carrier !== origin),
  ));
  return candidates.size === 1 ? [...candidates][0] : undefined;
}
