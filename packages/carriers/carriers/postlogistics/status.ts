/**
 * PostLogistics status vocabulary.
 *
 * Every history entry carries a three-letter `Status` code next to its
 * free-text `Description`. Only the codes that decide the shipment's outcome
 * are mapped; everything else stays `in_transit` and the description is left
 * for the sync's wording classifier. The map is deliberately small: a wrong
 * "delivered" is worse than a missing nuance.
 *
 * The adapter classifies the shipment, not each event: the endpoint gives one
 * code per scan but no stage vocabulary, so events are returned without an
 * explicit stage and the sync records them for review.
 */
import type { CarrierStatus } from '../../core/result';

/** Codes that mean the parcel reached its recipient. */
export const POSTLOGISTICS_DELIVERED_CODES = ['DEL', 'DLV', 'POD', 'SIG'] as const;

/** The code that means the shipment is announced but not yet moving. */
export const POSTLOGISTICS_NOTIFIED_CODE = 'NTF';

/** The shipment status the newest history code implies. */
export function postlogisticsStatus(code: string): CarrierStatus {
  if ((POSTLOGISTICS_DELIVERED_CODES as readonly string[]).includes(code)) return 'delivered';
  if (code === POSTLOGISTICS_NOTIFIED_CODE) return 'pending';
  return 'in_transit';
}
