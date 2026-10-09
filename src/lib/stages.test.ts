import { describe, expect, it } from 'vitest';
import type { TrackingEvent } from '../types';
import {
  collectedFromPickupPoint,
  CORE_STAGES,
  currentEvent,
  currentStage,
  isDelivered,
  isFinal,
  latestEvent,
  progressIndex,
  sortEventsDesc,
  STAGE_META,
} from './stages';

function makeEvent(overrides: Partial<TrackingEvent>): TrackingEvent {
  return {
    id: 'e1',
    parcelId: 'p1',
    stage: 'registered',
    description: '',
    occurredAt: '2026-06-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('CORE_STAGES', () => {
  it('goes from pre-announcement to delivery in order', () => {
    expect(CORE_STAGES).toEqual([
      'pending',
      'registered',
      'accepted',
      'in_transit',
      'out_for_delivery',
      'delivered',
    ]);
  });

  it('has metadata whose progress matches the happy-path order', () => {
    CORE_STAGES.forEach((stage, i) => {
      expect(STAGE_META[stage].progress).toBe(i);
    });
  });

  it('maps exceptions onto sensible happy-path positions', () => {
    expect(STAGE_META.customs.progress).toBe(STAGE_META.in_transit.progress);
    expect(STAGE_META.failed_attempt.progress).toBe(
      STAGE_META.out_for_delivery.progress,
    );
    expect(STAGE_META.ready_for_pickup.progress).toBe(
      STAGE_META.out_for_delivery.progress,
    );
    // A reported problem does not move the parcel; it only needs attention.
    expect(STAGE_META.exception.progress).toBe(STAGE_META.in_transit.progress);
    expect(STAGE_META.exception.tone).toBe('warn');
    expect(isFinal('exception')).toBe(false);
  });
});

describe('sortEventsDesc / latestEvent', () => {
  const older = makeEvent({ id: 'a', occurredAt: '2026-06-01T08:00:00.000Z' });
  const newer = makeEvent({
    id: 'b',
    stage: 'in_transit',
    occurredAt: '2026-06-02T08:00:00.000Z',
  });

  it('sorts newest first regardless of input order', () => {
    expect(sortEventsDesc([older, newer])[0]).toBe(newer);
    expect(sortEventsDesc([newer, older])[0]).toBe(newer);
  });

  it('does not mutate the input', () => {
    const input = [older, newer];
    sortEventsDesc(input);
    expect(input[0]).toBe(older);
  });

  it('latestEvent returns null for no events', () => {
    expect(latestEvent([])).toBeNull();
  });

  it('latestEvent picks the most recent one', () => {
    expect(latestEvent([older, newer])?.stage).toBe('in_transit');
  });
});

describe('currentStage / progressIndex', () => {
  it('returns null / -1 with no events', () => {
    expect(currentStage([])).toBeNull();
    expect(progressIndex([])).toBe(-1);
  });

  it('follows the latest event', () => {
    const events = [
      makeEvent({ id: 'a', stage: 'registered', occurredAt: '2026-06-01T08:00:00.000Z' }),
      makeEvent({ id: 'b', stage: 'out_for_delivery', occurredAt: '2026-06-03T08:00:00.000Z' }),
    ];
    expect(currentStage(events)).toBe('out_for_delivery');
    expect(progressIndex(events)).toBe(4);
  });

  it('does not let a newer app tracking event override a carrier status', () => {
    const carrierUpdate = makeEvent({
      id: 'carrier',
      stage: 'in_transit',
      occurredAt: '2026-06-01T08:00:00.000Z',
    });
    const trackingAdded = makeEvent({
      id: 'app',
      stage: 'pending',
      occurredAt: '2026-06-03T08:00:00.000Z',
    });

    expect(latestEvent([carrierUpdate, trackingAdded])).toBe(trackingAdded);
    expect(currentEvent([carrierUpdate, trackingAdded])).toBe(carrierUpdate);
    expect(currentStage([carrierUpdate, trackingAdded])).toBe('in_transit');
    expect(progressIndex([carrierUpdate, trackingAdded])).toBe(3);
  });

  it('does not let a newer announcement or acceptance step a moving parcel back', () => {
    const transit = makeEvent({ id: 'transit', stage: 'in_transit', occurredAt: '2026-06-02T08:00:00.000Z' });
    const accepted = makeEvent({ id: 'accepted', stage: 'accepted', occurredAt: '2026-06-03T08:00:00.000Z' });
    const notice = makeEvent({ id: 'notice', stage: 'registered', occurredAt: '2026-06-04T08:00:00.000Z' });
    const added = makeEvent({ id: 'added', stage: 'pending', occurredAt: '2026-06-05T08:00:00.000Z' });
    expect(currentEvent([transit, accepted, notice, added])).toBe(transit);
    expect(currentStage([notice, makeEvent({ ...transit, stage: 'out_for_delivery' })])).toBe('out_for_delivery');
    expect(currentEvent([makeEvent({ id: 'label', stage: 'registered', occurredAt: '2026-06-01T08:00:00.000Z' }), accepted, notice]))
      .toBe(accepted);
    expect(currentEvent([notice])).toBe(notice);
  });

  it('lets a new label start over after a problem, a return or a delivery', () => {
    const label = makeEvent({ id: 'label', stage: 'registered', occurredAt: '2026-06-04T08:00:00.000Z' });
    for (const stage of ['exception', 'returned', 'delivered'] as const) {
      const before = makeEvent({ id: 'before', stage, occurredAt: '2026-06-03T08:00:00.000Z' });
      const transit = makeEvent({ id: 'transit', stage: 'in_transit', occurredAt: '2026-06-02T08:00:00.000Z' });
      expect(currentEvent([transit, before, label])).toBe(label);
    }
    // A newer movement or problem is the current state, as before.
    const problem = makeEvent({ id: 'problem', stage: 'exception', occurredAt: '2026-06-05T08:00:00.000Z' });
    expect(currentEvent([label, problem])).toBe(problem);
  });

  it('keeps progress at in-transit level while at customs', () => {
    const events = [
      makeEvent({ id: 'a', stage: 'customs', occurredAt: '2026-06-03T08:00:00.000Z' }),
    ];
    expect(progressIndex(events)).toBe(3);
  });
});

describe('isDelivered / isFinal', () => {
  it('detects delivery from the latest event', () => {
    const events = [
      makeEvent({ id: 'a', stage: 'delivered', occurredAt: '2026-06-04T08:00:00.000Z' }),
      makeEvent({ id: 'b', stage: 'in_transit', occurredAt: '2026-06-02T08:00:00.000Z' }),
    ];
    expect(isDelivered(events)).toBe(true);
    expect(isDelivered([events[1]])).toBe(false);
  });

  it('keeps a parcel delivered when tracking was added later', () => {
    const events = [
      makeEvent({ id: 'delivered', stage: 'delivered', occurredAt: '2026-06-01T08:00:00.000Z' }),
      makeEvent({ id: 'app', stage: 'pending', occurredAt: '2026-06-04T08:00:00.000Z' }),
    ];

    expect(isDelivered(events)).toBe(true);
  });

  it('treats delivered and returned as final', () => {
    expect(isFinal('delivered')).toBe(true);
    expect(isFinal('returned')).toBe(true);
    expect(isFinal('out_for_delivery')).toBe(false);
    expect(isFinal('ready_for_pickup')).toBe(false);
  });
});

describe('collectedFromPickupPoint', () => {
  const journey = (...stages: TrackingEvent['stage'][]) => stages.map((stage, index) =>
    makeEvent({ id: `e${index}`, stage, occurredAt: new Date(Date.UTC(2026, 5, 1, 8 + index)).toISOString() }));

  it('is true when the last movement before the delivery made the parcel ready for pickup', () => {
    expect(collectedFromPickupPoint(journey('accepted', 'in_transit', 'ready_for_pickup', 'delivered'))).toBe(true);
    // Notices, problem reports and further delivery scans move nothing.
    expect(collectedFromPickupPoint(journey('in_transit', 'ready_for_pickup', 'registered', 'exception', 'pending', 'delivered', 'delivered'))).toBe(true);
    // The order is the scans' own, not the order they arrive in.
    expect(collectedFromPickupPoint(journey('in_transit', 'ready_for_pickup', 'delivered').reverse())).toBe(true);
  });

  it('is false for a parcel taken back out for delivery, sent on or returned after it waited', () => {
    expect(collectedFromPickupPoint(journey('ready_for_pickup', 'out_for_delivery', 'delivered'))).toBe(false);
    expect(collectedFromPickupPoint(journey('failed_attempt', 'ready_for_pickup', 'in_transit', 'delivered'))).toBe(false);
    expect(collectedFromPickupPoint(journey('ready_for_pickup', 'returned', 'delivered'))).toBe(false);
    expect(collectedFromPickupPoint(journey('in_transit', 'out_for_delivery', 'delivered'))).toBe(false);
  });

  it('is null when no scan moved the parcel', () => {
    expect(collectedFromPickupPoint([])).toBeNull();
    expect(collectedFromPickupPoint(journey('pending', 'registered', 'delivered'))).toBeNull();
  });
});
