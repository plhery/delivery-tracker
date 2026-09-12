/**
 * DPD Switzerland status vocabulary.
 *
 * Two sources have to agree here. The myDPD guest API answers with an
 * `eventType` / `status.description` enumeration (`DELIVERED`,
 * `AVAILABLE_FOR_COLLECTION`, ...) which is the reliable key; the rendered
 * consignee page has no codes at all, only translated prose, so the page
 * fallback is classified by wording in four languages.
 *
 * Only the enumeration values whose meaning is unambiguous receive an explicit
 * stage. `PARCEL_HANDED`, `IN_TRANSIT` and `AT_DELIVERY_CENTER` deliberately
 * yield no stage: they move the result status to `in_transit` but leave the
 * event unmapped so the sync's classifier records the wording for review
 * instead of this map inventing a milestone.
 *
 * Provenance: the enumeration and its English labels are what the myDPD guest
 * API returns for Swiss consignee lookups; the wording lists come from the
 * public tracking page in en/de/fr/it.
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../core/status';

/** English labels for the guest API enumeration, used when the API sends no translation. */
export const API_LABELS: Record<string, string> = {
  ORDER_CREATED: 'Order created',
  PARCEL_HANDED: 'Parcel handed to DPD',
  IN_TRANSIT: 'Your parcel is on its way',
  AT_DELIVERY_CENTER: 'At delivery center',
  RETURN_TO_SENDER: 'Return to sender',
  PARCEL_OUT_FOR_DELIVERY: 'Parcel out for delivery',
  AVAILABLE_FOR_COLLECTION: 'Ready for collection',
  UNSUCCESSFUL_DELIVERY_ATTEMPT: 'Unsuccessful delivery attempt',
  DELIVERED: 'Delivered',
  OTHER: 'Other tracking update',
};

/** Wording classifier for the rendered page, which carries no status codes. */
export function wordingStatus(text: string, hasEvents: boolean): CarrierStatus {
  const value = text.toLocaleLowerCase('en-US');
  if (['failed', 'not delivered', 'unable', 'problem', 'retour', 'returned']
    .some((term) => value.includes(term))) return 'exception';
  if (['delivered', 'zugestellt', 'livré', 'consegnato']
    .some((term) => value.includes(term))) return 'delivered';
  if (['out for delivery', 'delivery today', 'in zustellung', 'en cours de livraison']
    .some((term) => value.includes(term))) return 'out_for_delivery';
  if (hasEvents || ['handed to dpd', 'on its way', 'arrived', 'depot', 'network']
    .some((term) => value.includes(term))) return 'in_transit';
  if (['data received', 'information received', 'announced', 'übergeben']
    .some((term) => value.includes(term))) return 'pending';
  return 'unknown';
}

/** The result status for a guest API enumeration value, falling back to the wording. */
export function apiStatus(description: unknown, statusText: string, hasEvents: boolean): CarrierStatus {
  const key = String(description ?? '').toUpperCase();
  if (key === 'DELIVERED') return 'delivered';
  if (['PARCEL_OUT_FOR_DELIVERY', 'AVAILABLE_FOR_COLLECTION'].includes(key)) {
    return 'out_for_delivery';
  }
  if (['RETURN_TO_SENDER', 'UNSUCCESSFUL_DELIVERY_ATTEMPT'].includes(key)) {
    // A failed attempt is a retry, not terminal; a return is terminal but
    // stays in the exception status with a returned stage (no returning status).
    return key === 'RETURN_TO_SENDER' ? 'exception' : 'in_transit';
  }
  if (key === 'ORDER_CREATED') return 'pending';
  if (['PARCEL_HANDED', 'IN_TRANSIT', 'AT_DELIVERY_CENTER'].includes(key)) return 'in_transit';
  return wordingStatus(statusText, hasEvents);
}

/** The stage for a guest API enumeration value, or null when the value is not mapped. */
export function apiStage(description: unknown): Stage | null {
  const key = String(description ?? '').toUpperCase();
  if (key === 'AVAILABLE_FOR_COLLECTION') return 'ready_for_pickup';
  if (key === 'PARCEL_OUT_FOR_DELIVERY') return 'out_for_delivery';
  if (key === 'RETURN_TO_SENDER') return 'returned';
  if (key === 'UNSUCCESSFUL_DELIVERY_ATTEMPT') return 'failed_attempt';
  if (key === 'ORDER_CREATED') return 'registered';
  if (key === 'DELIVERED') return 'delivered';
  return null;
}
