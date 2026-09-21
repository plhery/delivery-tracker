import type { CarrierResult } from './carrierResult';
import { activeRequirements, AUTOMATIC_CARRIER_IDS, carrierAdapter } from './carriers';
import { carrierIdFromPartnerLinks } from '@carriers/core/catalog/hints';
import { detectCarrierMatch, supportsSwissPostHandoff } from '@carriers/core/detection';

export interface DeliveryHandoff {
  carrier: string;
  number: string;
}

export function hasDirectHandoffAdapter(carrier: string, number: string): boolean {
  return AUTOMATIC_CARRIER_IDS.has(carrier) && carrierAdapter(carrier) !== 'universal'
    && activeRequirements(carrier, number).length === 0;
}

/** Propose one lookup from partner evidence or the established Cainiao postal route. */
export function deliveryHandoff(carrier: string, number: string, result: CarrierResult): DeliveryHandoff | null {
  if (result.delivery_tracking_number != null && (typeof result.delivery_tracking_number !== 'string'
    || !/^[A-Z0-9]{4,40}$/.test(result.delivery_tracking_number))) return null;
  let target = result.delivery_carrier ?? carrierIdFromPartnerLinks(
    [result.last_status_text, ...(result.events ?? []).map((event) => event.description)], carrier,
  );
  const reference = result.delivery_tracking_number || number;
  // A downstream reference binds the two identities, but does not prove its
  // operator. Only a unique high-confidence catalog match may propose a probe.
  if (!target && result.delivery_tracking_number) {
    const detected = detectCarrierMatch(reference);
    if (detected.confidence === 'high') target = detected.carrier;
  }
  // Compatibility with the common AliExpress Swiss letter-post journey. This
  // remains a bounded confirmation lookup, never an automatic carrier choice.
  const destination = typeof result.destination_country === 'string' ? result.destination_country
    : typeof result.destination_country_name === 'string' ? result.destination_country_name : undefined;
  if (!target && !result.delivery_tracking_number && ['aliexpress', 'intl-post'].includes(carrier)
    && supportsSwissPostHandoff(number) && (!destination || ['ch', 'switzerland'].includes(destination.trim().toLowerCase()))) {
    target = 'swiss-post';
  }
  if (!target || target === carrier || !/^[A-Z0-9]{4,40}$/.test(reference)
    || !hasDirectHandoffAdapter(target, reference)) return null;
  return { carrier: target, number: reference };
}
