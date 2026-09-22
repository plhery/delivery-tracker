/**
 * Asendia event vocabularies → product stage.
 *
 * Two sources, two maps. `classifyAsendiaA1Event` serves the registered
 * adapter (Asendia USA's A1 platform); `classifyAsendiaStatus` serves the
 * global-portal probe.
 *
 * A1: Asendia's own scans carry numeric codes (`1`, `2`, `2.1`, …) and are
 * mapped by code. Last-mile partners' scans arrive through the same list with
 * the partner's codes, which differ by partner, so those are mapped by exact
 * wording only where a fixture shows it. Anything else returns null and keeps
 * no event stage, leaving it to the sync's shared wording rules and the
 * unmapped-wording review.
 *
 * Global portal: Asendia's branded portal harmonizes the wording of every partner post into
 * one English vocabulary (`harmonizedEvent`), which is what this map keys on;
 * the numeric `harmonizedCode` is retained as the event's `provider_code` but
 * is not used for mapping, because the same code has been observed with
 * different harmonized wording across subsidiaries.
 *
 * Phrases are compared after lower-casing, stripping diacritics and collapsing
 * everything that is not a letter or a digit. Order matters: return and
 * failure phrases are tested before the delivery ones, so "not delivered" can
 * never match the "delivered" substring. Wording the map does not recognize
 * gets no carrier stage assignment beyond the transit default.
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../generated/catalog';

export interface ClassifiedAsendiaStatus {
  status: CarrierStatus;
  stage: Stage;
}

/** Lower-case, unaccent and reduce harmonized wording to letters, digits and single spaces. */
export function comparableText(value: string): string {
  return value
    .toLocaleLowerCase('en-US')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(value: string, phrases: string[]): boolean {
  return phrases.some((phrase) => value.includes(phrase));
}

export function classifyAsendiaStatus(description: string): ClassifiedAsendiaStatus {
  const value = comparableText(description);
  if (includesAny(value, [
    'return to sender',
    'returned to sender',
    'return initiated',
    'shipment returned',
  ])) return { status: 'exception', stage: 'returned' };
  if (includesAny(value, [
    'delivery exception',
    'damaged',
    'refused',
    'lost',
  ])) return { status: 'exception', stage: 'exception' };
  if (includesAny(value, [
    'delivery failed',
    'failed attempt',
    'unable to deliver',
    'not delivered',
    'undelivered',
    'non livre',
    'delivery delayed',
  ])) return { status: 'exception', stage: 'failed_attempt' };
  if (includesAny(value, [
    'delivered',
    'collected by recipient',
    'handed to recipient',
  ])) return { status: 'delivered', stage: 'delivered' };
  if (includesAny(value, [
    'ready for pickup',
    'ready for collection',
    'available for pickup',
  ])) return { status: 'out_for_delivery', stage: 'ready_for_pickup' };
  if (includesAny(value, [
    'out for delivery',
    'in delivery',
    'with delivery courier',
  ])) return { status: 'out_for_delivery', stage: 'out_for_delivery' };
  if (includesAny(value, [
    'information received',
    'shipment created',
    'label created',
    'pre advised',
    'pre advice',
  ])) return { status: 'pending', stage: 'registered' };
  if (includesAny(value, [
    'handed to asendia',
    'departed from asendia',
    'arrived at destination',
    'in transit',
    'processed at',
    'customs',
  ])) return {
    status: 'in_transit',
    stage: value.includes('customs') ? 'customs' : 'in_transit',
  };
  return { status: 'unknown', stage: 'in_transit' };
}

const REGISTERED: ClassifiedAsendiaStatus = { status: 'pending', stage: 'registered' };
const ACCEPTED: ClassifiedAsendiaStatus = { status: 'in_transit', stage: 'accepted' };
const IN_TRANSIT: ClassifiedAsendiaStatus = { status: 'in_transit', stage: 'in_transit' };
const CUSTOMS: ClassifiedAsendiaStatus = { status: 'in_transit', stage: 'customs' };
const OUT_FOR_DELIVERY: ClassifiedAsendiaStatus = { status: 'out_for_delivery', stage: 'out_for_delivery' };
const READY_FOR_PICKUP: ClassifiedAsendiaStatus = { status: 'out_for_delivery', stage: 'ready_for_pickup' };
const FAILED_ATTEMPT: ClassifiedAsendiaStatus = { status: 'exception', stage: 'failed_attempt' };
const EXCEPTION: ClassifiedAsendiaStatus = { status: 'exception', stage: 'exception' };
const RETURNED: ClassifiedAsendiaStatus = { status: 'exception', stage: 'returned' };
const DELIVERED: ClassifiedAsendiaStatus = { status: 'delivered', stage: 'delivered' };

/** Asendia's own A1 scans (eventSource "A1 Imported Data", "A1 Sorted Data", …). */
const A1_CODES: Readonly<Record<string, ClassifiedAsendiaStatus>> = {
  '1': REGISTERED,
  '1.1': REGISTERED,
  '2': ACCEPTED,
  '2.1': IN_TRANSIT,
  '2.2': IN_TRANSIT,
};

/**
 * Asendia's harmonized codes (eventSource "FullTrack API"). The codes and
 * their categories follow the list at
 * https://gist.github.com/dalehalliwell/84b7b459eb151ccf2d2a24a28eed5fdf;
 * `statuses.json` marks which ones were seen in live A1 replies. Consumer
 * return legs (RET*) and inquiry codes (CLAIM*) are left unmapped.
 */
const HARMONIZED_CODES: Readonly<Record<string, ClassifiedAsendiaStatus>> = {
  ELECNOT: REGISTERED, CREALAB: REGISTERED, PRINTLAB: REGISTERED, POSTLIST: REGISTERED,
  PICKUP: ACCEPTED, ARRSUB: ACCEPTED, CHECKIN: ACCEPTED,
  PROSUB: IN_TRANSIT, FINALAB: IN_TRANSIT, CREADES: IN_TRANSIT, DEPSUB: IN_TRANSIT,
  TRANSP: IN_TRANSIT, ARRHUB: IN_TRANSIT, SORTHUB: IN_TRANSIT, DEPHUB: IN_TRANSIT, TRANSPDEST: IN_TRANSIT,
  ARRDEST: IN_TRANSIT, LEAVHUB: IN_TRANSIT, TRANSPLOC: IN_TRANSIT, INDELIVCENTER: IN_TRANSIT,
  DELIVPLAN: IN_TRANSIT, DELIVDELAY: IN_TRANSIT, DELFAILMOV: IN_TRANSIT, DELFAILFOW: IN_TRANSIT,
  DELFAILPICK: IN_TRANSIT, MISSROUTED: IN_TRANSIT,
  CLEARIN: CUSTOMS, EXPCLEAR: CUSTOMS, EXPCUSTIN: CUSTOMS, IMPCLEAR: CUSTOMS, IMPCUSTIN: CUSTOMS,
  CLEAROUT: IN_TRANSIT, EXPCUSTOUT: IN_TRANSIT, IMPCUSTOUT: IN_TRANSIT,
  CLEARRET: EXCEPTION, EXPCLEARINC: EXCEPTION, IMPCLEARINC: EXCEPTION, EXPCUSTRET: EXCEPTION,
  IMPCUSTRET: EXCEPTION, EXPCANCEL: EXCEPTION, IMPCANCEL: EXCEPTION, INCIDPRO: EXCEPTION,
  PAYCHARG: EXCEPTION, DAMAGINSP: EXCEPTION, ITEMLOST: EXCEPTION, DESTROY: EXCEPTION,
  OUTDELIVCENTER: OUT_FOR_DELIVERY,
  PICKUPREAD: READY_FOR_PICKUP,
  ATTEMPT: FAILED_ATTEMPT, DELIVFAILURE: FAILED_ATTEMPT, DELFAILFORB: FAILED_ATTEMPT,
  DELFAILINCOR: FAILED_ATTEMPT, DELFAILUNKN: FAILED_ATTEMPT, DELFAILABS: FAILED_ATTEMPT,
  DELIVERY: DELIVERED,
  RETURNED: RETURNED, RETURNDEAD: RETURNED, RETURNUNCL: RETURNED, RETURNREFU: RETURNED,
  RETURNFORB: RETURNED, RETURNINC: RETURNED, RETURNUNKN: RETURNED, RETURNABS: RETURNED,
  RETURNMOV: RETURNED, RETURNSEND: RETURNED, DELIVSEND: RETURNED,
};

/** Exact wording of last-mile partner scans seen in A1 replies, compared with `comparableText`. */
const PARTNER_WORDING: Readonly<Record<string, ClassifiedAsendiaStatus>> = {
  delivered: DELIVERED,
  'out for delivery': OUT_FOR_DELIVERY,
  'customs released': IN_TRANSIT,
};

/**
 * The explicit mapping for one A1 event, or null when no map knows it. Codes
 * are read only for Asendia's own sources: partners reuse short codes such as
 * "10" or "B1" for unrelated scans.
 */
export function classifyAsendiaA1Event(
  source: string,
  code: string,
  description: string,
): ClassifiedAsendiaStatus | null {
  const origin = comparableText(source);
  const byCode = /^a1 [a-z ]*data$/.test(origin) ? A1_CODES
    : origin === 'fulltrack api' ? HARMONIZED_CODES
      : null;
  if (byCode) return Object.hasOwn(byCode, code) ? byCode[code]! : null;
  const wording = comparableText(description);
  return Object.hasOwn(PARTNER_WORDING, wording) ? PARTNER_WORDING[wording]! : null;
}
