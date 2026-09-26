import { describe, expect, it } from 'vitest';
import { sameInstantIdentities, withIdentities } from './eventIdentity';

// New events carry the sync's ISO spelling; stored rows come back from
// PostgREST with an explicit +00:00 offset. Both name the same instant.
const scan = (id: string, occurredAt: string, description = 'Scan') => ({
  package_id: 'package-1', provider_event_id: id, occurred_at: occurredAt, description,
});
const row = (id: string, occurredAt: string) => ({ provider_event_id: id, occurred_at: occurredAt });

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
