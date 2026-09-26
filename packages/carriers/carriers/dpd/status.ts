/**
 * DPD Switzerland status vocabulary.
 *
 * Three sources have to agree here. The myDPD guest API answers with a
 * `parcelHistory[].description` / `status.description` enumeration
 * (`DELIVERED`, `AVAILABLE_FOR_COLLECTION`, ...), which is the reliable key. A
 * verified-postcode lookup adds `parcelEvents[].eventType` scan codes (`DEY`,
 * `DLO`, ...). The rendered consignee page has no codes at all, only
 * translated prose, so the page fallback is classified by wording in four
 * languages.
 *
 * Only the values whose meaning is unambiguous receive an explicit stage.
 * `PARCEL_HANDED`, `IN_TRANSIT` and `AT_DELIVERY_CENTER` deliberately yield no
 * stage: they move the result status to `in_transit` but leave the event
 * unmapped so the sync's classifier records the wording for review instead of
 * this map inventing a milestone. Scan codes are mapped only where a live
 * lookup paired them with an enumeration value (see `scanStage`).
 *
 * Provenance: the enumeration, the scan codes and their English labels are
 * what the myDPD guest API returns for Swiss consignee lookups; the wording
 * lists come from the public tracking page in en/de/fr/it.
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
  const key = typeof description === 'string' ? description.trim().toUpperCase() : '';
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
  const key = typeof description === 'string' ? description.trim().toUpperCase() : '';
  if (key === 'AVAILABLE_FOR_COLLECTION') return 'ready_for_pickup';
  if (key === 'PARCEL_OUT_FOR_DELIVERY') return 'out_for_delivery';
  if (key === 'RETURN_TO_SENDER') return 'returned';
  if (key === 'UNSUCCESSFUL_DELIVERY_ATTEMPT') return 'failed_attempt';
  if (key === 'ORDER_CREATED') return 'registered';
  if (key === 'DELIVERED') return 'delivered';
  return null;
}

/**
 * `parcelEvents[].eventType` scan codes. On 2026-09-26 a verified lookup
 * listed ORI, DLI, DLO and DEY at the same wall clock as the `parcelHistory`
 * enumeration named beside them. CCO has no twin; it ends customs clearance.
 * ORI ("Origin depot - In") stays unmapped like its twin PARCEL_HANDED: the
 * result stage then comes from the same wording as the scan's, and an import
 * that cleared customs does not step back to accepted. Other codes stay
 * unmapped.
 */
const SCAN_STAGES: Readonly<Record<string, Stage>> = {
  CCO: 'in_transit', // "Customs - Out"
  DLI: 'in_transit', // "Destination depot - Inbound", twin AT_DELIVERY_CENTER
  DLO: 'out_for_delivery', // "Destination depot - Out for delivery", twin PARCEL_OUT_FOR_DELIVERY
  DEY: 'delivered', // "Delivery - Delivered", twin DELIVERED
};

/** The stage for a guest API scan code, or null when the code is not mapped. */
export function scanStage(code: string): Stage | null {
  return Object.hasOwn(SCAN_STAGES, code) ? SCAN_STAGES[code]! : null;
}

/**
 * "Delivery - Proof of delivery": DPD filing the proof minutes after DEY,
 * with no place. Paperwork, not a movement of the parcel.
 */
export const PROOF_OF_DELIVERY_SCAN = 'DEYY';
