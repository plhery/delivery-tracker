/**
 * Carrier names a universal provider reports for a shipment, mapped to catalog
 * ids when the mapping is unambiguous.
 *
 * The names are discovery hints: routing may use one to try a dedicated
 * adapter, but only that adapter confirming the shipment adopts the carrier.
 * Nothing here decides a carrier on its own.
 */
import type { CarrierId } from '../../generated/catalog';
import { brandCarrierIds, carrierIdFromName } from '../../core/catalog/hints';
import { detectCarrierMatch } from '../../core/detection';

export { isKnownCarrierName } from '../../core/catalog/hints';

/**
 * A bare brand ("DPD Group") names several catalog networks; the number can
 * still pick one. Keep the networks whose detection rules match it, then the
 * one a preferred rule backs, such as a DPD depot range. Anything else stays
 * unresolved rather than guessed.
 */
export function brandCarrierForNumber(name: string, trackingNumber: string): string | undefined {
  const networks = brandCarrierIds(name);
  if (!networks.length) return undefined;
  const detected = detectCarrierMatch(trackingNumber);
  const matching = networks.filter((id) => detected.candidates.includes(id as CarrierId));
  if (matching.length === 1) return matching[0];
  const preferred = matching.filter((id) => detected.preferred.includes(id as CarrierId));
  return preferred.length === 1 ? preferred[0] : undefined;
}

/**
 * Names are hints only. A direct adapter must confirm the shipment before
 * adoption. The looked-up number resolves a bare brand name.
 */
export function universalCarrierHints(raw: unknown[], trackingNumber?: string): { reported_carriers: string[]; discovered_carrier?: string } {
  const names = [...new Set(raw.filter((value): value is string => typeof value === 'string'
    && value.length <= 80 && /^[\p{L}\p{N} .&'()-]+$/u.test(value)).map((value) => value.trim()))].filter(Boolean).slice(0, 10);
  const detected = new Set<string>();
  for (const name of names) {
    const carrier = carrierIdFromName(name) ?? (trackingNumber ? brandCarrierForNumber(name, trackingNumber) : undefined);
    if (carrier) detected.add(carrier);
  }
  return { reported_carriers: names,
    ...(names.length === 1 && detected.size === 1 ? { discovered_carrier: [...detected][0] } : {}),
  };
}
