import { describe, expect, it } from 'vitest';
import { lateScans, relayCopies, relayRepeats } from './relayCopies';

/** A stored scan: its id, the carrier that stored it, its stage, when it happened and when a check stored it. */
const scan = (id: string, source: string, stage: string, occurred_at: string, created_at = '2026-09-10T08:00:00Z') => ({
  id, stage, occurred_at, created_at, provider_event_id: `${source}:${id}`,
});

/** A parcel DHL handed over to Swiss Post. */
const handedOver = (tracking_events: object[]) => ({
  carrier: 'dhl', carrier_data: { original_carrier: 'dhl', active_tracking_carrier: 'swiss-post' }, tracking_events,
});

describe('relayCopies', () => {
  it('pairs each scan the earlier carrier tells again with the new carrier\'s, at the same stage within a minute', () => {
    expect(relayCopies(handedOver([
      // DHL drops the seconds of Swiss Post's scans.
      scan('arrived', 'swiss-post', 'in_transit', '2026-09-09T14:16:51Z'),
      scan('arrived-copy', 'dhl', 'in_transit', '2026-09-09T14:16:00Z'),
      scan('customs', 'swiss-post', 'customs', '2026-09-09T14:18:51Z'),
      scan('customs-copy', 'dhl', 'customs', '2026-09-09T14:18:00Z'),
      // Chronopost tells DPD's scans after them, and a whole minute counts.
      scan('round', 'swiss-post', 'out_for_delivery', '2026-09-10T06:15:00Z'),
      scan('round-copy', 'dhl', 'out_for_delivery', '2026-09-10T06:16:00Z'),
      scan('app', 'app', 'pending', '2026-09-09T14:16:30Z'),
    ]))).toEqual(new Map([['arrived-copy', 'arrived'], ['customs-copy', 'customs'], ['round-copy', 'round']]));
  });

  it('leaves a scan of another stage, or more than a minute away, on its own', () => {
    expect(relayCopies(handedOver([
      scan('customs', 'swiss-post', 'customs', '2026-09-09T13:15:11Z'),
      scan('exchange', 'dhl', 'in_transit', '2026-09-09T13:15:00Z'),
      scan('sorted', 'swiss-post', 'in_transit', '2026-09-09T15:42:29Z'),
      scan('later', 'dhl', 'in_transit', '2026-09-09T15:43:30Z'),
      // Nor are two scans of the new carrier, or of the earlier one, a pair.
      scan('sorted-again', 'swiss-post', 'in_transit', '2026-09-09T15:42:20Z'),
      scan('later-again', 'dhl', 'in_transit', '2026-09-09T15:43:31Z'),
    ]))).toEqual(new Map());
  });

  it('makes the closest pairs first, and one scan pairs once', () => {
    // Two Swiss Post scans of one minute that DHL tells once stay two rows.
    expect(relayCopies(handedOver([
      scan('first', 'swiss-post', 'in_transit', '2026-09-09T15:40:38Z'),
      scan('second', 'swiss-post', 'in_transit', '2026-09-09T15:40:53Z'),
      scan('copy', 'dhl', 'in_transit', '2026-09-09T15:40:00Z'),
    ]))).toEqual(new Map([['copy', 'first']]));
    // Three scans of a minute against two: each takes its closest free partner.
    expect(relayCopies(handedOver([
      scan('a', 'dhl', 'in_transit', '2026-09-09T07:48:00Z'),
      scan('b', 'dhl', 'in_transit', '2026-09-09T07:48:00Z'),
      scan('c', 'dhl', 'in_transit', '2026-09-09T07:48:00Z'),
      scan('arrival', 'swiss-post', 'in_transit', '2026-09-09T07:47:00Z'),
      scan('border', 'swiss-post', 'in_transit', '2026-09-09T07:48:00Z'),
    ]))).toEqual(new Map([['a', 'border'], ['b', 'arrival']]));
  });

  it('pairs with a universal provider\'s row of the new leg, and only in a parcel that was handed over', () => {
    const rows = [
      scan('in-france', 'unknown', 'in_transit', '2026-10-06T05:18:36Z'),
      scan('exchange', 'india-post', 'in_transit', '2026-10-06T05:18:00Z'),
    ];
    const indiaPost = (data: object) => ({ carrier: 'india-post', carrier_data: data, tracking_events: rows });
    expect(relayCopies(indiaPost({ original_carrier: 'india-post', active_tracking_carrier: 'la-poste' })))
      .toEqual(new Map([['exchange', 'in-france']]));
    // Two legs merged into one parcel name the earlier carrier without an active one.
    expect(relayCopies({ ...indiaPost({ original_carrier: 'india-post' }), carrier: 'la-poste' }))
      .toEqual(new Map([['exchange', 'in-france']]));
    expect(relayCopies(indiaPost({}))).toEqual(new Map());
    expect(relayCopies(indiaPost({ original_carrier: 'india-post', active_tracking_carrier: 'india-post' }))).toEqual(new Map());
    expect(relayCopies({ carrier_data: { original_carrier: 'india-post' } })).toEqual(new Map());
  });
});

describe('relayRepeats', () => {
  it('names the row of each pair that reached the parcel second, and the copy of a pair stored together', () => {
    expect(relayRepeats(handedOver([
      // DHL told it first; Swiss Post's history came with the handover.
      scan('arrived-copy', 'dhl', 'in_transit', '2026-09-09T14:16:00Z', '2026-09-09T15:30:01Z'),
      scan('arrived', 'swiss-post', 'in_transit', '2026-09-09T14:16:51Z', '2026-09-10T08:00:05Z'),
      // Swiss Post told it first; DHL's copy came with a later check.
      scan('depot', 'swiss-post', 'in_transit', '2026-09-10T04:44:36Z', '2026-09-10T05:00:00Z'),
      scan('depot-copy', 'dhl', 'in_transit', '2026-09-10T04:44:00Z', '2026-09-10T06:00:03Z'),
      // One check stored both.
      scan('delivered', 'swiss-post', 'delivered', '2026-09-10T10:08:49Z', '2026-09-10T10:24:02Z'),
      scan('delivered-copy', 'dhl', 'delivered', '2026-09-10T10:08:00Z', '2026-09-10T10:24:02Z'),
      scan('alone', 'swiss-post', 'in_transit', '2026-09-09T20:00:00Z', '2026-09-10T08:00:05Z'),
    ]))).toEqual(new Set(['arrived', 'depot-copy', 'delivered-copy']));
  });
});

describe('lateScans', () => {
  it('names the earlier carrier\'s scans that reached the parcel after a later one was stored', () => {
    // A parcel Chronopost handed over to DPD Germany, then told a scan of its own late.
    const chronopost = (data: object, tracking_events: object[]) => ({ carrier: 'chronopost', carrier_data: data, tracking_events });
    const handoff = { original_carrier: 'chronopost', active_tracking_carrier: 'dpd-de' };
    const rows = [
      // The handoff's check stored both histories, older scans with newer ones.
      scan('sorted', 'chronopost', 'in_transit', '2026-10-08T09:00:00Z', '2026-10-08T14:30:00Z'),
      scan('received', 'dpd-de', 'in_transit', '2026-10-08T14:24:00Z', '2026-10-08T14:30:00Z'),
      scan('late', 'chronopost', 'in_transit', '2026-10-08T14:12:00Z', '2026-10-08T15:25:00Z'),
      // Newer than anything stored before it, and Peek's own rows date no scan.
      scan('added', 'app', 'pending', '2026-10-08T14:50:00Z', '2026-10-08T14:50:00Z'),
      scan('newer', 'chronopost', 'in_transit', '2026-10-08T14:40:00Z', '2026-10-08T15:25:00Z'),
      // The new carrier's own scans are never late.
      scan('depot', 'dpd-de', 'in_transit', '2026-10-08T14:20:00Z', '2026-10-08T16:25:00Z'),
    ];
    expect(lateScans(chronopost(handoff, rows))).toEqual(new Set(['late']));
    expect(lateScans(chronopost({}, rows))).toEqual(new Set());
    expect(lateScans({ carrier_data: handoff })).toEqual(new Set());
  });
});
