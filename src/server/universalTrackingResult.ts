import 'server-only';
import { trackingLanguageStage } from './trackingLanguage';

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
  return /enter .*?(?:postal|post|zip|phone)|select (?:a |the )?(?:carrier|destination country)|no information about your (?:package|parcel|shipment)|tracking (?:is |temporarily )?unavailable|tracking number (?:not found|is incorrect)|no tracking (?:information|data)|delivery preference|captcha|verify (?:you|your)|enable javascript|try again later/i.test(description);
}

export function hasPrivateDeliveryDetails(description: string): boolean {
  return /\bpin\s*:|(?:access|security|pickup|collection) code|(?:door|house) (?:no\b|number)|signed (?:for )?by|signature|numero civico|firmato da|signe par|signé par|code (?:de retrait|d'acces|d’accès)|numero de (?:rue|maison)|abholcode|zugangscode|hausnummer|unterschrieben von|codice (?:di ritiro|di accesso)/i.test(description);
}

function sourceEventStage(description: string, includeBroadMovement = true): Stage | undefined {
  // Public aggregators retain the carrier's French wording even in English.
  const french = description.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  if (/colis en preparation chez l'expediteur/.test(french)) return 'registered';
  if (/prise en charge de votre colis sur notre site logistique/.test(french)) return 'accepted';
  if (/return(?:ed|ing)? to (?:the )?sender/i.test(description)) return 'returned';
  if (/not delivered|could not.*deliver|unable to deliver|delivery (?:attempt|failed)/i.test(description)) return 'failed_attempt';
  if (/delivered to (?:the )?(?:local carrier|delivery partner|post office|pickup point)/i.test(description)) return 'in_transit';
  if (/will be available for (?:pickup|collection)/i.test(description)) return 'in_transit';
  if (/will be delivered|being prepared by the sender|en route to .*awaiting processing/i.test(description)) return 'registered';
  if (/\bdelivered\b|delivery completed/i.test(description)) return 'delivered';
  if (/ready for (?:pickup|collection)|available for (?:pickup|collection)/i.test(description)) return 'ready_for_pickup';
  if (/out for delivery/i.test(description)) return 'out_for_delivery';
  if (/clearance (?:processing )?completed|customs (?:cleared|released)/i.test(description)) return 'in_transit';
  if (/customs|clearance/i.test(description)) return 'customs';
  if (/instruction data.*provided.*electronically|electronic information|information (?:received|submitted)|label (?:created|printed)|pre.?advice|shipment announced/i.test(description)) return 'registered';
  if (/will be transported to the destination country/i.test(description)) return 'in_transit';
  if (!includeBroadMovement) return undefined;
  if (/package received at dhl ecommerce|^pick-up was successful[.!]?$|accepted|collected|picked up|handed over/i.test(description)) return 'accepted';
  if (/transit|arrived|departed|processed|processing completed at origin|sorting|sorted|transport|dispatched|en route|loaded to movement/i.test(description)) return 'in_transit';
  return undefined;
}

export function eventStage(description: string): Stage | undefined {
  return sourceEventStage(description, false) ?? trackingLanguageStage(description) ?? sourceEventStage(description);
}

const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;
const LOCAL_WALL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

function describe(description: unknown, stage?: unknown): { description: string; stage: Stage | 'pending' } | null {
  const label = text(description);
  if (!label || isNotice(label)) return null;
  const declared = typeof stage === 'string' && Object.hasOwn(STAGES, stage) ? STAGES[stage] : undefined;
  // Established source semantics (e.g. handoff/negation) remain first. A real
  // provider stage outranks the new intuitive translation fallback.
  const resolved = sourceEventStage(label, false) ?? declared ?? trackingLanguageStage(label) ?? sourceEventStage(label);
  if (resolved !== 'delivered' && hasPrivateDeliveryDetails(label)) return null;
  // Delivery descriptions can include signatures, access codes or door numbers.
  return { description: resolved === 'delivered' ? 'Delivered' : label, stage: resolved ?? 'pending' };
}

export function event(time: unknown, description: unknown, stage?: unknown): CarrierEvent | null {
  const described = describe(description, stage);
  if (!described) return null;
  // Require an explicit offset: universal events can originate in any timezone.
  if (typeof time !== 'string' || !EXPLICIT_OFFSET.test(time)) {
    throw new TypeError('Tracking event has no valid timezone');
  }
  const date = DateTime.fromISO(time, { setZone: true });
  if (!date.isValid) throw new TypeError('Tracking event has an invalid timestamp');
  return { time: date.toUTC().toISO()!, ...described };
}

/**
 * Like event(), but a scan without an offset keeps its wall time as local_time
 * instead of failing the whole shipment. Never invents a UTC instant.
 */
export function localEvent(time: unknown, description: unknown, stage?: unknown): CarrierEvent | null {
  if (typeof time === 'string' && EXPLICIT_OFFSET.test(time)) return event(time, description, stage);
  const described = describe(description, stage);
  if (!described) return null;
  if (typeof time !== 'string' || !LOCAL_WALL_TIME.test(time) || !DateTime.fromISO(time, { zone: 'UTC' }).isValid) {
    throw new TypeError('Tracking event has an invalid timestamp');
  }
  return { local_time: time, ...described };
}

function moment(value: CarrierEvent): string {
  return value.time ?? (typeof value.local_time === 'string' ? value.local_time : '');
}

export function result(events: CarrierEvent[], source: UniversalSource, preserveOrder = false): CarrierResult {
  // Wall times sort alongside UTC instants only approximately; providers that
  // omit offsets everywhere pass preserveOrder instead.
  const unique = [...new Map(events.map((e) => [`${moment(e)}|${e.description}`, e])).values()]
    .sort((a, b) => preserveOrder ? 0 : moment(b).localeCompare(moment(a))).slice(0, 100);
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
