/**
 * GLS status classification, shared by the Swiss and German folders.
 *
 * The GROUP recipient service labels the progress bar and most history rows
 * with a stable status code (`INTRANSIT`, `DELIVEREDPS`, …). Codes are the
 * authority. Rows that carry no code fall back to wording rules, which are
 * ordered so that negatives and explicit non-events are decided before the
 * broad words they contain, and only then consult the package's shared
 * multilingual classifier.
 */
import { languageStageStatus, trackingLanguageStage, type ClassifiedStatus } from '../../core/status';

export type { ClassifiedStatus };

export const GLS_STATUSES = new Map<string, ClassifiedStatus>([
  ['PREADVICE', { status: 'pending', stage: 'registered' }],
  ['NOTPICKEDUP', { status: 'exception', stage: 'returned' }],
  ['PLANNEDPICKUP', { status: 'pending', stage: 'registered' }],
  ['INPICKUP', { status: 'in_transit', stage: 'accepted' }],
  ['INTRANSIT', { status: 'in_transit', stage: 'in_transit' }],
  ['INWAREHOUSE', { status: 'in_transit', stage: 'in_transit' }],
  ['INDELIVERY', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['DELIVERED', { status: 'delivered', stage: 'delivered' }],
  // ParcelShop/locker arrival — arrived, not recipient-delivered.
  ['DELIVEREDPS', { status: 'out_for_delivery', stage: 'ready_for_pickup' }],
  ['NOTDELIVERED', { status: 'exception', stage: 'failed_attempt' }],
  ['RETURNED', { status: 'exception', stage: 'returned' }],
  ['CANCELED', { status: 'exception', stage: 'returned' }],
  ['CANCELLED', { status: 'exception', stage: 'returned' }],
  ['FINAL', { status: 'exception', stage: 'returned' }],
  ['NORECORD', { status: 'unknown', stage: 'pending' }],
]);

/** A provider status code, upper-cased, or '' when the value is not one. */
export function statusCode(value: unknown): string {
  const code = (typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, 32)
    : '').toLocaleUpperCase('en-US');
  return /^[A-Z][A-Z0-9_]{1,31}$/.test(code) ? code : '';
}

/** The shipment status for a raw GLS status code; unknown codes stay `unknown`. */
export function glsSwitzerlandStatus(value: unknown): ClassifiedStatus['status'] {
  return GLS_STATUSES.get(statusCode(value))?.status ?? 'unknown';
}

/** Classify a history row that carries no status code, from its wording alone. */
export function classifyDescription(description: string): ClassifiedStatus {
  // EXISTING regression wording: a negative handoff does not prove GLS possession.
  if (/^(?:the )?parcel has not been handed over to gls[.!]?$/i.test(description.trim())) {
    return { status: 'unknown', stage: 'in_transit' };
  }
  const translated = trackingLanguageStage(description);
  if (translated) return { status: languageStageStatus(translated), stage: translated };
  const value = description
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (/(return(?:ed)? to sender|cancel(?:led|ed)|delivery (?:failed|impossible)|not delivered)/.test(value)) {
    return { status: 'exception', stage: value.includes('return') ? 'returned' : 'failed_attempt' };
  }
  if (/(delivered|handed to (?:the )?recipient|collected by (?:the )?recipient)/.test(value)) {
    return { status: 'delivered', stage: 'delivered' };
  }
  if (/(ready for (?:pickup|collection)|parcel ?shop|locker)/.test(value)) {
    return { status: 'out_for_delivery', stage: 'ready_for_pickup' };
  }
  if (/(out for delivery|in delivery|delivery vehicle)/.test(value)) {
    return { status: 'out_for_delivery', stage: 'out_for_delivery' };
  }
  if (/(data (?:was )?entered|preadvice|announced|label created)/.test(value)) {
    return { status: 'pending', stage: 'registered' };
  }
  if (/^(?:the )?parcel (?:was|has been) handed over to gls$/.test(value)) {
    return { status: 'in_transit', stage: 'accepted' };
  }
  if (/^(?:the )?parcel (?:was|has been) released by customs$/.test(value)) {
    return { status: 'in_transit', stage: 'in_transit' };
  }
  if (/(transit|parcel cent(?:er|re)|depot|left the gls|reached gls|customs)/.test(value)) {
    return { status: 'in_transit', stage: value.includes('customs') ? 'customs' : 'in_transit' };
  }
  return { status: 'unknown', stage: 'in_transit' };
}
