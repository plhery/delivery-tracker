import 'server-only';

import { DateTime } from 'luxon';
import type { Stage } from '../types';
import type { CarrierEvent, CarrierResult, CarrierStatus } from './carrierResult';

export type UniversalSource = '17TRACK' | 'ParcelsApp' | 'Postal Ninja' | 'Ship24';
const STAGES: Record<string, Stage> = {
  InfoReceived: 'registered', InTransit: 'in_transit', AvailableForPickup: 'ready_for_pickup',
  OutForDelivery: 'out_for_delivery', DeliveryFailure: 'failed_attempt', Delivered: 'delivered',
};

export function numberOf(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^(?=.*\d)[A-Z0-9]{4,40}$/.test(number)) throw new TypeError('Invalid tracking number');
  return number;
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
}

// Universal sites mix carrier events with UI notices. Notices must not manufacture a
// shipment timestamp or make an electronic announcement look like movement.
export function isNotice(description: string): boolean {
  return /enter .*?(?:postal|post|zip|phone)|select (?:a |the )?carrier|tracking (?:is |temporarily )?unavailable|tracking number (?:not found|is incorrect)|no tracking (?:information|data)|delivery preference|captcha|verify (?:you|your)|enable javascript|try again later/i.test(description);
}

export function hasPrivateDeliveryDetails(description: string): boolean {
  return /\bpin\s*:|(?:access|security|pickup|collection) code|(?:door|house) (?:no\b|number)|signed (?:for )?by|signature|numero civico|firmato da/i.test(description);
}

export function eventStage(description: string): Stage | undefined {
  if (/return(?:ed|ing)? to (?:the )?sender/i.test(description)) return 'returned';
  if (/not delivered|could not.*deliver|unable to deliver|delivery (?:attempt|failed)/i.test(description)) return 'failed_attempt';
  if (/delivered to (?:the )?(?:local carrier|delivery partner|post office|pickup point)/i.test(description)) return 'in_transit';
  if (/will be delivered|being prepared by the sender|en route to .*awaiting processing/i.test(description)) return 'registered';
  if (/\bdelivered\b|delivery completed/i.test(description)) return 'delivered';
  if (/ready for (?:pickup|collection)|available for (?:pickup|collection)/i.test(description)) return 'ready_for_pickup';
  if (/out for delivery/i.test(description)) return 'out_for_delivery';
  if (/customs|clearance/i.test(description)) return 'customs';
  if (/electronic information|information (?:received|submitted)|label (?:created|printed)|pre.?advice|shipment announced/i.test(description)) return 'registered';
  if (/accepted|collected|picked up|handed over/i.test(description)) return 'accepted';
  if (/transit|arrived|departed|processed|sorting|sorted|transport|dispatched|en route|loaded to movement/i.test(description)) return 'in_transit';
  return undefined;
}

export function event(time: unknown, description: unknown, stage?: unknown): CarrierEvent | null {
  const label = text(description);
  if (!label || isNotice(label)) return null;
  // Require an explicit offset: universal events can originate in any timezone.
  if (typeof time !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(time)) {
    throw new TypeError('Tracking event has no valid timezone');
  }
  const date = DateTime.fromISO(time, { setZone: true });
  if (!date.isValid) throw new TypeError('Tracking event has an invalid timestamp');
  const declared = typeof stage === 'string' && Object.hasOwn(STAGES, stage) ? STAGES[stage] : undefined;
  const resolved = eventStage(label) ?? declared;
  if (resolved !== 'delivered' && hasPrivateDeliveryDetails(label)) return null;
  return {
    // Delivery descriptions can include signatures, access codes or door numbers.
    time: date.toUTC().toISO()!, description: resolved === 'delivered' ? 'Delivered' : label,
    stage: resolved ?? 'pending',
  };
}

export function result(events: CarrierEvent[], source: UniversalSource, preserveOrder = false): CarrierResult {
  const unique = [...new Map(events.map((e) => [`${e.time ?? e.local_time}|${e.description}`, e])).values()]
    .sort((a, b) => preserveOrder ? 0 : (b.time ?? '').localeCompare(a.time ?? '')).slice(0, 100);
  if (!unique.length) throw new TypeError('No usable tracking events');
  const current = unique.find((e) => e.stage && e.stage !== 'pending')?.stage as Stage | undefined;
  // Unknown wording can be displayed, but must not imply movement.
  const status: CarrierStatus = current === 'delivered' ? 'delivered'
    : current === 'registered' || !current ? 'pending'
      : current === 'out_for_delivery' || current === 'ready_for_pickup' ? 'out_for_delivery'
        : ['returned', 'failed_attempt', 'exception'].includes(current) ? 'exception' : 'in_transit';
  return {
    status, current_stage: current ?? 'pending', last_status_text: unique[0].description,
    last_update: unique[0].time ?? null, expected_delivery: null, timezone: 'UTC',
    tracking_provider: source, events: unique,
  };
}
