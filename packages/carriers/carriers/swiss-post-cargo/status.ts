/**
 * Swiss Post Cargo status classification.
 *
 * The public endpoint returns a short `Status` code plus a free-text
 * `Description` in the shipment's language (de/fr/it/en). Only a handful of
 * codes have a confirmed meaning, so wording is consulted first for the
 * outcomes that must never be guessed wrong (returns and failures), and the
 * codes settle the rest.
 */
import { cleanScalar } from '../../core/transport';
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../generated/catalog';

/** Lower-cased, accent-free wording, for language-independent matching. */
export function comparable(value: unknown): string {
  return cleanScalar(value)
    .toLocaleLowerCase('de-CH')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Confirmed codes (observed on the public tracker, 2026-08-30): DLV/POD/P40/
 * IMG/SIG accompany a delivery, SCA a delivery-round scan, NTF an
 * announcement, RFS an acceptance. Everything else stays in transit.
 */
export function statusFor(code: string, description: string): { status: CarrierStatus; stage: Stage } {
  const normalizedCode = code.toLocaleUpperCase('en-US');
  const text = comparable(description);
  if (['retour', 'return', 'zuruck'].some((term) => text.includes(term))) {
    return { status: 'exception', stage: 'returned' };
  }
  if (['incident', 'refuse', 'damage'].some((term) => text.includes(term))) {
    return { status: 'exception', stage: 'exception' };
  }
  if (['echec', 'failed', 'not delivered', 'non livre', 'nicht zugestellt', 'verzoger']
    .some((term) => text.includes(term))) {
    return { status: 'exception', stage: 'failed_attempt' };
  }
  if (['DLV', 'POD', 'P40', 'IMG', 'SIG'].includes(normalizedCode)
    || ['delivered', 'livre', 'zugestellt', 'consegnat'].some((term) => text.includes(term))) {
    return { status: 'delivered', stage: 'delivered' };
  }
  if (['out for delivery', 'en livraison', 'in zustellung', 'in consegna']
    .some((term) => text.includes(term))) {
    return { status: 'out_for_delivery', stage: 'out_for_delivery' };
  }
  if (normalizedCode === 'SCA') {
    return { status: 'out_for_delivery', stage: 'out_for_delivery' };
  }
  if (normalizedCode === 'NTF'
    || ['annonce', 'registered', 'angemeldet', 'information received']
      .some((term) => text.includes(term))) {
    return { status: 'pending', stage: 'registered' };
  }
  return { status: 'in_transit', stage: normalizedCode === 'RFS' ? 'accepted' : 'in_transit' };
}
