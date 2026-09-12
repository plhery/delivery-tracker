import { describe, expect, it } from 'vitest';
import { expectedDeliveryDay, nextPriorityParcel, parcelAttention, prioritizeActiveParcels } from './parcelPriority';
import type { ParcelWithEvents, Stage } from '../types';

const NOW = new Date(2026, 7, 5, 12).getTime();

function parcel(
  id: string,
  stage: Stage = 'in_transit',
  occurredAt = '2026-08-05T08:00:00Z',
): ParcelWithEvents {
  return {
    id,
    trackingNumber: `TRACK${id}1`,
    label: id,
    carrier: 'swiss-post',
    createdAt: '2026-08-01T08:00:00Z',
    syncStatus: 'ok',
    events: [{ id: `event-${id}`, parcelId: id, stage, description: stage, occurredAt }],
  };
}

describe('parcel priority', () => {
  it.each(['ready_for_pickup', 'failed_attempt', 'customs', 'exception'] as const)(
    'keeps %s actionable even when the latest check failed', (stage) => {
      expect(parcelAttention({ ...parcel('action', stage), syncStatus: 'error' }, NOW)).toBe(stage);
    },
  );

  it('highlights an immediate delivery before a sync outage, but preserves pickup urgency', () => {
    const outage = { ...parcel('outage'), syncStatus: 'error' as const };
    const delivery = parcel('delivery', 'out_for_delivery');
    const pickup = { ...parcel('pickup', 'ready_for_pickup'), syncStatus: 'error' as const };
    expect(nextPriorityParcel([outage, delivery], NOW)?.id).toBe('delivery');
    expect(nextPriorityParcel([outage, delivery, pickup], NOW)?.id).toBe('pickup');
    expect(nextPriorityParcel([outage, { ...delivery, archivedAt: '2026-08-05' }], NOW)).toBeNull();
    expect(nextPriorityParcel([], NOW)).toBeNull();
  });
  it('separates customs and failed delivery notices from the next arrival', () => {
    const customs = { ...parcel('customs', 'customs'), expectedDelivery: '2026-08-05' };
    const failed = parcel('failed', 'failed_attempt');
    const delivery = { ...parcel('delivery', 'out_for_delivery'), syncStatus: 'error' as const };
    expect(nextPriorityParcel([customs, failed, delivery], NOW)?.id).toBe('delivery');
    expect(nextPriorityParcel([customs, failed], NOW)).toBeNull();
    expect(prioritizeActiveParcels([customs, failed], NOW).attention).toHaveLength(2);
  });

  it('recognizes dates with or without delivery windows', () => {
    expect(expectedDeliveryDay('2026-08-05')).toBe('2026-08-05');
    expect(expectedDeliveryDay('2026-08-05 13:00–15:00')).toBe('2026-08-05');
    expect(expectedDeliveryDay('Awaiting estimate')).toBeNull();
  });

  it('identifies actionable and stale parcels', () => {
    expect(parcelAttention(parcel('failed', 'failed_attempt'), NOW)).toBe('failed_attempt');
    expect(parcelAttention(parcel('problem', 'exception'), NOW)).toBe('exception');
    expect(parcelAttention(parcel('pickup', 'ready_for_pickup'), NOW)).toBe('ready_for_pickup');
    expect(parcelAttention(parcel('customs', 'customs'), NOW)).toBe('customs');
    expect(
      parcelAttention(parcel('stalled', 'in_transit', '2026-07-30T08:00:00Z'), NOW),
    ).toBe('stalled');
    expect(parcelAttention({ ...parcel('error'), syncStatus: 'error' }, NOW)).toBe('sync_error');
  });

  it('only escalates an unannounced parcel after two days', () => {
    const recent = parcel('recent', 'pending', '2026-08-04T08:00:00Z');
    recent.createdAt = '2026-08-04T13:00:00Z';
    recent.syncStatus = 'waiting';
    expect(parcelAttention(recent, NOW)).toBeNull();

    const old = parcel('old', 'pending', '2026-08-01T08:00:00Z');
    old.syncStatus = 'waiting';
    expect(parcelAttention(old, NOW)).toBe('not_announced');
  });

  it('creates disjoint attention, today, and ordinary groups', () => {
    const attention = parcel('attention', 'customs');
    attention.expectedDelivery = '2026-08-05';
    const today = parcel('today');
    today.expectedDelivery = '2026-08-05 14:00–16:00';
    const later = parcel('later');
    later.expectedDelivery = '2026-08-07';

    const result = prioritizeActiveParcels([later, attention, today], NOW);

    expect(result.attention.map((item) => item.parcel.id)).toEqual(['attention']);
    expect(result.arrivingToday.map((item) => item.id)).toEqual(['today']);
    expect(result.onTheWay.map((item) => item.id)).toEqual(['later']);
  });
});
