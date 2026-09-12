/**
 * Colis Privé wording classifier.
 *
 * The recipient page shows French sentences and no status code, so the only
 * thing to map is wording. Rows are compared after accents, case and
 * punctuation are removed, and each rule is a substring of the sentence the
 * page prints. The first matching group wins, so the exception and return
 * groups are checked before the delivery ones: "nous avons tenté de livrer"
 * must not be read as a delivery. Wording that matches nothing stays unmapped —
 * the adapter emits the row with no stage and the sync classifies it.
 */
import type { CarrierStatus } from '../../core/result';
import { clean } from '../../core/transport';
import type { Stage } from '../../generated/catalog';

export interface ClassifiedStatus {
  status: CarrierStatus;
  /** Absent when no rule matched: the sync's classifier decides instead. */
  stage?: Stage;
}

/** Lowercase, strip accents, and reduce anything that is not a letter or digit to one space. */
export function comparableText(value: string): string {
  return clean(value)
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => value.includes(phrase));
}

export const RETURNED_PHRASES = [
  'retour a l expediteur',
  'retourne a l expediteur',
  'retour expediteur',
] as const;

export const FAILED_ATTEMPT_PHRASES = [
  'avons tente de livrer',
  'n avons pas pu livrer',
  'echec de livraison',
  'n a pas pu etre livre',
  'subi un retard',
  'adresse incorrecte',
  'incident',
  'anomalie',
  'endommage',
  'refuse',
  'perdu',
] as const;

export const DELIVERED_PHRASES = [
  'a ete livre',
  'vous a ete remis au relais',
  'remis au destinataire',
  'livraison effectuee',
] as const;

export const READY_FOR_PICKUP_PHRASES = [
  'vous attend au relais',
  'disponible au relais',
  'disponible en point relais',
  'disponible en consigne',
] as const;

export const OUT_FOR_DELIVERY_PHRASES = [
  'en cours de distribution par le livreur',
  'en cours de livraison par le livreur',
] as const;

export const REGISTERED_PHRASES = [
  'en cours de preparation par l expediteur',
  'sera confie prochainement',
  'information transmise par l expediteur',
] as const;

export const IN_TRANSIT_PHRASES = [
  'pris en charge',
  'en cours d acheminement',
  'arrive sur notre agence',
  'arrive dans notre agence',
  'expedie vers',
  'va etre prochainement depose',
  'a ete collecte',
] as const;

export function classifyStatus(description: string): ClassifiedStatus {
  const value = comparableText(description);
  if (includesAny(value, RETURNED_PHRASES)) return { status: 'exception', stage: 'returned' };
  if (includesAny(value, FAILED_ATTEMPT_PHRASES)) return { status: 'exception', stage: 'failed_attempt' };
  if (includesAny(value, DELIVERED_PHRASES)) return { status: 'delivered', stage: 'delivered' };
  if (includesAny(value, READY_FOR_PICKUP_PHRASES)) return { status: 'out_for_delivery', stage: 'ready_for_pickup' };
  if (includesAny(value, OUT_FOR_DELIVERY_PHRASES)) return { status: 'out_for_delivery', stage: 'out_for_delivery' };
  if (includesAny(value, REGISTERED_PHRASES)) return { status: 'pending', stage: 'registered' };
  if (includesAny(value, IN_TRANSIT_PHRASES)) return { status: 'in_transit', stage: 'in_transit' };
  return { status: 'unknown' };
}
