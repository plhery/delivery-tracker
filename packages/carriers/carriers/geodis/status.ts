/**
 * GEODIS wording classifier.
 *
 * The anonymous recipient endpoint returns French sentences (`libelleSuivi` per
 * scan, `libelle` per timeline step) and no status code, so wording is the only
 * thing to map. Text is compared with accents, case and punctuation removed.
 *
 * Order matters and is the whole point of this file: "va être livré" and "en
 * cours de livraison" both contain "livré", so the future-delivery and
 * out-for-delivery groups are checked before the delivered group, and the
 * delivered group itself is anchored (start of sentence, "a été livré", or a
 * parcel noun immediately before the participle) instead of a bare substring.
 * Wording that matches nothing stays unmapped: the adapter emits the scan with
 * no stage and the sync classifies it.
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

export function includesAny(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => value.includes(phrase));
}

export const RETURNED_PHRASES = [
  'retour a l expediteur',
  'retourne a l expediteur',
  'retour expediteur',
] as const;

export const FAILED_ATTEMPT_PHRASES = [
  'non livre',
  'impossible de livrer',
  'echec de livraison',
  'livraison echouee',
  'incident',
  'anomalie',
  'avarie',
  'endommage',
  'refuse',
  'destinataire absent',
] as const;

export const READY_FOR_PICKUP_PHRASES = [
  'pret a etre retire',
  'disponible pour retrait',
  'mis a disposition',
  'a retirer en agence',
  'retrait disponible',
] as const;

export const OUT_FOR_DELIVERY_PHRASES = [
  'en cours de livraison',
  'livraison en cours',
  'en distribution',
  'tournee de livraison',
  'conducteur en route',
] as const;

/** Announcements of a delivery still to come; checked before the delivered rules. */
export const FUTURE_DELIVERY_PHRASES = [
  'va etre livre',
  'sera livre',
  'doit etre livre',
  'pret a etre livre',
] as const;

export const DELIVERED_PHRASES = [
  'livraison effectuee',
  'remis au destinataire',
  'retire par le destinataire',
] as const;

const DELIVERED_PATTERNS = [
  /^(?:livre|livree|livres|livrees)\b/,
  /\b(?:a ete|est) (?:livre|livree|livres|livrees)\b/,
  /\b(?:colis|courrier|envoi|pli) (?:livre|livree|livres|livrees)\b/,
] as const;

export const REGISTERED_PHRASES = [
  'en attente de recuperation',
  'en attente de prise en charge',
  'information transmise',
  'commande recue',
  'enregistre',
] as const;

export const IN_TRANSIT_PHRASES = [
  'pris en charge',
  'acheminement',
  'en transit',
  'arrive',
  'depart',
  'agence',
  'centre',
  'transport',
] as const;

export function classifyStatus(description: string): ClassifiedStatus {
  const value = comparableText(description);
  if (includesAny(value, RETURNED_PHRASES)) return { status: 'exception', stage: 'returned' };
  if (includesAny(value, FAILED_ATTEMPT_PHRASES)) return { status: 'exception', stage: 'failed_attempt' };
  if (includesAny(value, READY_FOR_PICKUP_PHRASES)) return { status: 'out_for_delivery', stage: 'ready_for_pickup' };
  if (includesAny(value, OUT_FOR_DELIVERY_PHRASES)) return { status: 'out_for_delivery', stage: 'out_for_delivery' };
  if (includesAny(value, FUTURE_DELIVERY_PHRASES)) return { status: 'in_transit', stage: 'in_transit' };
  if (DELIVERED_PATTERNS.some((pattern) => pattern.test(value)) || includesAny(value, DELIVERED_PHRASES)) {
    return { status: 'delivered', stage: 'delivered' };
  }
  if (includesAny(value, REGISTERED_PHRASES)) return { status: 'pending', stage: 'registered' };
  if (includesAny(value, IN_TRANSIT_PHRASES)) return { status: 'in_transit', stage: 'in_transit' };
  return { status: 'unknown' };
}
