import type { CarrierResult } from './carrierResult';
import { activeRequirements, AUTOMATIC_CARRIER_IDS, carrierAdapter } from './carriers';
import { carrierIdsFromPartnerLinks, nationalPostCandidate } from '@carriers/core/catalog/hints';
import { detectCarrierMatch, isValidS10TrackingNumber, supportsSwissPostHandoff } from '@carriers/core/detection';

export interface DeliveryHandoff {
  carrier: string;
  number: string;
  basis: 'partner' | 'destination' | 'reference';
}

export function hasDirectHandoffAdapter(carrier: string, number: string): boolean {
  return AUTOMATIC_CARRIER_IDS.has(carrier) && carrierAdapter(carrier) !== 'universal'
    && activeRequirements(carrier, number).length === 0;
}

/** Propose one confirmation lookup; a candidate never changes the carrier by itself. */
export function deliveryHandoff(carrier: string, number: string, result: CarrierResult): DeliveryHandoff | null {
  if (result.delivery_tracking_number != null && (typeof result.delivery_tracking_number !== 'string'
    || !/^[A-Z0-9]{4,40}$/.test(result.delivery_tracking_number))) return null;
  const linked = carrierIdsFromPartnerLinks(
    [result.last_status_text, ...(result.events ?? []).map((event) => event.description)], carrier,
  );
  if (!result.delivery_carrier && linked.length > 1) return null;
  let target: string | undefined = result.delivery_carrier ?? linked[0];
  let basis: DeliveryHandoff['basis'] = 'partner';
  const reference = result.delivery_tracking_number || number;
  const destination = typeof result.destination_country === 'string' ? result.destination_country
    : typeof result.destination_country_name === 'string' ? result.destination_country_name : undefined;
  // S10 binds the postal identity across borders. Its issuer suffix does not
  // identify the destination operator; try that country's post only when no
  // partner is named, and let the shared progress/freshness checks confirm it.
  if (!target && isValidS10TrackingNumber(reference)) {
    target = nationalPostCandidate(destination);
    if (target) basis = 'destination';
  }
  // A downstream reference binds the two identities, but does not prove its
  // operator. Only a unique high-confidence catalog match may propose a probe.
  if (!target && result.delivery_tracking_number) {
    const detected = detectCarrierMatch(reference);
    if (detected.confidence === 'high') { target = detected.carrier; basis = 'reference'; }
  }
  // Compatibility with the common AliExpress Swiss letter-post journey. This
  // remains a bounded confirmation lookup, never an automatic carrier choice.
  if (!target && !result.delivery_tracking_number && ['aliexpress', 'intl-post'].includes(carrier)
    && supportsSwissPostHandoff(number) && (!destination || ['ch', 'switzerland'].includes(destination.trim().toLowerCase()))) {
    target = 'swiss-post';
    basis = 'reference';
  }
  if (!target || target === carrier || !/^[A-Z0-9]{4,40}$/.test(reference)
    || !hasDirectHandoffAdapter(target, reference)) return null;
  return { carrier: target, number: reference, basis };
}
