/**
 * Status vocabulary and the shared wording classifier.
 *
 * What it is: the product `Stage` vocabulary re-exported for adapters, the
 * `ClassifiedStatus` pair every carrier status map produces, and the
 * multilingual wording → stage rules used as a fallback when a carrier has no
 * explicit map for an event. What it is not: it never talks to a provider and
 * never persists anything; the host's sync decides precedence and records
 * where each stage came from.
 */
import type { CarrierStatus } from '../result';
import type { Stage } from '../../generated/catalog';

export type { Stage };
export { STAGES } from '../../generated/catalog';
export { trackingLanguageStage, languageStageStatus } from './language';
export { classifyWording, wordingStage } from './wording';
export type { ClassifiedWording } from './wording';

/** What a carrier's explicit status map yields for one raw code or wording. */
export interface ClassifiedStatus {
  status: CarrierStatus;
  stage: Stage;
}
