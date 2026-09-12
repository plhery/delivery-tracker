/**
 * Tracking-number detection.
 *
 * What it is: the one engine that normalizes a number, validates its checksum,
 * decides which carrier it belongs to, and parses whatever a user pastes. The
 * web client, the server and the corpus sweep all import it from here.
 * What it is not: no provider I/O, no HTTP, no Node APIs, no application or
 * framework code — it bundles for the browser unchanged.
 */
export type {
  CarrierDetection,
  DetectionConfidence,
  TrackingInputMatch,
} from './types';
export { AMAZON_NUMBER_PATTERN, isAmazonTrackingNumber } from './amazon';
export {
  TRACKING_CANDIDATE_PATTERNS,
  keywordNumberInText,
  recognizedNumberInText,
} from './candidates';
export { detectCarrier, detectCarrierMatch } from './detect';
export { isValidMondialRelayBarcode } from './mondialRelay';
export {
  formatTrackingNumber,
  isPlanzerSharedTrackingNumber,
  normalizeTrackingNumber,
  validTrackingNumber,
} from './normalize';
export { parseTrackingInput } from './parse';
export { isValidS10TrackingNumber, supportsSwissPostHandoff } from './s10';
