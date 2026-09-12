/**
 * C Chez Vous order steps.
 *
 * The tracking page is a five-step progress bar, and the JSON it embeds reports
 * that step per parcel as `parcelStep`. There is no wording and no scan
 * history: the step is the whole status vocabulary, and the French descriptions
 * below are the ones the page prints beside each step.
 *
 * A value outside 1–5 is a step this map does not know. It is reported as
 * `UNKNOWN_STEP` rather than clamped to a documented step, so the sync
 * classifies it and records it for review instead of us claiming an order has
 * not started.
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../generated/catalog';

export interface StepDetails {
  status: CarrierStatus;
  stage: Stage;
  description: string;
}

/** Sorts below every documented step, so an unknown parcel makes the order unknown. */
export const UNKNOWN_STEP = 0;

export const UNKNOWN_STEP_DESCRIPTION = 'Suivi C Chez Vous';

export const STEP_DETAILS: Record<number, StepDetails> = {
  1: { status: 'pending', stage: 'registered', description: 'Commande enregistrée' },
  2: { status: 'pending', stage: 'registered', description: 'Prise de rendez-vous' },
  3: { status: 'in_transit', stage: 'in_transit', description: 'Commande en préparation' },
  4: { status: 'out_for_delivery', stage: 'out_for_delivery', description: 'Commande en livraison' },
  5: { status: 'delivered', stage: 'delivered', description: 'Commande livrée' },
};

/** The documented step of one parcel, or `UNKNOWN_STEP` when it is not one of the five. */
export function parcelStep(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
    ? value
    : UNKNOWN_STEP;
}

export function stepDetails(step: number): StepDetails | null {
  return STEP_DETAILS[step] ?? null;
}
