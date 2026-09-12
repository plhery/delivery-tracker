/**
 * La Poste status vocabulary, shared by Colissimo, tracked mail, Chronopost
 * and Delivengo because all four are served by the same unified feed.
 *
 * Each event carries two keys: a coarse `group` (the progress bar step) and a
 * finer `code`. The code wins when it is mapped, the group is the fallback,
 * and the French `label` is consulted last — except for incidents, where the
 * wording always wins, because La Poste keeps an event inside its original
 * group when a delivery fails ("Incident : livraison impossible" arrives with
 * code `DR1`, whose group means "registered").
 *
 * The wording rules run through `core/status`'s shared multilingual classifier
 * first, so a phrasing already mapped for other French carriers stays
 * consistent here; the French-specific list below only covers what that
 * classifier leaves unresolved. Future tenses are deliberately *not* delivery:
 * "votre colis va être livré" is an announcement, not a delivery.
 */
import type { CarrierStatus } from '../../core/result';
import { languageStageStatus, trackingLanguageStage, type Stage } from '../../core/status';
import { clean } from '../../core/transport';

/** Progress-bar groups, the coarse key every event carries. */
export const GROUP_STATUSES = new Map<string, CarrierStatus>([
  ['EXPANN', 'pending'],
  ['ACHNAT', 'in_transit'],
  ['DISARR', 'in_transit'],
  ['DISTOU', 'out_for_delivery'],
  ['DISMAD', 'out_for_delivery'],
  ['DESBAL', 'delivered'],
  ['DESTIN', 'delivered'],
  ['DESLIVD', 'delivered'],
  ['RETOUR', 'exception'],
]);

/** Event codes that are unambiguous on their own; they outrank the group. */
export const CODE_STATUSES = new Map<string, CarrierStatus>([
  ['DR1', 'pending'],
  ['PC1', 'in_transit'],
  ['ET1', 'in_transit'],
  ['EP1', 'in_transit'],
  ['MD1', 'out_for_delivery'],
  ['DI1', 'delivered'],
]);

/** Lowercase, accent-free form used for every wording comparison. */
export function comparable(value: unknown): string {
  return clean(value)
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

export function labelStatus(label: string, hasEvents: boolean): CarrierStatus {
  const translated = trackingLanguageStage(label);
  if (translated) return languageStageStatus(translated);
  const value = comparable(label);
  if (['retour', 'incident', 'echec', 'impossible', 'refuse', 'non livre', "n'a pas pu vous etre remis"]
    .some((term) => value.includes(term))) return 'exception';
  if (['tournee', 'en cours de livraison', 'distribution ce jour']
    .some((term) => value.includes(term))) return 'out_for_delivery';
  if (['va etre livre', 'sera livre', 'doit etre livre', 'pret a etre livre']
    .some((term) => value.includes(term))) return 'in_transit';
  if (
    /^(?:livre|livree|livres|livrees)\b/.test(value)
    || /\b(?:a ete|est) (?:livre|livree|livres|livrees)\b/.test(value)
    || /\b(?:colis|courrier|envoi|pli) (?:livre|livree|livres|livrees)\b/.test(value)
    || ['livraison effectuee', 'remis au destinataire', 'distribue']
      .some((term) => value.includes(term))
  ) return 'delivered';
  if (hasEvents || ['transit', 'acheminement', 'pris en charge', 'arrive']
    .some((term) => value.includes(term))) return 'in_transit';
  if (['annonce', 'information recue', 'prepare']
    .some((term) => value.includes(term))) return 'pending';
  return 'unknown';
}

/** The status for one event: explicit incident wording, then code, then group, then wording. */
export function eventStatus(
  group: string,
  code: string,
  label: string,
  hasEvents: boolean,
): CarrierStatus {
  const described = labelStatus(label, false);
  if (described === 'exception') return described;
  return CODE_STATUSES.get(code.toLocaleUpperCase('en-US'))
    ?? GROUP_STATUSES.get(group.toLocaleUpperCase('en-US'))
    ?? (described !== 'unknown' ? described : labelStatus(label, hasEvents));
}

/** The stage for one event; returns and pickup readiness are recognized before the status. */
export function eventStage(group: string, code: string, label: string): Stage {
  const normalizedGroup = group.toLocaleUpperCase('en-US');
  const normalizedCode = code.toLocaleUpperCase('en-US');
  const value = comparable(label);
  if (normalizedGroup === 'RETOUR' || value.includes('retour')) {
    return 'returned';
  }
  if (
    normalizedGroup === 'DISMAD'
    || ['disponible au point de retrait', 'disponible en point relais', 'attend au relais']
      .some((term) => value.includes(term))
  ) return 'ready_for_pickup';
  // A carrier-reported problem that is neither a missed attempt nor a return.
  if (['incident', 'anomalie', 'avarie', 'endommage', 'refuse', 'adresse incorrecte']
    .some((term) => value.includes(term))) return 'exception';
  const status = eventStatus(normalizedGroup, normalizedCode, label, true);
  if (status === 'pending') return 'registered';
  if (status === 'out_for_delivery') return 'out_for_delivery';
  if (status === 'delivered') return 'delivered';
  if (status === 'exception') return 'failed_attempt';
  if (normalizedCode === 'PC1') return 'accepted';
  return 'in_transit';
}
