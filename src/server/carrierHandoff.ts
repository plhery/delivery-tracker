import type { CarrierResult } from './carrierResult';
import { activeRequirements, AUTOMATIC_CARRIER_IDS, carrierAdapter, isValidS10TrackingNumber } from './carriers';

export interface DeliveryHandoff {
  carrier: string;
  number: string;
  explicit: boolean;
}

// Destination-only probes are limited to verified inbound postal integrations.
// An explicitly declared partner can use any available dedicated adapter.
const POSTAL_DESTINATIONS: Record<string, string> = { CH: 'swiss-post', FI: 'posti' };

export function hasDirectHandoffAdapter(carrier: string, number: string): boolean {
  return AUTOMATIC_CARRIER_IDS.has(carrier) && carrierAdapter(carrier) !== 'universal'
    && activeRequirements(carrier, number).length === 0;
}

/** One evidence-based candidate; country and partner names never authorize a switch. */
export function deliveryHandoff(carrier: string, number: string, result: CarrierResult): DeliveryHandoff | null {
  const named = result.delivery_carrier ?? (namesSwissPost(result) ? 'swiss-post' : undefined);
  const destination = typeof result.destination_country === 'string' ? result.destination_country : undefined;
  const target = named ?? (isValidS10TrackingNumber(number)
    ? destination ? POSTAL_DESTINATIONS[destination] : 'swiss-post' : undefined);
  const reference = named ? result.delivery_tracking_number || number : number;
  if (!target || target === carrier || !/^[A-Z0-9]{4,40}$/.test(reference)
    || !hasDirectHandoffAdapter(target, reference)) return null;
  return { carrier: target, number: reference, explicit: Boolean(named) };
}

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
  const candidate = deliveryHandoff(carrier, number, result);
  return candidate?.carrier === 'swiss-post' ? candidate.number : null;
}
