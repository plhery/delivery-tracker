import type { Stage, TrackingEvent } from '../types';

/** The happy path, in order. Progress is measured against these. */
export const CORE_STAGES: readonly Stage[] = [
  'pending',
  'registered',
  'accepted',
  'in_transit',
  'out_for_delivery',
  'delivered',
];

export interface StageMeta {
  label: string;
  emoji: string;
  /** Visual tone: ok = normal progress, warn = needs attention, done = final. */
  tone: 'ok' | 'warn' | 'done';
  /** Where this stage sits on the happy path (index into CORE_STAGES). */
  progress: number;
}

export const STAGE_META: Record<Stage, StageMeta> = {
  pending: { label: 'Tracked', emoji: '🔎', tone: 'ok', progress: 0 },
  registered: { label: 'Announced', emoji: '📝', tone: 'ok', progress: 1 },
  accepted: { label: 'Posted', emoji: '📮', tone: 'ok', progress: 2 },
  in_transit: { label: 'In transit', emoji: '🚚', tone: 'ok', progress: 3 },
  customs: { label: 'At customs', emoji: '🛃', tone: 'warn', progress: 3 },
  out_for_delivery: {
    label: 'Out for delivery',
    emoji: '🛵',
    tone: 'ok',
    progress: 4,
  },
  failed_attempt: {
    label: 'Delivery attempted',
    emoji: '📪',
    tone: 'warn',
    progress: 4,
  },
  ready_for_pickup: {
    label: 'Ready for pickup',
    emoji: '🏤',
    tone: 'warn',
    progress: 4,
  },
  exception: {
    label: 'Needs attention',
    emoji: '⚠️',
    tone: 'warn',
    progress: 3,
  },
  delivered: { label: 'Delivered', emoji: '✅', tone: 'done', progress: 5 },
  returned: { label: 'Returned to sender', emoji: '↩️', tone: 'warn', progress: 5 },
};

export function stageMeta(stage: Stage): StageMeta {
  return STAGE_META[stage];
}

/** Shared with notification ordering; coarse carrier times resolve by delivery progress. */
export const EVENT_STAGE_ORDER: readonly string[] = ['pending', 'registered', 'accepted', 'in_transit', 'customs',
  'exception', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered', 'returned'];

/** What ordering a scan needs: the server's rows and the apps' events both have it. */
type OrderedScan = Pick<TrackingEvent, 'id' | 'stage' | 'occurredAt'>;

/** Newest first, then delivery progress, then stable event identity. */
export function sortEventsDesc<T extends OrderedScan>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => {
    const timestamp = (value: string) => Date.parse(value) || 0;
    return timestamp(b.occurredAt) - timestamp(a.occurredAt)
      || EVENT_STAGE_ORDER.indexOf(b.stage) - EVENT_STAGE_ORDER.indexOf(a.stage)
      || b.id.localeCompare(a.id);
  });
}

export function latestEvent(events: TrackingEvent[]): TrackingEvent | null {
  return sortEventsDesc(events)[0] ?? null;
}

/** Carrier stages before the parcel moves, in order. */
const EARLY_STAGES: readonly Stage[] = ['registered', 'accepted'];
/** Stages of a parcel on its way, short of a final one. */
const MOVING_STAGES: ReadonlySet<Stage> = new Set<Stage>(['in_transit', 'customs', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup']);

/**
 * The event that represents the parcel's current delivery state.
 *
 * A pending event only records that tracking was added to this app. Carrier
 * history can predate that action, so pending must not override a real update
 * merely because it has a newer timestamp. An announcement or acceptance after
 * the parcel has moved on is a notice or a reworded scan, not a step back: the
 * scan before it still says where the parcel is. After a problem, a return or
 * a delivery, a new label starts over.
 */
export function currentEvent(events: TrackingEvent[]): TrackingEvent | null {
  const carrier = sortEventsDesc(events.filter((event) => event.stage !== 'pending'));
  let current = carrier[0];
  if (!current) return latestEvent(events);
  for (const event of carrier.slice(1)) {
    if (!EARLY_STAGES.includes(current.stage)) break;
    if (MOVING_STAGES.has(event.stage)) return event;
    if (!EARLY_STAGES.includes(event.stage)) break;
    if (EARLY_STAGES.indexOf(event.stage) > EARLY_STAGES.indexOf(current.stage)) current = event;
  }
  return current;
}

/** Stages that move a parcel: notices (announced, posted), problem reports and a delivery itself do not. */
const MOVEMENTS: ReadonlySet<Stage> = new Set<Stage>([...MOVING_STAGES, 'returned']);

/**
 * Whether a delivered parcel was collected from its pickup point: its last
 * movement before the delivery made it ready for pickup. Notices, problem
 * reports and further delivery scans moved nothing. A parcel taken back out
 * for delivery after it waited was brought to the door; one sent on or
 * returned was not collected there either. Null when no scan moved it.
 */
export function collectedFromPickupPoint(events: readonly OrderedScan[]): boolean | null {
  const moved = sortEventsDesc(events).find((event) => MOVEMENTS.has(event.stage));
  return moved ? moved.stage === 'ready_for_pickup' : null;
}

export function currentStage(events: TrackingEvent[]): Stage | null {
  return currentEvent(events)?.stage ?? null;
}

/** 0..5 position on the happy path; -1 when there are no events yet. */
export function progressIndex(events: TrackingEvent[]): number {
  const stage = currentStage(events);
  return stage === null ? -1 : STAGE_META[stage].progress;
}

export function isDelivered(events: TrackingEvent[]): boolean {
  return currentStage(events) === 'delivered';
}

export function isFinal(stage: Stage): boolean {
  return stage === 'delivered' || stage === 'returned';
}
