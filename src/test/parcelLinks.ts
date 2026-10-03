import type { ParcelWithEvents, Stage } from '../types';
import type { ParcelLinkView } from '../peek/linkModel';

/** Fictional parcel links for the tests of this folder. */
export const LINK_ID = 'k7Qm2xHd9RtW';
export const OTHER_LINK_ID = 'm3Np8sVz4KcY';
export const OWNER_KEY = 'A'.repeat(43);

export function testParcel(overrides: Partial<ParcelWithEvents> = {}, stages: Stage[] = ['registered', 'in_transit']): ParcelWithEvents {
  return {
    id: 'parcel-1',
    trackingNumber: '1234567899',
    label: '',
    carrier: 'dhl',
    createdAt: '2026-10-01T08:00:00.000Z',
    syncStatus: 'ok',
    events: stages.map((stage, index) => ({
      id: `event-${index}`,
      parcelId: 'parcel-1',
      stage,
      description: stage === 'pending' ? 'Tracking added' : `Scan ${index + 1}`,
      occurredAt: new Date(Date.parse('2026-10-01T09:00:00.000Z') + index * 3_600_000).toISOString(),
    })),
    ...overrides,
  };
}

export function testView({ id = LINK_ID, owner = true, parcel, stages }: {
  id?: string;
  owner?: boolean;
  parcel?: Partial<ParcelWithEvents>;
  stages?: Stage[];
} = {}): ParcelLinkView {
  const shown = testParcel(parcel, stages);
  return {
    link: {
      id, role: owner ? 'owner' : 'viewer', kind: 'lookup', createdAt: '2026-10-01T08:00:00.000Z',
      forgetAt: '2026-12-30T08:00:00.000Z', numberShown: owner, canKeep: owner,
    },
    parcel: owner ? shown : { ...shown, trackingNumber: '' },
    numberHint: owner ? null : { head: '', tail: '99' },
  };
}

/** A view whose lookup has not been checked with the carrier yet. */
export function pendingView(id = LINK_ID): ParcelLinkView {
  return testView({ id, parcel: { syncStatus: 'pending' }, stages: ['pending'] });
}
