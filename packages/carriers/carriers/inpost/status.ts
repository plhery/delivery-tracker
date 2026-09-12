/**
 * InPost status vocabulary for the public inposteasy.com hub.
 *
 * Codes are `<PHASE>.<NNNN>` strings (CRE creation, FMD first mile, MMD middle
 * mile, LMD last mile, RTS return to sender, EOL end of life). The
 * cross-border vocabulary is explicitly still being observed, so an unmapped
 * code yields no stage at all: the event keeps its raw wording, the result
 * reports `unknown`, and the sync classifies and records it.
 *
 * Provenance: derived from the prior-art client
 * https://github.com/ha-parcel-integrations/ha-inpost (MIT,
 * `TRACKING_STATUS_MAP`), live-confirmed on IT/PT/GB consignments 2026-08-31.
 */
import type { ClassifiedStatus } from '../../core/status';

const TRACKING_STATUS: Record<string, ClassifiedStatus> = {
  // Creation and handover.
  'CRE.1001': { status: 'pending', stage: 'registered' },
  'FMD.1001': { status: 'pending', stage: 'registered' },
  'FMD.1002': { status: 'in_transit', stage: 'in_transit' },
  // Logistics-centre movement.
  'MMD.1001': { status: 'in_transit', stage: 'in_transit' },
  'MMD.1002': { status: 'in_transit', stage: 'in_transit' },
  'MMD.1003': { status: 'in_transit', stage: 'in_transit' },
  'MMD.1004': { status: 'in_transit', stage: 'in_transit' },
  // Last-mile, redirects and collection.
  'LMD.1001': { status: 'in_transit', stage: 'in_transit' },
  'LMD.1002': { status: 'in_transit', stage: 'in_transit' },
  'LMD.3006': { status: 'in_transit', stage: 'in_transit' },
  'LMD.3014': { status: 'in_transit', stage: 'in_transit' },
  'LMD.1004': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  'LMD.1005': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  'LMD.9001': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  'LMD.9002': { status: 'exception', stage: 'failed_attempt' },
  'LMD.9014': { status: 'exception', stage: 'returned' },
  // Terminal outcomes.
  'EOL.1001': { status: 'delivered', stage: 'delivered' },
  'EOL.1003': { status: 'delivered', stage: 'delivered' },
  'EOL.9001': { status: 'exception', stage: 'failed_attempt' },
  'RTS.1001': { status: 'exception', stage: 'returned' },
  'RTS.1002': { status: 'exception', stage: 'returned' },
};

/** The stage and status for an InPost hub status code, or undefined when unmapped. */
export function classifyInpostStatus(code: string): ClassifiedStatus | undefined {
  return TRACKING_STATUS[code];
}
