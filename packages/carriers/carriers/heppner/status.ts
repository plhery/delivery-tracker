/**
 * Heppner milestone, state and event-code vocabulary → product stage.
 *
 * The public recipient endpoint sends three fields per scan: a `step` (the
 * milestone reached), a `state` (the shipment-level state) and an event `code`
 * whose prefix repeats the milestone. Mapping reads the milestone first and
 * the code prefix second, so a code we have not seen inside a known milestone
 * still lands on the right stage.
 *
 * The endpoint carries no human-readable wording, only these identifiers, so
 * each mapped entry also supplies the English description we display. Anything
 * unmapped keeps a neutral description and no explicit stage assignment beyond
 * the transit default the previous implementation used.
 */
import type { CarrierStatus } from '../../core/result';
import { cleanScalar } from '../../core/transport';
import type { Stage } from '../../generated/catalog';

export interface ClassifiedHeppnerEvent {
  status: CarrierStatus;
  stage: Stage;
  description: string;
}

/**
 * Normalize a provider step, state or event code. Values that are not an
 * upper-case identifier become '' so they can never reach a result field.
 */
export function heppnerCode(value: unknown): string {
  const normalized = cleanScalar(value, 64).toLocaleUpperCase('en-US');
  return /^[A-Z0-9]{2,32}(?:_[A-Z0-9]{2,32})*$/.test(normalized) ? normalized : '';
}

/** Map one scan to a stage. Order matters: terminal milestones win over transit ones. */
export function classifyHeppnerEvent(
  stepValue: unknown,
  stateValue: unknown,
  codeValue: unknown,
): ClassifiedHeppnerEvent {
  const step = heppnerCode(stepValue);
  const state = heppnerCode(stateValue);
  const providerCode = heppnerCode(codeValue);

  if (step === 'MARCHANDISE_RETOURNEE' || /^(?:SOL|RET)_/.test(providerCode)) {
    return { status: 'exception', stage: 'returned', description: 'Returned to sender' };
  }
  if (step === 'LIVREE' || /^(?:LIV|POD)_/.test(providerCode)) {
    return { status: 'delivered', stage: 'delivered', description: 'Delivered' };
  }
  if (state === 'ANOMALIE' || step === 'EN_ATTENTE_INSTRUCTIONS') {
    return {
      status: 'exception',
      stage: 'failed_attempt',
      description: step === 'EN_ATTENTE_INSTRUCTIONS'
        ? 'Delivery instructions required'
        : 'Shipment exception',
    };
  }
  if (step === 'LIVRAISON' || providerCode.startsWith('MLV_')) {
    return { status: 'out_for_delivery', stage: 'out_for_delivery', description: 'Out for delivery' };
  }
  if (step === 'PRISE_EN_CHARGE' || providerCode.startsWith('PCH_')) {
    return { status: 'in_transit', stage: 'accepted', description: 'Shipment collected' };
  }
  if (step === 'MARCHANDISE_REEXPEDIEE') {
    return { status: 'in_transit', stage: 'in_transit', description: 'Shipment forwarded' };
  }
  if (step === 'ACHEMINEMENT') {
    return { status: 'in_transit', stage: 'in_transit', description: 'In transit' };
  }
  return { status: 'unknown', stage: 'in_transit', description: 'Heppner tracking update' };
}
