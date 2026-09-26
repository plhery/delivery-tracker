/**
 * The detection engine.
 *
 * What it is: matches a tracking number against every carrier's catalog
 * detection rules and their checksums. Exactly one high-confidence match
 * selects a carrier; zero or several keep the number as a low-confidence
 * suggestion and return the candidates.
 * What it is not: no network lookup, no provider I/O, no carrier ranking by
 * popularity — only the rules declared in the catalog decide. A `preferred`
 * rule only moves its carrier to the front of the suggestions.
 */
import type { CarrierId } from '../../generated/catalog';
import type { DetectionRule } from '../catalog/types';
import { CARRIER_DEFINITIONS } from '../catalog/definitions';
import { isValidHermesParcelNumber } from './hermes';
import { isValidMondialRelayBarcode } from './mondialRelay';
import { normalizeTrackingNumber } from './normalize';
import { isValidS10TrackingNumber } from './s10';
import type { CarrierDetection } from './types';

function checksumPasses(rule: DetectionRule, trackingNumber: string): boolean {
  if (rule.checksum === 'mondial-relay') return isValidMondialRelayBarcode(trackingNumber);
  if (rule.checksum === 's10') return isValidS10TrackingNumber(trackingNumber);
  if (rule.checksum === 'hermes') return isValidHermesParcelNumber(trackingNumber);
  return true;
}

/** Return only a high-confidence carrier; preserve ambiguous candidates for the UI. */
export function detectCarrierMatch(raw: string): CarrierDetection {
  const trackingNumber = normalizeTrackingNumber(raw);
  if (!trackingNumber) {
    return { carrier: 'unknown', confidence: 'none', candidates: [], preferred: [] };
  }

  const matches: { carrier: CarrierId; confidence: 'high' | 'low'; preferred: boolean }[] = [];
  for (const [carrier, definition] of Object.entries(CARRIER_DEFINITIONS)) {
    // A carrier's first matching rule decides its confidence and preference.
    const rule = definition.detectionRules.find((candidate) =>
      new RegExp(candidate.pattern).test(trackingNumber) && checksumPasses(candidate, trackingNumber));
    if (rule) matches.push({ carrier: carrier as CarrierId, confidence: rule.confidence, preferred: rule.preferred === true });
  }

  const highConfidence = matches.filter((match) => match.confidence === 'high');
  const ranked = highConfidence.length > 0 ? highConfidence : matches;
  // Number evidence first; catalog order otherwise.
  const preferred = ranked.filter((match) => match.preferred).map((match) => match.carrier);
  const candidates = [...preferred, ...ranked.filter((match) => !match.preferred).map((match) => match.carrier)];
  if (highConfidence.length === 1) {
    return { carrier: highConfidence[0].carrier, confidence: 'high', candidates, preferred };
  }
  return {
    carrier: 'unknown',
    confidence: matches.length > 0 ? 'low' : 'none',
    candidates,
    preferred,
  };
}

/** Guess only when the tracking-number shape identifies one carrier confidently. */
export function detectCarrier(raw: string): CarrierId {
  return detectCarrierMatch(raw).carrier;
}
