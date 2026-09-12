/**
 * India Post status vocabulary.
 *
 * The tracking rows carry no stable status code: `event_type`, `event` and
 * `remarks` are all English prose that India Post words differently per office.
 * So this classifier normalizes the three of them into one alphanumeric key and
 * matches substrings, most specific first — returns and failures before
 * deliveries, deliveries before pickups, pickups before generic movement.
 *
 * The fallback is `{ status: 'unknown', stage: 'in_transit' }`: every row here
 * is a physical scan, so "something moved" is the safe reading, while the
 * `unknown` status lets the caller see that nothing was actually recognized.
 *
 * Provenance: the MySpeedPost Livewire tracker inspected 2026-09-01, with
 * https://github.com/bivu-m/njs-tracker-scraper as the starting point.
 */
import type { ClassifiedStatus } from '../../core/status';
import { cleanScalar } from '../../core/transport';

function statusKey(value: unknown): string {
  return cleanScalar(value, 200).toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '');
}

function includesAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

/**
 * Classify one row from its `event_type`, `event` and `remarks`. Never
 * undefined: an unrecognized row falls back to an `unknown` status on an
 * `in_transit` stage.
 */
export function classifyIndiaPostEvent(...values: unknown[]): ClassifiedStatus {
  const key = values.map(statusKey).filter(Boolean).join(' ');
  if (includesAny(key, [
    'returntosender',
    'returnedtocustomer',
    'returnedtobookingoffice',
    'returnitem',
  ])) return { status: 'exception', stage: 'returned' };
  if (includesAny(key, [
    'insufficientaddress',
    'addresseecannotbelocated',
    'damaged',
    'refused',
    'lost',
  ])) return { status: 'exception', stage: 'exception' };
  if (includesAny(key, [
    'deliveryattempted',
    'deliveryfailed',
    'notdelivered',
    'undelivered',
  ])) return { status: 'exception', stage: 'failed_attempt' };
  if (includesAny(key, [
    'itemdelivered',
    'deliveredtorecipient',
    'delivereddelivery',
  ])) return { status: 'delivered', stage: 'delivered' };
  if (includesAny(key, [
    'readyforpickup',
    'readyforcollection',
    'awaitingcollection',
  ])) return { status: 'out_for_delivery', stage: 'ready_for_pickup' };
  if (includesAny(key, [
    'outfordelivery',
    'itemoutfordelivery',
    'sentfordelivery',
  ])) return { status: 'out_for_delivery', stage: 'out_for_delivery' };
  if (includesAny(key, ['customs', 'customclearance'])) {
    return { status: 'in_transit', stage: 'customs' };
  }
  if (includesAny(key, ['itembooked', 'articlebooked', 'bookingconfirmed'])) {
    return { status: 'pending', stage: 'accepted' };
  }
  if (includesAny(key, [
    'shipmentinformationreceived',
    'labelcreated',
    'articlecreated',
    'consignmentcreated',
  ])) return { status: 'pending', stage: 'registered' };
  if (includesAny(key, [
    'itembagged',
    'itemdispatched',
    'itemreceived',
    'receivedat',
    'departed',
    'arrived',
    'forwarded',
    'intransit',
    'handedover',
  ])) return { status: 'in_transit', stage: 'in_transit' };
  return { status: 'unknown', stage: 'in_transit' };
}
