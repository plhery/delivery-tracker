/**
 * DHL wording → product stage.
 *
 * DHL's public `/int-verfolgen/data` payload carries no status code: the
 * shipment history is free text in the language the page was requested in
 * (English here, with German wording still returned for domestic scans), so
 * this map is a wording classifier rather than a code table. Rules are
 * ordered so that a negative, a forecast or a handoff wins before the broad
 * delivery words, and anything unrecognized keeps the caller's fallback
 * instead of inventing progress.
 */
import type { CarrierStatus } from '../../core/result';
import { trackingLanguageStage } from '../../core/status';

export function stageForText(text: string, fallback = 'in_transit'): string {
  const value = text.toLowerCase();
  if (/return(?:ed|ing)? to (?:the )?sender|zurück.*absender|rücksendung|retour/.test(value)) return 'returned';
  if (/not delivered|could not be delivered|unable to deliver|delivery attempt|nicht.*zugestellt|zustellversuch|nicht angetroffen/.test(value)) return 'failed_attempt';
  // GENERATED equivalents of DHL's existing forecast behavior: a forecast retains
  // the structured progress fallback; it cannot establish delivery or pre-advice.
  if (/will be delivered|sera livr[ée]|wird\s+(?!zugestellt\b).+zugestellt|sar[àa] consegnat/.test(value)) return fallback;
  const translated = trackingLanguageStage(text);
  if (translated) return translated;
  if (/ready for (?:pickup|collection)|ready to (?:collect|pick up)|awaiting collection|abholbereit|zur abholung bereit/.test(value)) return 'ready_for_pickup';
  if (/has been delivered|was delivered|successfully delivered|^delivered\b|erfolgreich zugestellt|wurde.*zugestellt/.test(value)) return 'delivered';
  if (/^being delivered[.!]?$|out for delivery|loaded (?:into|onto).*delivery vehicle|in das zustellfahrzeug geladen|in zustellung/.test(value)) return 'out_for_delivery';
  if (/customs clearance process\b[^.]*\bhas been completed\b/.test(value)) return 'in_transit';
  if (/customs|zoll/.test(value)) return 'customs';
  if (/electronically|elektronisch|label created|shipment information|instruction data/.test(value)) return 'registered';
  if (/will be transported to the destination country/.test(value)) return 'in_transit';
  if (/pick-up was successful|accepted|handed (?:over|to)|eingeliefert|übergeben/.test(value)) return 'accepted';
  if (/processed|sorted|sorting|sortierung|bearbeitet|briefzentrum|paketzentrum|transit|transport|arrived|departed/.test(value)) return 'in_transit';
  return fallback;
}

export function statusForStage(stage: string): CarrierStatus {
  if (stage === 'registered' || stage === 'pending') return 'pending';
  if (stage === 'delivered') return 'delivered';
  if (stage === 'out_for_delivery' || stage === 'ready_for_pickup') return 'out_for_delivery';
  if (stage === 'failed_attempt' || stage === 'returned') return 'exception';
  return 'in_transit';
}
