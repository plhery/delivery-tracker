/**
 * Pos Malaysia status vocabulary.
 *
 * `process_summary` is the short English label on each tracking row; the longer
 * `process` sentence next to it is display prose and is never mapped. Only the
 * parcel-level `process_status` value "DELIVERED" is a closed overall state —
 * everything else is derived from the latest event.
 *
 * Unknown summaries remain visible without inventing a movement or terminal
 * stage. The fixed labels come from the official tracking SPA's sample data
 * and identity-bound tracking responses.
 */
import type { ClassifiedStatus } from '../../core/status';

const SUMMARY_STATUS: Record<string, ClassifiedStatus> = {
  'Delivery completed': { status: 'delivered', stage: 'delivered' },
  'Out for delivery': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  'Preparing for delivery': { status: 'in_transit', stage: 'in_transit' },
  'Sorting completed': { status: 'in_transit', stage: 'in_transit' },
  'On the way': { status: 'in_transit', stage: 'in_transit' },
  'Collected': { status: 'in_transit', stage: 'accepted' },
  'Item arrived at delivery office': { status: 'in_transit', stage: 'in_transit' },
  'Your parcel is being transported to the next facility': { status: 'in_transit', stage: 'in_transit' },
  'Your parcel has arrived at destination facility for Processing': { status: 'in_transit', stage: 'in_transit' },
  'Your parcel is being transported to destination country': { status: 'in_transit', stage: 'in_transit' },
  'Your parcel has arrived at our facility for sorting': { status: 'in_transit', stage: 'in_transit' },
};

/** Only explicit summaries establish a stage. */
export function classifyPosMalaysiaStatus(summary: string): ClassifiedStatus | null {
  return Object.hasOwn(SUMMARY_STATUS, summary) ? SUMMARY_STATUS[summary]! : null;
}

/** Whether the map knows this summary, for tests and documentation. */
export function isMappedPosMalaysiaSummary(summary: string): boolean {
  return Object.hasOwn(SUMMARY_STATUS, summary);
}
