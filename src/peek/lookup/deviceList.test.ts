import { describe, expect, it } from 'vitest';
import { LINK_ID, OTHER_LINK_ID, testView } from '../../test/parcelLinks';
import type { EventPlace, ParcelWithEvents, Stage } from '../../types';
import type { RecentParcel } from '../recents';
import { leadParcel } from './deviceList';

const THIRD_LINK_ID = 'p5Rt9wJq2LbX';
const zurich: EventPlace = { latitude: 47.38, longitude: 8.54, precision: 'city', country: 'CH', name: 'Zürich' };
/** The test parcels' scans are an hour apart from this morning on. */
const now = Date.parse('2026-10-01T14:00:00.000Z');
const HOUR = 3_600_000;

/** A parcel of the device. `placed` gives its scans a place, which a lead card needs to draw a route. */
function recent(id: string, stages: Stage[], { placed = true, parcel = {} }: { placed?: boolean; parcel?: Partial<ParcelWithEvents> } = {}): RecentParcel {
  const view = testView({ id, stages, parcel });
  if (placed) view.parcel.events = view.parcel.events.map((event) => ({ ...event, place: zurich }));
  return {
    id, key: null, name: null, carrier: view.parcel.carrier, stage: stages.at(-1) ?? null, syncStatus: view.parcel.syncStatus,
    expectedDelivery: view.parcel.expectedDelivery ?? null, updatedAt: null, lastSeenAt: new Date(now).toISOString(), snapshot: view,
  };
}

describe('leadParcel', () => {
  it('leads with the parcel the deliveries would call Next up, wherever it stands in the list', () => {
    const moving = recent(LINK_ID, ['accepted', 'in_transit']);
    const today = recent(OTHER_LINK_ID, ['accepted', 'out_for_delivery']);
    const waiting = recent(THIRD_LINK_ID, ['accepted', 'ready_for_pickup']);
    expect(leadParcel([moving, today], now)).toBe(today);
    expect(leadParcel([moving, today, waiting], now)).toBe(waiting);
  });

  it('only lets a parcel with a located scan lead', () => {
    const today = recent(LINK_ID, ['accepted', 'out_for_delivery'], { placed: false });
    const moving = recent(OTHER_LINK_ID, ['accepted', 'in_transit']);
    expect(leadParcel([today, moving], now)).toBe(moving);
    expect(leadParcel([today], now)).toBeNull();
    expect(leadParcel([], now)).toBeNull();
  });

  it('leads with a parcel that needs attention when nothing else is on its way', () => {
    const held = recent(LINK_ID, ['accepted', 'customs']);
    const arrived = recent(OTHER_LINK_ID, ['accepted', 'delivered']);
    expect(leadParcel([arrived, held], now)).toBe(held);
  });

  it('leads with a parcel that just arrived, for a day', () => {
    const arrived = recent(LINK_ID, ['accepted', 'delivered']);
    expect(leadParcel([arrived], now)).toBe(arrived);
    // A day after the journey ended the parcel rests among the others.
    expect(leadParcel([arrived], now + 25 * HOUR)).toBeNull();
    const moving = recent(OTHER_LINK_ID, ['accepted', 'in_transit']);
    expect(leadParcel([arrived, moving], now)).toBe(moving);
  });
});
