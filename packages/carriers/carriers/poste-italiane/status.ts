/**
 * Poste Italiane status vocabulary.
 *
 * DoveQuando has no per-event status code: `statoLavorazione` is Italian prose,
 * so the map matches on normalized wording (whitespace collapsed, lower-cased
 * with the `it-IT` locale). The vocabulary is explicitly still being observed,
 * so unmapped wording yields no stage at all: the sync classifies it and
 * records where the final stage came from, rather than this map guessing.
 *
 * Provenance: derived from the prior-art client
 * https://github.com/ha-parcel-integrations/ha-poste-italiane (MIT), whose
 * success vocabulary was confirmed against a real parcel on 2026-08-24; the
 * ASCII-apostrophe delivered variant was observed live on 2026-09-11.
 */
import type { ClassifiedStatus } from '../../core/status';

/** Collapse whitespace and lower-case with the Italian locale, as the map expects. */
export function normalizePosteItalianeWording(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('it-IT') : '';
}

/** The stage and status for one `statoLavorazione`, or undefined when unmapped. */
export function classifyPosteItalianeStatus(rawWording: unknown): ClassifiedStatus | undefined {
  const value = normalizePosteItalianeWording(rawWording);
  if (!value) return undefined;
  if (value.startsWith('la spedizione è stata presa in carico')
    || value.startsWith('da un nostro operatore presso l’ufficio postale')
    || value.startsWith('da un nostro operatore presso l\'ufficio postale')
    || value === 'a seguito di acquisto da poste.it') return { status: 'pending', stage: 'registered' };
  if (value.startsWith('la spedizione è in transito')
    || value.startsWith('completata la fase di verifica per lo svincolo')
    || value.startsWith('consegna non andata a buon fine')) {
    return value.startsWith('consegna non andata a buon fine')
      ? { status: 'exception', stage: 'failed_attempt' }
      : { status: 'in_transit', stage: 'in_transit' };
  }
  if (value.startsWith('in restituzione al mittente')) return { status: 'exception', stage: 'returned' };
  switch (value) {
    case 'la spedizione è in consegna':
      return { status: 'out_for_delivery', stage: 'out_for_delivery' };
    case 'la spedizione è stata consegnata':
    // ASCII-apostrophe variant observed live on a delivered parcel.
    case "la spedizione e' stata consegnata":
    case 'con successo in data':
      return { status: 'delivered', stage: 'delivered' };
    case 'all’estero':
    case 'all\'estero':
    case 'presso il paese estero in data':
    case 'in data':
      return { status: 'in_transit', stage: 'in_transit' };
    case 'sono in corso delle verifiche sulla spedizione. contatta assistenza':
      return { status: 'exception', stage: 'failed_attempt' };
    case 'disponibile per il ritiro dal giorno lavorativo successivo alla data indicata':
      return { status: 'out_for_delivery', stage: 'ready_for_pickup' };
    default:
      return undefined;
  }
}
