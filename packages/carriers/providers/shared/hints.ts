/**
 * Carrier names a universal provider reports for a shipment, mapped to catalog
 * ids when the mapping is unambiguous.
 *
 * The names are discovery hints: routing may use one to try a dedicated
 * adapter, but only that adapter confirming the shipment adopts the carrier.
 * Nothing here decides a carrier on its own.
 */
import { CARRIER_DEFINITIONS } from '../../core/catalog';

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Names are hints only. A direct adapter must confirm the shipment before adoption. */
export function universalCarrierHints(raw: unknown[]): { reported_carriers: string[]; discovered_carrier?: string } {
  const names = [...new Set(raw.filter((value): value is string => typeof value === 'string'
    && value.length <= 80 && /^[\p{L}\p{N} .&'()-]+$/u.test(value)).map((value) => value.trim()))].filter(Boolean).slice(0, 10);
  const aliases: Record<string, string> = {
    ups: 'ups', swisspost: 'swiss-post', laposte: 'la-poste', colissimo: 'la-poste',
    dhlecommerce: 'dhl-ecommerce', cainiao: 'aliexpress', postnl: 'spring-gds',
  };
  const detected = new Set<string>();
  for (const name of names) {
    const normalized = key(name);
    // Generic multi-country brands cannot choose a national/service adapter.
    if (['dhl', 'dpd', 'gls', 'hermes', 'post'].includes(normalized)) continue;
    if (aliases[normalized]) detected.add(aliases[normalized]);
    else for (const [id, definition] of Object.entries(CARRIER_DEFINITIONS)) {
      if (typeof definition.displayName === 'string' && key(definition.displayName) === normalized) detected.add(id);
    }
  }
  return { reported_carriers: names,
    ...(names.length === 1 && detected.size === 1 ? { discovered_carrier: [...detected][0] } : {}),
  };
}
