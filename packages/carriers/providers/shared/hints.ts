/**
 * Carrier names a universal provider reports for a shipment, mapped to catalog
 * ids when the mapping is unambiguous.
 *
 * The names are discovery hints: routing may use one to try a dedicated
 * adapter, but only that adapter confirming the shipment adopts the carrier.
 * Nothing here decides a carrier on its own.
 */
import { carrierIdFromName } from '../../core/catalog/hints';

export { isKnownCarrierName } from '../../core/catalog/hints';

/** Names are hints only. A direct adapter must confirm the shipment before adoption. */
export function universalCarrierHints(raw: unknown[]): { reported_carriers: string[]; discovered_carrier?: string } {
  const names = [...new Set(raw.filter((value): value is string => typeof value === 'string'
    && value.length <= 80 && /^[\p{L}\p{N} .&'()-]+$/u.test(value)).map((value) => value.trim()))].filter(Boolean).slice(0, 10);
  const detected = new Set<string>();
  for (const name of names) {
    const carrier = carrierIdFromName(name);
    if (carrier) detected.add(carrier);
  }
  return { reported_carriers: names,
    ...(names.length === 1 && detected.size === 1 ? { discovered_carrier: [...detected][0] } : {}),
  };
}
