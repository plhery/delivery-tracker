/**
 * Carrier scan vocabularies for histories a universal provider relays.
 *
 * Some carriers reach us only through aggregators, which pass the carrier's own
 * scan labels through, sometimes machine-translated. When the provider names
 * the carrier of a scan and that carrier has a vocabulary, the label's stage and
 * stored wording come from it rather than from the shared wording rules.
 */
import type { CarrierEvent } from '../../core/result';
import type { Stage } from '../../core/status';
import { ytoScan } from '../../carriers/yto/status';

export interface CarrierScan {
  stage: Stage;
  wording: string;
}

const VOCABULARIES: Readonly<Record<string, (label: string) => CarrierScan | undefined>> = {
  yto: ytoScan,
};

/** The vocabulary entry for one relayed label, when its carrier has a vocabulary. */
export function carrierScan(carrier: string | undefined, label: string): CarrierScan | undefined {
  return carrier && Object.hasOwn(VOCABULARIES, carrier) ? VOCABULARIES[carrier](label) : undefined;
}

// After the carrier's own return scan, its delivery-side scans are the trip
// back: the sender signing for the parcel is a return, not a delivery.
const RETURN_LEG: Partial<Record<Stage, string>> = {
  out_for_delivery: 'Out for delivery back to the sender',
  ready_for_pickup: 'In a parcel locker or station on its way back',
  delivered: 'Returned to the sender',
};

/** Rewrites the delivery-side scans that follow a vocabulary return scan. */
export function markReturnLeg(scans: ReadonlyArray<{ event: CarrierEvent; scan: CarrierScan }>): void {
  const started = scans.filter(({ scan }) => scan.stage === 'returned')
    .map(({ event }) => event.time ?? '').filter(Boolean).sort()[0];
  if (!started) return;
  for (const { event, scan } of scans) {
    const wording = RETURN_LEG[scan.stage];
    if (wording && (event.time ?? '') > started) Object.assign(event, { description: wording, stage: 'returned' });
  }
}
