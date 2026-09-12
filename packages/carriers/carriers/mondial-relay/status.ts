/**
 * Mondial Relay status vocabulary.
 *
 * The tracking endpoint carries no status code: every state is French prose,
 * in `SuiviContextuel` (the headline), in each event's `Libelle`, and in the
 * `SuiviParEtapes` milestone labels. Matching is therefore done on
 * accent-folded, punctuation-free phrases so that "Retour à l'expéditeur",
 * "retour a l expediteur" and "RETOUR A L'EXPEDITEUR" are one entry.
 *
 * Phrases are grouped most specific first: a return and a failed delivery both
 * mention "livraison", and a pickup that has happened must outrank the parcel
 * merely being available. Wording that matches nothing yields `unknown` with an
 * `in_transit` stage placeholder, which the adapter only uses as an event stage
 * when a more specific source has already set the shipment status.
 */
import type { ClassifiedStatus } from '../../core/status';

/** Fold a French label to the form the phrase lists are written in. */
export function comparableText(value: string): string {
  return value
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ordered rules; the first phrase that appears in the folded label wins. */
export const MONDIAL_RELAY_WORDING: readonly { phrases: readonly string[]; classified: ClassifiedStatus }[] = [
  {
    phrases: ['retour a l expediteur', 'retourne a l expediteur', 'retour expediteur', 'retour en cours'],
    classified: { status: 'exception', stage: 'returned' },
  },
  {
    phrases: [
      'anomalie', 'incident', 'echec de livraison', 'livraison impossible',
      'n a pas pu etre livre', 'adresse incorrecte', 'colis endommage',
      'colis refuse', 'colis perdu',
    ],
    classified: { status: 'exception', stage: 'failed_attempt' },
  },
  {
    phrases: [
      'retire par le destinataire', 'retrait effectue', 'remis au destinataire',
      'livraison effectuee au destinataire', 'colis livre au destinataire',
    ],
    classified: { status: 'delivered', stage: 'delivered' },
  },
  {
    phrases: [
      'disponible dans votre point relais', 'disponible au point relais',
      'disponible dans votre locker', 'disponible en consigne',
      'vous attend au point relais', 'vous attend dans le locker', 'pret a etre retire',
    ],
    classified: { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  },
  {
    phrases: [
      'en cours de livraison', 'livraison en cours', 'en cours de distribution',
      'en cours de mise a disposition',
    ],
    classified: { status: 'out_for_delivery', stage: 'out_for_delivery' },
  },
  {
    phrases: [
      'information transmise par l expediteur', 'en cours de preparation par l expediteur',
      'etiquette creee', 'colis enregistre',
    ],
    classified: { status: 'pending', stage: 'registered' },
  },
  {
    // Physical acceptance by the carrier, which is not the same event as the
    // shipper announcing the parcel electronically.
    phrases: ['pris en charge', 'prise en charge'],
    classified: { status: 'in_transit', stage: 'accepted' },
  },
  {
    phrases: [
      'en cours d acheminement', 'en transit', 'arrive sur l agence', 'arrive a l agence',
      'arrive au centre', 'depart de l agence', 'expedie vers', 'achemine vers',
    ],
    classified: { status: 'in_transit', stage: 'in_transit' },
  },
];

/** The status and stage a Mondial Relay label denotes. */
export function classifyStatus(description: string): ClassifiedStatus {
  const value = comparableText(description);
  for (const rule of MONDIAL_RELAY_WORDING) {
    if (rule.phrases.some((phrase) => value.includes(phrase))) return rule.classified;
  }
  return { status: 'unknown', stage: 'in_transit' };
}

/**
 * `SuiviParEtapes` milestone numbers, used only when no wording on the
 * shipment classified. The numbers are positions on the page's own progress
 * bar, so they are read as "at least this far".
 */
export function milestoneNumberStatus(number: number): ClassifiedStatus {
  if (number >= 5) return { status: 'delivered', stage: 'delivered' };
  if (number === 4) return { status: 'out_for_delivery', stage: 'ready_for_pickup' };
  if (number >= 2) return { status: 'in_transit', stage: 'in_transit' };
  return { status: 'pending', stage: 'registered' };
}
