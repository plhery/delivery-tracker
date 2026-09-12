/**
 * DPD France status vocabulary.
 *
 * The recipient trace page carries no status codes at all: every row is French
 * prose in a `<td>`, so the only key available is the wording itself. Matching
 * is done on a diacritic- and punctuation-free form of the sentence
 * (`comparableText`) because DPD France varies accents, apostrophes and
 * trailing punctuation between rows.
 *
 * Order matters: returns and incidents are checked before the delivery
 * wording, because "votre colis sera retourné à l'expéditeur" contains neither
 * a delivery verb nor an incident noun on its own.
 *
 * Provenance: wording observed on https://trace.dpd.fr/fr/trace/<number> for
 * outbound and return legs.
 */
import type { ClassifiedStatus } from '../../core/status';
import { clean } from '../../core/transport';

/** Lowercase, accent-free, punctuation-free form used for every wording comparison. */
export function comparableText(value: string): string {
  return clean(value)
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function includesAny(value: string, phrases: string[]): boolean {
  return phrases.some((phrase) => value.includes(phrase));
}

export function classifyStatus(description: string): ClassifiedStatus {
  const value = comparableText(description);

  if (includesAny(value, [
    'retour a l expediteur',
    'retourne a l expediteur',
    'sera retourne a l expediteur',
  ])) return { status: 'exception', stage: 'returned' };

  if (includesAny(value, [
    'reclamation',
    'enquete est ouverte',
    'echec de livraison',
    'livraison impossible',
    'n a pas pu etre livre',
    'tentative de livraison',
    'incident',
    'anomalie',
    'endommage',
    'refuse',
    'perdu',
    'retard',
  ])) return { status: 'exception', stage: 'failed_attempt' };

  if (includesAny(value, [
    'votre colis est livre',
    'votre colis a ete livre',
    'remis au destinataire',
    'livraison effectuee',
  ])) return { status: 'delivered', stage: 'delivered' };

  if (includesAny(value, [
    'disponible en relais',
    'disponible au relais',
    'disponible en agence',
    'disponible en consigne',
    'attend en relais',
  ])) return { status: 'out_for_delivery', stage: 'ready_for_pickup' };

  if (includesAny(value, [
    'en cours de livraison',
    'en tournee de livraison',
    'chauffeur a pris en charge',
  ])) return { status: 'out_for_delivery', stage: 'out_for_delivery' };

  if (includesAny(value, [
    'en preparation chez l expediteur',
    'informations concernant votre colis ont ete transmises',
    'donnees du colis transmises',
  ])) return { status: 'pending', stage: 'registered' };

  if (includesAny(value, [
    'remis a dpd',
    'pris en charge par dpd',
    'en transit',
    'arrive en france',
    'arrive dans notre agence',
    'prochaine agence',
    'centre de tri',
  ])) return { status: 'in_transit', stage: 'in_transit' };

  // Wording this map does not recognize keeps the row visible without claiming
  // a milestone: the result status stays `unknown` so the lookup falls back to
  // the newest recognized row. See NOTES.md — the `in_transit` stage kept here
  // predates the package's "omit the stage when it is not mapped" rule.
  return { status: 'unknown', stage: 'in_transit' };
}
