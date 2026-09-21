import type { CarrierResult } from './carrierResult';
import { activeRequirements, AUTOMATIC_CARRIER_IDS, carrierAdapter } from './carriers';
import { carrierIdFromPartnerLinks } from '@carriers/core/catalog/hints';

export interface DeliveryHandoff {
  carrier: string;
  number: string;
}

export function hasDirectHandoffAdapter(carrier: string, number: string): boolean {
  return AUTOMATIC_CARRIER_IDS.has(carrier) && carrierAdapter(carrier) !== 'universal'
    && activeRequirements(carrier, number).length === 0;
}

/** One reported partner to verify, never an inference from destination or postal issuer. */
export function deliveryHandoff(carrier: string, number: string, result: CarrierResult): DeliveryHandoff | null {
  const target = result.delivery_carrier ?? carrierIdFromPartnerLinks(
    [result.last_status_text, ...(result.events ?? []).map((event) => event.description)], carrier,
  );
  const reference = result.delivery_tracking_number || number;
  if (!target || target === carrier || !/^[A-Z0-9]{4,40}$/.test(reference)
    || !hasDirectHandoffAdapter(target, reference)) return null;
  return { carrier: target, number: reference };
}
