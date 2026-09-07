import { describe, expect, it } from 'vitest';
import type { ParcelWithEvents, SyncStatus } from '../types';
import { parcelDeliveryEstimate, localizedParcelCompletionDate, parcelDisplayStatus, parcelDisplayStatusKey } from './parcelStatus';

function parcel(syncStatus: SyncStatus, stage: 'pending' | 'in_transit' = 'pending'): ParcelWithEvents {
  return {
    id: 'package-1',
    trackingNumber: '993412345612345678',
    label: 'Coffee',
    carrier: 'swiss-post',
    createdAt: '2026-07-16T10:00:00Z',
    syncStatus,
    events: [
      {
        id: 'event-1',
        parcelId: 'package-1',
        stage,
        description: 'Tracking added',
        occurredAt: '2026-07-16T10:00:00Z',
      },
    ],
  };
}

describe('parcelDisplayStatus', () => {
  it('shows the initial lookup separately from carrier announcement', () => {
    expect(parcelDisplayStatus(parcel('pending'))).toEqual({
      label: "Checking for updates",
      tone: 'ok',
      syncing: true,
    });
    expect(parcelDisplayStatus(parcel('syncing')).label).toBe("Checking for updates");
    expect(parcelDisplayStatus(parcel('waiting')).label).toBe("Waiting for the carrier");
  });

  it('makes first-sync failures and unsupported carriers explicit', () => {
    expect(parcelDisplayStatus(parcel('error')).label).toBe("Update unavailable");
    expect(parcelDisplayStatus(parcel('unsupported')).label).toBe("Check tracking website");
  });

  it('explains link-only tracking immediately, before a worker checks it', () => {
    for (const carrier of ['intl-post', 'unknown', 'fedex'] as const) {
      const saved = { ...parcel('pending'), carrier };
      expect(parcelDisplayStatus(saved)).toEqual({
        label: "Check tracking website", tone: 'warn', syncing: false,
      });
      expect(parcelDisplayStatusKey(saved)).toBe('status.unsupported');
      saved.events[0].stage = 'in_transit';
      expect(parcelDisplayStatusKey(saved)).toBe('stage.in_transit');
    }
  });

  it('keeps a real carrier stage visible during later sync attempts or errors', () => {
    expect(parcelDisplayStatus(parcel('syncing', 'in_transit')).label).toBe('In transit');
    expect(parcelDisplayStatus(parcel('error', 'in_transit')).label).toBe('In transit');
  });

  it('keeps an older carrier event visible when tracking was added later', () => {
    const tracked = parcel('waiting');
    tracked.events.unshift({
      id: 'event-carrier',
      parcelId: tracked.id,
      stage: 'in_transit',
      description: 'In transit',
      occurredAt: '2026-07-15T10:00:00Z',
    });

    expect(parcelDisplayStatus(tracked).label).toBe('In transit');
  });

  it('folds a final event date into one concise status line', () => {
    const delivered = parcel('ok', 'in_transit');
    delivered.events[0].stage = 'delivered';
    delivered.events[0].occurredAt = '2026-07-16T10:00:00Z';
    expect(localizedParcelCompletionDate(delivered, 'de-CH')).toBe('16.7.26');
  });
});

describe('useful delivery estimates', () => {
  const now = new Date(2026, 8, 7, 12).getTime();
  it.each(['delivered', 'returned', 'failed_attempt', 'ready_for_pickup'] as const)('hides estimates after %s', (stage) => {
    const saved = parcel('ok');
    saved.events[0].stage = stage;
    saved.expectedDelivery = '2026-09-07';
    expect(parcelDeliveryEstimate(saved, now)).toBeNull();
  });
  it('keeps windows while omitting redundant today and stale estimates', () => {
    const saved = parcel('ok');
    saved.events[0].stage = 'out_for_delivery';
    saved.expectedDelivery = '2026-09-07';
    expect(parcelDeliveryEstimate(saved, now)).toBeNull();
    saved.expectedDelivery = '2026-09-07 14:00–16:00';
    expect(parcelDeliveryEstimate(saved, now)).toBe(saved.expectedDelivery);
    saved.events[0].stage = 'in_transit';
    saved.expectedDelivery = '2026-09-07';
    expect(parcelDeliveryEstimate(saved, now)).toBe(saved.expectedDelivery);
    for (const value of ['2026-09-06', 'invalid']) {
      saved.expectedDelivery = value;
      expect(parcelDeliveryEstimate(saved, now)).toBeNull();
    }
  });
});
