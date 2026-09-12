/**
 * Ciblex action wording → product stage.
 *
 * The public parcel page prints one French action label per scan row and no
 * status code, so the map is phrase-based. Phrases are compared after
 * lower-casing, stripping diacritics and collapsing everything that is not a
 * letter or a digit, which makes the accented and unaccented spellings the
 * portal alternates between ("Colis Livré" / "COLIS LIVRE") the same key.
 *
 * Order matters: return and delivery phrases are tested before the broader
 * transit ones. Rows whose wording is not mapped keep a neutral description
 * and no carrier-declared stage beyond the transit default, so the sync's
 * wording classifier records them for review.
 */
import type { CarrierStatus } from '../../core/result';
import { clean } from '../../core/transport';
import type { Stage } from '../../generated/catalog';

export interface ClassifiedCiblexStatus {
  status: CarrierStatus;
  stage: Stage;
  description: string;
}

/** Lower-case, unaccent and reduce a French label to letters, digits and single spaces. */
export function comparableText(value: string): string {
  return clean(value)
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(value: string, phrases: string[]): boolean {
  return phrases.some((phrase) => value.includes(phrase));
}

export function classifyCiblexStatus(rawDescription: string): ClassifiedCiblexStatus {
  const value = comparableText(rawDescription);
  if (includesAny(value, ['retour expediteur', 'retourne a l expediteur', 'retour a l expediteur'])) {
    return { status: 'exception', stage: 'returned', description: 'Returned to sender' };
  }
  if (includesAny(value, ['colis livre', 'livraison effectuee', 'remis au destinataire'])) {
    return { status: 'delivered', stage: 'delivered', description: 'Delivered' };
  }
  if (includesAny(value, ['mis en livraison', 'mise en livraison', 'en cours de livraison'])) {
    return { status: 'out_for_delivery', stage: 'out_for_delivery', description: 'Out for delivery' };
  }
  if (includesAny(value, ['disponible en relais', 'disponible au relais', 'mis a disposition'])) {
    return { status: 'out_for_delivery', stage: 'ready_for_pickup', description: 'Ready for pickup' };
  }
  if (includesAny(value, [
    'complement adresse',
    'adresse incorrecte',
    'destinataire absent',
    'incident',
    'anomalie',
    'non livre',
    'refuse',
  ])) {
    return { status: 'exception', stage: 'failed_attempt', description: 'Delivery issue' };
  }
  if (includesAny(value, ['colis controle', 'colis en transit', 'arrive agence', 'depart agence'])) {
    return { status: 'in_transit', stage: 'in_transit', description: 'Parcel processed at Ciblex facility' };
  }
  if (includesAny(value, ['colis pris en charge', 'prise en charge'])) {
    return { status: 'in_transit', stage: 'accepted', description: 'Shipment collected' };
  }
  if (includesAny(value, ['annonce', 'information recue'])) {
    return { status: 'pending', stage: 'registered', description: 'Shipment information received' };
  }
  return { status: 'unknown', stage: 'in_transit', description: 'Ciblex tracking update' };
}
