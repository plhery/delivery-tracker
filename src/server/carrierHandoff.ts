import type { CarrierResult } from './carrierResult';
import { isValidS10TrackingNumber } from './carriers';

/** The origin carrier itself names Swiss Post: a declared delivery carrier or a post.ch link in its wording. */
export function namesSwissPost(result: CarrierResult): boolean {
  if (result.delivery_carrier === 'swiss-post') return true;
  const descriptions = [result.last_status_text, ...(result.events ?? []).map((event) => event.description)];
  return descriptions.some((description) =>
    [...String(description ?? '').matchAll(/https?:\/\/[^\s<>"')]+/gi)].some(([raw]) => {
      try { return ['post.ch', 'www.post.ch', 'service.post.ch'].includes(new URL(raw).hostname.toLowerCase()); }
      catch { return false; }
    }),
  );
}

/** Propose a lookup, never a switch: the destination adapter must verify identity and progress. */
export function swissPostHandoffNumber(carrier: string, number: string, result: CarrierResult): string | null {
  if (carrier === 'swiss-post') return null;
  if (namesSwissPost(result)) {
    const reference = result.delivery_tracking_number || number;
    return /^[A-Z0-9]{4,40}$/.test(reference) ? reference : null;
  }
  // Postal S10 numbers work across operators. The suffix identifies the issuer,
  // not the destination, so a Swiss delivery can retain DE, NL, CN, etc.
  return isValidS10TrackingNumber(number) ? number : null;
}
