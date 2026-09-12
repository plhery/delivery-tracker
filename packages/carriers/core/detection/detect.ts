/**
 * The detection engine.
 *
 * What it is: matches a tracking number against every carrier's catalog
 * detection rules and their checksums. Exactly one high-confidence match
 * selects a carrier; zero or several keep the number as a low-confidence
 * suggestion and return the candidates.
 * What it is not: no network lookup, no provider I/O, no carrier ranking by
 * popularity — only the rules declared in the catalog decide.
 */
import type { CarrierId } from '../../generated/catalog';
import { CARRIER_DEFINITIONS } from '../catalog/definitions';
import { isValidMondialRelayBarcode } from './mondialRelay';
import { normalizeTrackingNumber } from './normalize';
import { isValidS10TrackingNumber } from './s10';
import type { CarrierDetection } from './types';

/** Return only a high-confidence carrier; preserve ambiguous candidates for the UI. */
export function detectCarrierMatch(raw: string): CarrierDetection {
  const trackingNumber = normalizeTrackingNumber(raw);
  if (!trackingNumber) {
    return { carrier: 'unknown', confidence: 'none', candidates: [] };
  }

  const matches: { carrier: CarrierId; confidence: 'high' | 'low' }[] = [];
  for (const [carrier, definition] of Object.entries(CARRIER_DEFINITIONS)) {
    for (const rule of definition.detectionRules) {
      if (!new RegExp(rule.pattern).test(trackingNumber)) continue;
      if (rule.checksum === 'mondial-relay' && !isValidMondialRelayBarcode(trackingNumber)) continue;
      if (rule.checksum === 's10' && !isValidS10TrackingNumber(trackingNumber)) continue;
      matches.push({ carrier: carrier as CarrierId, confidence: rule.confidence });
      break;
    }
  }

  const highConfidence = matches.filter((match) => match.confidence === 'high');
  const ranked = highConfidence.length > 0 ? highConfidence : matches;
  const candidates = ranked.map((match) => match.carrier);
  if (highConfidence.length === 1) {
    return { carrier: highConfidence[0].carrier, confidence: 'high', candidates };
  }
  return {
    carrier: 'unknown',
    confidence: matches.length > 0 ? 'low' : 'none',
    candidates,
  };
}

/** Guess only when the tracking-number shape identifies one carrier confidently. */
export function detectCarrier(raw: string): CarrierId {
  return detectCarrierMatch(raw).carrier;
}
