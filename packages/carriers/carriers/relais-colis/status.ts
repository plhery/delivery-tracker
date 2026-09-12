/**
 * Relais Colis step wording → product stage.
 *
 * The recipient page prints a French sentence per step and no status code, so
 * the map is phrase-based. Phrases are compared after lower-casing, stripping
 * diacritics and collapsing everything that is not a letter or a digit, which
 * makes the upper-case banner wording and the sentence-case timeline wording
 * the same key.
 *
 * Order matters: return and failure sentences are tested first, then the two
 * pickup states, and only then delivery, because the network's vocabulary
 * reuses "relais" across several stages. Unlike the other French adapters this
 * one keeps the provider's own sentence as the event description, so the map
 * only decides the stage. Sentences it does not recognize get no carrier
 * stage assignment beyond the transit default and are left to the sync's
 * wording classifier.
 */
import type { CarrierStatus } from '../../core/result';
import { clean } from '../../core/transport';
import type { Stage } from '../../generated/catalog';

export interface ClassifiedRelaisColisStatus {
  status: CarrierStatus;
  stage: Stage;
}

/** Lower-case, unaccent and reduce a French sentence to letters, digits and single spaces. */
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

export function classifyRelaisColisStatus(description: string): ClassifiedRelaisColisStatus {
  const value = comparableText(description);

  if (includesAny(value, [
    'retour a l expediteur',
    'retourne a l expediteur',
    'retourne a votre vendeur',
    'retour a votre vendeur',
    'retour vendeur',
  ])) return { status: 'exception', stage: 'returned' };

  if (includesAny(value, [
    'adresse incorrecte',
    'colis endommage',
    'colis refuse',
    'colis perdu',
  ])) return { status: 'exception', stage: 'exception' };

  if (includesAny(value, [
    'livraison impossible',
    'echec de livraison',
    'incident de livraison',
    'destinataire absent',
    'n a pas pu etre livre',
  ])) return { status: 'exception', stage: 'failed_attempt' };

  if (includesAny(value, [
    'disponible dans votre relais',
    'disponible au relais',
    'disponible en relais',
    'mis a disposition dans votre relais',
    'vous attend dans votre relais',
    'a retirer dans votre relais',
  ])) return { status: 'out_for_delivery', stage: 'ready_for_pickup' };

  if (includesAny(value, [
    'en cours de livraison',
    'en cours de distribution',
    'livraison dans votre relais',
  ])) return { status: 'out_for_delivery', stage: 'out_for_delivery' };

  if (includesAny(value, [
    'retire par le destinataire',
    'remis au destinataire',
    'remis a son destinataire',
    'livraison effectuee',
  ]) || /\b(?:colis|commande) (?:a ete|est) livre\b/.test(value)) {
    return { status: 'delivered', stage: 'delivered' };
  }

  if (includesAny(value, [
    'commande enregistree',
    'colis annonce',
    'colis a ete annonce',
    'information transmise',
    'en attente de prise en charge',
    'sera prochainement confie',
  ])) return { status: 'pending', stage: 'registered' };

  if (includesAny(value, [
    'pris en charge',
    'en cours d acheminement',
    'en transit',
    'arrive dans notre agence',
    'arrive sur notre agence',
    'a quitte notre agence',
    'achemine vers',
    'expedie vers',
  ])) return { status: 'in_transit', stage: 'in_transit' };

  return { status: 'unknown', stage: 'in_transit' };
}
