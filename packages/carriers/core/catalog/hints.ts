import { CARRIER_DEFINITIONS } from './definitions';

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
  if (aliases[normalized]) return aliases[normalized];
  const matches = Object.entries(CARRIER_DEFINITIONS)
    .filter(([, definition]) => key(definition.displayName) === normalized);
  return matches.length === 1 ? matches[0][0] : undefined;
}
