import { describe, expect, it } from 'vitest';
import { sameInstantIdentities, sharedScans, withIdentities } from './eventIdentity';

// New events carry the sync's ISO spelling; stored rows come back from
// PostgREST with an explicit +00:00 offset. Both name the same instant.
const scan = (id: string, occurredAt: string, description = 'Scan', stage?: string) => ({
  package_id: 'package-1', provider_event_id: id, occurred_at: occurredAt, description, ...(stage ? { stage } : {}),
});
const row = (id: string, occurredAt: string, description?: string, stage?: string) => ({
  provider_event_id: id, occurred_at: occurredAt,
  ...(description === undefined ? {} : { description }), ...(stage ? { stage } : {}),
});
const pairs = (map: ReadonlyMap<string, string>) => [...map].sort(([left], [right]) => left.localeCompare(right));

describe('same-instant identity reuse', () => {
  it('gives each reworded scan the one stored identity at its instant', () => {
    const stored = [
      row('dpd:unverified-delivered', '2026-07-16T08:12:00+00:00'),
      row('dpd:unverified-out', '2026-07-16T04:10:45+00:00'),
    ];
    const events = [
      scan('dpd:verified-delivered', '2026-07-16T08:12:00Z', 'Your parcel has been delivered successfully'),
      scan('dpd:verified-out', '2026-07-16T04:10:45Z', 'Your parcel is out for delivery'),
      // Only the verified reply lists the customs scan: nothing to take over.
      scan('dpd:verified-customs', '2026-07-15T14:30:00Z', 'Your parcel cleared customs successfully'),
    ];

    const reused = sameInstantIdentities(events, stored, 'dpd');

    expect([...reused]).toEqual([
      ['dpd:verified-delivered', 'dpd:unverified-delivered'],
      ['dpd:verified-out', 'dpd:unverified-out'],
    ]);
    expect(withIdentities(events, reused).map((event) => event.provider_event_id)).toEqual([
      'dpd:unverified-delivered', 'dpd:unverified-out', 'dpd:verified-customs',
    ]);
    // The computed events are left as they were.
    expect(events[0]?.provider_event_id).toBe('dpd:verified-delivered');
  });

  it('takes over a universal provider copy of the same scan', () => {
    expect([...sameInstantIdentities(
      [scan('dpd:delivered', '2026-07-16T08:12:00Z')],
      [row('unknown:ship24-delivered', '2026-07-16T08:12:00+00:00')],
      'dpd',
    )]).toEqual([['dpd:delivered', 'unknown:ship24-delivered']]);
  });

  it('reuses nothing when an instant has several candidates or several new scans', () => {
    const instant = '2026-07-16T08:12:00Z';
    expect(sameInstantIdentities(
      [scan('dpd:new', instant)],
      [row('dpd:unverified', instant), row('unknown:universal', instant)],
      'dpd',
    ).size).toBe(0);
    expect(sameInstantIdentities(
      [scan('dpd:new-a', instant), scan('dpd:new-b', instant)],
      [row('dpd:unverified', instant)],
      'dpd',
    ).size).toBe(0);
    // A scan listed twice is two new scans at one instant, never one identity twice.
    expect(sameInstantIdentities(
      [scan('dpd:twice', instant), scan('dpd:twice', instant)],
      [row('dpd:unverified', instant)],
      'dpd',
    ).size).toBe(0);
  });

  it('never takes over another carrier or the app', () => {
    const instant = '2026-07-16T08:12:00Z';
    const others = [row('swiss-post:scan', instant), row('app:registered', instant), row('dpd-fr:scan', instant)];
    expect(sameInstantIdentities([scan('dpd:new', instant)], others, 'dpd').size).toBe(0);
    // They are not candidates, so they do not make a DPD candidate ambiguous either.
    expect([...sameInstantIdentities([scan('dpd:new', instant)], [...others, row('dpd:old', instant)], 'dpd')])
      .toEqual([['dpd:new', 'dpd:old']]);
    // Another carrier's scan in a merged batch never takes a DPD identity.
    expect(sameInstantIdentities([scan('dhl:origin', instant)], [row('dpd:old', instant)], 'dpd').size).toBe(0);
  });

  it('only applies to a source that opted in', () => {
    const instant = '2026-07-16T08:12:00Z';
    for (const source of ['unknown', 'gls-ch', 'swiss-post']) {
      expect(sameInstantIdentities(
        [scan(`${source}:new`, instant)],
        [row(`${source}:old`, instant), row('dpd:old', instant)],
        source,
      ).size).toBe(0);
    }
  });

  it('keeps an identity that is already stored and never hands it to another scan', () => {
    const instant = '2026-07-16T08:12:00Z';
    const stored = [row('dpd:same', instant), row('unknown:universal', '2026-07-16T04:10:45Z')];
    // The scan whose identity is stored keeps it; the new scan beside it
    // finds no unclaimed candidate at that instant.
    expect(sameInstantIdentities(
      [scan('dpd:same', instant), scan('dpd:reworded', instant)],
      stored,
      'dpd',
    ).size).toBe(0);
    // A stored identity another event of the batch carries is not free, even
    // when that event sits at another instant.
    expect(sameInstantIdentities(
      [scan('dpd:reworded', '2026-07-16T04:10:45Z'), scan('unknown:universal', '2026-07-16T09:00:00Z')],
      stored,
      'dpd',
    ).size).toBe(0);
  });

  it('matches the exact instant only', () => {
    const stored = [row('dpd:unverified', '2026-07-16T08:12:00+00:00')];
    for (const occurredAt of ['2026-07-16T08:12:01Z', '2026-07-16T08:12:00.001Z', '2026-07-16T10:12:00Z', 'not a time']) {
      expect(sameInstantIdentities([scan('dpd:new', occurredAt)], stored, 'dpd').size).toBe(0);
    }
    expect(sameInstantIdentities([scan('dpd:new', '2026-07-16T10:12:00+02:00')], stored, 'dpd').size).toBe(1);
  });
});

describe('scans a carrier and a universal provider both report', () => {
  // A carrier's Eastern scans, stored from its own lookup.
  const carrier = [
    row('gofo:delivered', '2026-01-04T21:58:30+00:00', 'Delivered'),
    row('gofo:out', '2026-01-04T12:59:03+00:00', 'Out for Delivery'),
    row('gofo:label', '2026-01-02T12:30:00+00:00', 'Shipping Label Created', 'registered'),
  ];

  it('leaves out a universal copy at the same instant or read in the wrong zone', () => {
    const shared = sharedScans([
      // Pacific offsets on Eastern clocks put these three hours late.
      scan('unknown:delivered', '2026-01-05T00:58:30Z', 'Delivered'),
      scan('unknown:out', '2026-01-04T15:59:03Z', 'OUT FOR  delivery'),
      scan('unknown:label', '2026-01-02T12:30:00Z', 'Label created', 'registered'),
      scan('unknown:exception', '2026-01-03T21:10:00Z', 'Delivery Exception, Business Closed.'),
    ], carrier);

    expect(pairs(shared.skipped)).toEqual([
      ['unknown:delivered', 'gofo:delivered'], ['unknown:label', 'gofo:label'], ['unknown:out', 'gofo:out'],
    ]);
    expect(shared.reused.size).toBe(0);
  });

  it('lets the carrier take over the universal copy stored while its lookup was down', () => {
    const stored = [
      ...carrier.slice(2),
      row('unknown:out', '2026-01-04T15:59:03+00:00', 'Out for Delivery'),
      row('unknown:exception', '2026-01-03T23:10:00+00:00',
        'Delivery Exception, Business Closed. For Delivery Issues & Tracking Support, Contact GOFO at +1 000 000-0000 or support@example.com'),
    ];
    const events = [
      scan('gofo:out', '2026-01-04T12:59:03Z', 'Out for Delivery'),
      scan('gofo:exception', '2026-01-03T21:10:00Z', 'Delivery Exception, Business Closed.'),
      scan('gofo:label', '2026-01-02T12:30:00Z', 'Shipping Label Created'),
    ];
    const shared = sharedScans(events, stored);

    expect(pairs(shared.reused)).toEqual([['gofo:exception', 'unknown:exception'], ['gofo:out', 'unknown:out']]);
    expect(shared.skipped.size).toBe(0);
    expect(withIdentities(events, shared.reused).map((event) => event.provider_event_id))
      .toEqual(['unknown:out', 'unknown:exception', 'gofo:label']);
    // A carrier never takes over another carrier's row.
    expect(sharedScans([scan('dhl:out', '2026-01-04T12:59:03Z', 'Out for Delivery')], carrier).reused.size).toBe(0);
  });

  it('never lets a universal reply move a row a carrier corrected, but lets it reword the row in place', () => {
    const corrected = [row('unknown:out', '2026-01-04T12:59:03+00:00', 'Out for Delivery')];
    expect(pairs(sharedScans([scan('unknown:out', '2026-01-04T15:59:03Z', 'Out for Delivery')], corrected).skipped))
      .toEqual([['unknown:out', 'unknown:out']]);
    const sameInstant = sharedScans([scan('unknown:out', '2026-01-04T12:59:03Z', 'With delivery courier')], corrected);
    expect(sameInstant.skipped.size + sameInstant.reused.size).toBe(0);
    // A carrier's scan whose own identity is stored is left to the upsert.
    const own = sharedScans([scan('gofo:out', '2026-01-04T12:59:03Z', 'Out for Delivery')], [row('gofo:out', '2026-01-04T12:59:03+00:00', 'Out for Delivery')]);
    expect(own.skipped.size + own.reused.size).toBe(0);
  });

  it('matches whole quarter hours up to 14 hours away, with the same wording only', () => {
    const stored = [row('gofo:out', '2026-01-04T12:00:00+00:00', 'Out for Delivery')];
    const skipped = (occurredAt: string, description = 'Out for Delivery') => sharedScans(
      [scan('unknown:out', occurredAt, description)], stored,
    ).skipped.size;
    for (const occurredAt of ['2026-01-04T12:45:00Z', '2026-01-04T17:30:00Z', '2026-01-05T02:00:00Z', '2026-01-03T22:00:00Z']) {
      expect(skipped(occurredAt), occurredAt).toBe(1);
    }
    for (const occurredAt of ['2026-01-04T13:00:01Z', '2026-01-04T12:20:00Z', '2026-01-05T02:15:00Z', '2026-01-03T21:45:00Z', 'not a time']) {
      expect(skipped(occurredAt), occurredAt).toBe(0);
    }
    for (const description of ['Out for delivery today', 'Delivered', '']) expect(skipped('2026-01-04T15:00:00Z', description)).toBe(0);
    // A trailing sentence counts only after a finished one.
    expect(sharedScans([scan('unknown:x', '2026-01-04T15:00:00Z', 'Out for Delivery. Call us')],
      [row('gofo:x', '2026-01-04T12:00:00+00:00', 'Out for Delivery.')]).skipped.size).toBe(1);
  });

  it('matches other wording at the same instant only within one stage', () => {
    const skipped = (stage?: string) => sharedScans(
      [scan('unknown:label', '2026-01-02T12:30:00Z', 'Label created', stage)], carrier,
    ).skipped.size;
    expect(skipped('registered')).toBe(1);
    // Another scan the carrier did not report, at the same second, is kept.
    expect(skipped('in_transit')).toBe(0);
    expect(skipped()).toBe(0);
  });

  it('keeps ambiguous scans and rows unmatched', () => {
    const instant = '2026-01-04T12:00:00Z';
    // Two rows at the instant, neither worded alike.
    expect(sharedScans([scan('unknown:a', instant, 'Scan')],
      [row('gofo:a', instant, 'Sorted'), row('gofo:b', instant, 'Loaded')]).skipped.size).toBe(0);
    // One row, two new scans: only the one worded alike matches.
    expect(pairs(sharedScans([scan('unknown:a', instant, 'Loaded'), scan('unknown:b', instant, 'Sorted')],
      [row('gofo:a', instant, 'Loaded')]).skipped)).toEqual([['unknown:a', 'gofo:a']]);
    expect(sharedScans([scan('unknown:a', instant, 'Arrived'), scan('unknown:b', instant, 'Sorted')],
      [row('gofo:a', instant, 'Loaded')]).skipped.size).toBe(0);
    // Two shifted rows worded alike, or two scans for one row.
    expect(sharedScans([scan('unknown:a', '2026-01-04T15:00:00Z', 'Loaded')],
      [row('gofo:a', '2026-01-04T13:00:00+00:00', 'Loaded'), row('gofo:b', '2026-01-04T14:00:00+00:00', 'Loaded')]).skipped.size).toBe(0);
    expect(sharedScans([scan('unknown:a', '2026-01-04T15:00:00Z', 'Loaded'), scan('unknown:b', '2026-01-04T16:00:00Z', 'Loaded')],
      [row('gofo:a', '2026-01-04T13:00:00+00:00', 'Loaded')]).skipped.size).toBe(0);
  });

  it('never matches the app, rows this batch carries or took over, or observed transitions', () => {
    const instant = '2026-01-04T12:00:00Z';
    expect(sharedScans([scan('unknown:a', instant, 'Registered')], [row('app:registered', instant, 'Registered')]).skipped.size).toBe(0);
    // The row the batch already carries is not a copy's twin.
    expect(sharedScans([scan('unknown:a', instant, 'Loaded'), scan('gofo:a', '2026-01-04T09:00:00Z', 'Loaded')],
      [row('gofo:a', '2026-01-04T09:00:00+00:00', 'Loaded')]).skipped.size).toBe(0);
    // A row DPD's own rule took over is not offered again.
    expect(sharedScans([scan('dpd:b', instant, 'Delivered')], [row('unknown:a', instant, 'Delivered')],
      new Map([['dpd:a', 'unknown:a']])).reused.size).toBe(0);
    const observed = { ...scan('unknown:observed', instant, 'Delivered'), raw_data: { observed_without_provider_timestamp: true } };
    expect(sharedScans([observed], [row('gofo:delivered', instant, 'Delivered')]).skipped.size).toBe(0);
    expect(sharedScans([scan('unknown:a', instant, 'Delivered')], []).skipped.size).toBe(0);
  });
});
