/**
 * Planzer (and Quickpac) status vocabulary.
 *
 * Two routes, two vocabularies:
 *
 * - The tracking API returns an English label per shipment and per milestone
 *   (`overallStatus.text.english`, `positionEvents[].text.english`). Planzer's
 *   English "Shipped" means "Zugestellt" / "Livré" — delivered, not dispatched
 *   — so each milestone is classified on its own instead of inheriting the
 *   shipment's current status.
 * - The shared capability page renders a five-step route whose step labels are
 *   localized; `planzerRouteStage()` recognizes them by substring.
 *
 * An API label that is in neither map is an error rather than an unmapped
 * event: the adapter refuses to turn unfamiliar wording into history.
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../core/status';

/** Shipment-level English labels from `overallStatus.text.english`. */
export const PLANZER_STATUS = new Map<string, CarrierStatus>([
  ['Recorded', 'pending'],
  ['Transferred', 'in_transit'],
  ['Shipment on the way', 'in_transit'],
  ['In delivery', 'out_for_delivery'],
  ['Shipment out for delivery', 'out_for_delivery'],
  ['Delivered', 'delivered'],
  ['Shipment delivered', 'delivered'],
  ['Shipped', 'delivered'],
  ['Not delivered', 'exception'],
]);

// Classify each milestone independently of the shipment's current status.
// Planzer's English "Shipped" means "Zugestellt" / "Livré", not dispatched.
export const PLANZER_EVENT_STAGE = new Map<string, Stage>([
  ['Recorded', 'registered'],
  ['Transferred', 'in_transit'],
  ['Shipment on the way', 'in_transit'],
  ['In delivery', 'out_for_delivery'],
  ['Shipment out for delivery', 'out_for_delivery'],
  ['Delivered', 'delivered'],
  ['Shipment delivered', 'delivered'],
  ['Shipped', 'delivered'],
  ['Not delivered', 'failed_attempt'],
]);

// GENERATED localization aliases, kept separate from the observed English API
// labels above. Prefer a future observed label/code if it contradicts an alias.
// Livré/Zugestellt are semantic equivalents of Planzer's unusual Shipped label;
// Expédié/Versandt/Spedito are intentionally absent.
export const PLANZER_TRANSLATED_EVENT_STAGE = new Map<string, Stage>([
  ['enregistré', 'registered'], ['erfasst', 'registered'], ['registrato', 'registered'],
  ['transféré', 'in_transit'], ['weitergeleitet', 'in_transit'], ['inoltrato', 'in_transit'],
  ['en cours de livraison', 'out_for_delivery'], ['in zustellung', 'out_for_delivery'], ['in consegna', 'out_for_delivery'],
  ['livré', 'delivered'], ['zugestellt', 'delivered'], ['consegnato', 'delivered'],
]);

/** The milestone stage for one API label, or undefined when the label is unknown. */
export function planzerEventStage(description: string): Stage | undefined {
  return PLANZER_EVENT_STAGE.get(description)
    ?? PLANZER_TRANSLATED_EVENT_STAGE.get(description.toLowerCase().replace(/[.!]$/, ''));
}

/** The five steps the shared capability page draws, in the order it draws them. */
export const PLANZER_ROUTE_STAGES = [
  'registered',
  'accepted',
  'in_transit',
  'out_for_delivery',
  'delivered',
] as const;

export type PlanzerRouteStage = (typeof PLANZER_ROUTE_STAGES)[number];

// The shared page labels its route steps in the recipient's language and
// renders no code, so each stage is recognized by the substrings the German,
// English, French and Italian labels have in common.
const ROUTE_LABEL_RULES: ReadonlyArray<readonly [PlanzerRouteStage, readonly string[]]> = [
  ['delivered', ['ausgeliefert', 'delivered', 'livré', 'livrée', 'consegnat']],
  ['out_for_delivery', ['in auslieferung', 'out for delivery', 'en livraison', 'in consegna']],
  ['in_transit', ['umschlaglager', 'transfer depot', 'transshipment', 'plateforme', 'trasbordo']],
  ['accepted', ['abholung', 'collection', 'collecte', 'ritiro']],
  ['registered', ['erfasst', 'recorded', 'enregistr', 'registrat']],
];

/** The route stage a shared-page step label names, or null when it names none. */
export function planzerRouteStage(label: string): PlanzerRouteStage | null {
  const value = label.toLocaleLowerCase();
  return ROUTE_LABEL_RULES.find(([, needles]) => needles.some((needle) => value.includes(needle)))?.[0] ?? null;
}

/** The shipment status a reached route stage implies. */
export const PLANZER_ROUTE_STATUS: Record<PlanzerRouteStage, CarrierStatus> = {
  registered: 'pending',
  accepted: 'in_transit',
  in_transit: 'in_transit',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
};
