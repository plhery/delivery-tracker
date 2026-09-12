/**
 * Pos Malaysia status vocabulary.
 *
 * `process_summary` is the short English label on each tracking row; the longer
 * `process` sentence next to it is display prose and is never mapped. Only the
 * parcel-level `process_status` value "DELIVERED" is a closed overall state —
 * everything else is derived from the latest event.
 *
 * Unlike the open vocabularies elsewhere in this package, an unmapped summary
 * keeps the `in_transit` event default rather than no stage at all: every row
 * here is a physical scan, so "something moved" is the safe reading, and the
 * result still reports the derived status rather than inventing a terminal one.
 *
 * Provenance: the vendor's own shipped demo parcel in the official tracking SPA
 * bundle (`https://tracking.pos.com.my`, inspected 2026-09-10), a delivered
 * consignment carrying all six summaries below.
 */
import type { ClassifiedStatus } from '../../core/status';

const SUMMARY_STATUS: Record<string, ClassifiedStatus> = {
  'Delivery completed': { status: 'delivered', stage: 'delivered' },
  'Out for delivery': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  'Preparing for delivery': { status: 'in_transit', stage: 'in_transit' },
  'Sorting completed': { status: 'in_transit', stage: 'in_transit' },
  'On the way': { status: 'in_transit', stage: 'in_transit' },
  'Collected': { status: 'in_transit', stage: 'accepted' },
};

/** The default for a summary the map does not know: a scan happened, nothing more. */
export const POS_MALAYSIA_DEFAULT_STATUS: ClassifiedStatus = { status: 'in_transit', stage: 'in_transit' };

/** The stage and status for one `process_summary`, falling back to the scan default. */
export function classifyPosMalaysiaStatus(summary: string): ClassifiedStatus {
  return SUMMARY_STATUS[summary] ?? POS_MALAYSIA_DEFAULT_STATUS;
}

/** Whether the map knows this summary, for tests and documentation. */
export function isMappedPosMalaysiaSummary(summary: string): boolean {
  return Object.hasOwn(SUMMARY_STATUS, summary);
}
