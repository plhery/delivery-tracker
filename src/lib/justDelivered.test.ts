import { describe, expect, it } from 'vitest';
import { justDelivered } from './justDelivered';
import type { ParcelWithEvents, Stage } from '../types';

const parcel = (id: string, stage: Stage | null, change: Partial<ParcelWithEvents> = {}): ParcelWithEvents => ({
  id, trackingNumber: `${id}-number`, label: id, carrier: 'dhl', createdAt: '2026-09-01T08:00:00Z', syncStatus: 'ok',
  events: stage ? [{ id: `${id}-scan`, parcelId: id, stage, description: 'Scan', occurredAt: '2026-09-02T08:00:00Z' }] : [],
  ...change,
});

describe('parcels delivered since the list was last shown', () => {
  it('are those the list showed on their way, as it showed them', () => {
    const shown = [parcel('tea', 'out_for_delivery'), parcel('lamp', 'in_transit'), parcel('book', 'delivered'), parcel('new', null)];
    const now = [parcel('tea', 'delivered'), parcel('lamp', 'out_for_delivery'), parcel('book', 'delivered'), parcel('new', 'delivered')];
    expect(justDelivered(shown, now)).toEqual([shown[0], shown[3]]);
  });

  it('leave out a parcel the list did not show, or showed in the archive or as returned', () => {
    const shown = [parcel('archived', 'in_transit', { archivedAt: '2026-09-03T08:00:00Z' }), parcel('returned', 'returned')];
    const now = [parcel('archived', 'delivered', { archivedAt: '2026-09-03T08:00:00Z' }), parcel('returned', 'delivered'), parcel('fresh', 'delivered')];
    expect(justDelivered(shown, now)).toEqual([]);
  });

  it('leave out a parcel that was archived in the meantime, or that is gone', () => {
    const shown = [parcel('tea', 'out_for_delivery'), parcel('lamp', 'out_for_delivery')];
    expect(justDelivered(shown, [parcel('tea', 'delivered', { archivedAt: '2026-09-03T08:00:00Z' })])).toEqual([]);
  });
});
