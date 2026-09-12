/**
 * Candidate numbers inside free text.
 *
 * What it is: the shapes worth testing when a whole shipping message, or a URL
 * with no matching link rule, is pasted, and the two scans over them.
 * What it is not: no carrier decision of its own (it defers to the detection
 * engine) and no provider I/O.
 */
import { AMAZON_NUMBER_PATTERN } from './amazon';
import { detectCarrierMatch } from './detect';
import { validTrackingNumber } from './normalize';

export const TRACKING_CANDIDATE_PATTERNS = [
  new RegExp(`\\b${AMAZON_NUMBER_PATTERN.slice(1, -1).replaceAll('[0-9]', '(?:[\\s.-]*[0-9])')}\\b`, 'gi'),
  // NACEX agency/shipment composites keep their slash boundary (never stripped).
  /\b\d{4}\/\d{8}\b/g,
  /\b\d{26}\b/g,
  /\bH\d{15,19}\b/gi,
  /\b1Z[A-Z0-9]{16}\b/gi,
  /\b1G[A-Z0-9]{10}\b/gi,
  /\b[A-Z]{2}\s*\d(?:[\s.-]?\d){8}\s*[A-Z]{2}\b/gi,
  /\b(?:JJD|JVGL)[A-Z0-9]{8,}\b/gi,
  /\b\d(?:[\s.-]?\d){9,19}\b/g,
];

/** The first candidate in the text that one carrier claims confidently. */
export function recognizedNumberInText(raw: string): string | undefined {
  for (const pattern of TRACKING_CANDIDATE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of raw.matchAll(pattern)) {
      const candidate = match[0].trim();
      if (detectCarrierMatch(candidate).confidence === 'high') return candidate;
    }
  }
  return undefined;
}

/** Last resort: a number introduced by a "tracking number:" style label. */
export function keywordNumberInText(raw: string): string | undefined {
  const match = raw.match(
    /(?:(?:tracking|track(?:ing)?\s*(?:number|no\.?|id)?)|(?:parcel|shipment)(?:\s+(?:tracking|number|no\.?|id))?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9.-]{3,39})/i,
  );
  const candidate = match?.[1]?.trim();
  return candidate && validTrackingNumber(candidate) ? candidate : undefined;
}
