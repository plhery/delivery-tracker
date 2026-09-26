import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEvents, providerEventId } from './trackingSync';
import { fetchPlanzer } from '@carriers/carriers/planzer/adapter';

// Minimal reproduction of a real Quickpac response checked on 2026-09-06.
// Keep its actual timestamps/labels, but replace the private shipment identifier.
const TRACKING_NUMBER = '440000000000000001';
const POSITION_EVENTS = [
  { createdAt: '2026-08-31T04:07:09.0303905', text: { english: 'Recorded' } },
  { createdAt: '2026-08-31T18:22:27.8650442', text: { english: 'Transferred' } },
  { createdAt: '2026-09-01T06:05:03.8117395', text: { english: 'In delivery' } },
  {
    createdAt: '2026-09-01T14:07:10.258',
    text: { english: 'Shipped', french: 'Livré', german: 'Zugestellt' },
  },
];

function payload(overall = 'Shipment delivered', events = POSITION_EVENTS) {
  return {
    overallStatus: { text: { english: overall } },
    transportPositions: [{ positionNumber: TRACKING_NUMBER, positionEvents: events }],
  };
}

function response(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Quickpac / Planzer historical event stages', () => {
  it.each(['quickpac', 'planzer'])('preserves the real four-step timeline for %s', async (carrier) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(payload()));

    const result = await fetchPlanzer(TRACKING_NUMBER);
    expect(result.status).toBe('delivered');
    const rows = buildEvents({ id: 'parcel', carrier, current_stage: 'pending' }, result)
      .reverse();
    expect(rows.map(({ description, stage, occurred_at }) => ({ description, stage, occurred_at })))
      .toEqual([
        { description: 'Recorded', stage: 'registered', occurred_at: '2026-08-31T02:07:09.030Z' },
        { description: 'Transferred', stage: 'in_transit', occurred_at: '2026-08-31T16:22:27.865Z' },
        { description: 'In delivery', stage: 'out_for_delivery', occurred_at: '2026-09-01T04:05:03.811Z' },
        // Planzer's English "Shipped" is its label for "Zugestellt".
        { description: 'Delivered', stage: 'delivered', occurred_at: '2026-09-01T12:07:10.258Z' },
      ]);
    // Stages must not change identity, otherwise re-sync would duplicate old rows.
    expect(rows.map((row) => row.provider_event_id)).toEqual(POSITION_EVENTS.map((event, index) => (
      providerEventId(carrier, event.createdAt, '', String(rows[index].description))
    )));
    // The provider payload is preserved verbatim next to the recorded stage source.
    expect(rows.map((row) => row.raw_data)).toEqual([...result.events!].reverse()
      .map((event) => ({ ...event, stage_source: 'carrier_map' })));
  });

  it('pins the identities the saved-row relabel migration derives in SQL', () => {
    // supabase/tests/planzer_delivered_wording.sql expects the same values from
    // 20260925100000_relabel_planzer_delivered_events.sql.
    expect(providerEventId('quickpac', '2026-09-01T14:07:10.258', '', 'Shipped'))
      .toBe('quickpac:e4db6ac35959c7a682393acf8c1cd1dca04dcf11c375921ecd1fbb1d223bb8f2');
    expect(providerEventId('quickpac', '2026-09-01T14:07:10.258', '', 'Delivered'))
      .toBe('quickpac:b37df0b80f5390316ccd97ea0dd53dc7660d87429f4cb6c62a6b563f5b5fd7b1');
  });

  it('keeps historical stages and identities stable as the shipment progresses', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(payload('Shipment on the way', POSITION_EVENTS.slice(0, 2))))
      .mockResolvedValueOnce(response(payload()));
    const parcel = { id: 'parcel', carrier: 'quickpac' };
    const before = buildEvents(parcel, await fetchPlanzer(TRACKING_NUMBER));
    const after = buildEvents(parcel, await fetchPlanzer(TRACKING_NUMBER));
    expect(after.slice(2)).toEqual(before);
  });

  it.each<[string, string, string?]>([
    ['Recorded', 'registered'],
    ['Transferred', 'in_transit'],
    ['Shipment on the way', 'in_transit'],
    ['In delivery', 'out_for_delivery'],
    ['Shipment out for delivery', 'out_for_delivery'],
    ['Delivered', 'delivered'],
    ['Shipment delivered', 'delivered'],
    ['Shipped', 'delivered', 'Delivered'],
    ['Not delivered', 'failed_attempt'],
  ])('maps %s independently of the final delivered summary', async (label, stage, description = label) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(payload('Shipment delivered', [{
      createdAt: '2026-09-01T12:00:00Z', text: { english: label },
    }])));
    expect((await fetchPlanzer(TRACKING_NUMBER)).events).toEqual([{
      time: '2026-09-01T12:00:00Z', location: '', description, stage,
    }]);
  });

  it('surfaces unfamiliar statuses as a privacy-safe error instead of a false delivery', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(payload('Shipment delivered', [{
      createdAt: '2026-09-01T12:00:00Z', text: { english: 'New status with private details' },
    }])));
    await expect(fetchPlanzer(TRACKING_NUMBER)).rejects.toThrow('Planzer returned an unrecognized tracking event status');
  });
});
