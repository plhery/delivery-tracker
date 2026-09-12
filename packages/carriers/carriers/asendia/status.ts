/**
 * Asendia harmonized event wording → product stage.
 *
 * Asendia's branded portal harmonizes the wording of every partner post into
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
