/**
 * PostNL status vocabulary.
 *
 * Every event carries a `category` token next to its localized
 * `status_description`. The category is the stable signal and the only one
 * mapped; the free text is display prose and is never classified here.
 * Categories are matched case-insensitively after trimming, because the
 * international tracker has been seen returning them capitalized
 * ("Pre-advised") and lower case in the same history.
 *
 * `unsuccesfull` is PostNL's own spelling; the corrected spelling is mapped
 * alongside it so a fix upstream does not silently lose the classification.
 */
import type { ClassifiedStatus } from '../../core/status';

const CATEGORY_STATUS = new Map<string, ClassifiedStatus>([
  ['pre-advised', { status: 'pending', stage: 'registered' }],
  ['preparing', { status: 'pending', stage: 'registered' }],
  ['processing', { status: 'in_transit', stage: 'accepted' }],
  ['departed', { status: 'in_transit', stage: 'in_transit' }],
  ['arrived', { status: 'in_transit', stage: 'in_transit' }],
  ['in transit', { status: 'in_transit', stage: 'in_transit' }],
  ['transit', { status: 'in_transit', stage: 'in_transit' }],
  ['customs', { status: 'in_transit', stage: 'customs' }],
  ['out for delivery', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['pick-up point', { status: 'out_for_delivery', stage: 'ready_for_pickup' }],
  ['delivered', { status: 'delivered', stage: 'delivered' }],
  ['unsuccesfull', { status: 'exception', stage: 'failed_attempt' }],
  ['unsuccessful', { status: 'exception', stage: 'failed_attempt' }],
  ['undelivered', { status: 'exception', stage: 'failed_attempt' }],
  ['returned', { status: 'exception', stage: 'returned' }],
  ['exception', { status: 'exception', stage: 'exception' }],
]);

export { CATEGORY_STATUS as POSTNL_STATUS };

/** The status and stage for one PostNL event category, or undefined when unmapped. */
export function postNLStatus(category: unknown): ClassifiedStatus | undefined {
  return CATEGORY_STATUS.get((typeof category === 'string' ? category : '').trim().toLocaleLowerCase('en-US'));
}
