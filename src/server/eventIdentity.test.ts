import { describe, expect, it, vi } from 'vitest';
import { restatedIdentities, sameInstantIdentities, sharedScans, withIdentities, withoutCopyDrift } from './eventIdentity';

// India Post's policy names the zone it once read every clock in from the next scraper release;
// until the app takes that version, its tests add the zone themselves.
vi.mock('universal-parcel-scraper/app', async (importOriginal) => {
  const scraper = await importOriginal<typeof import('universal-parcel-scraper/app')>();
  return { ...scraper, sameInstantIdentityPolicy: (...args: Parameters<typeof scraper.sameInstantIdentityPolicy>) => {
    const policy = scraper.sameInstantIdentityPolicy(...args);
    return args[0] === 'india-post' && policy ? { relabelledFrom: 'Asia/Kolkata', ...policy } : policy;
  } };
});

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
  it.each(['unknown', 'swiss-post'])('enriches distinct %s scans sharing an instant without duplicating their identities', (source) => {
    const at = '2026-07-11T18:05:00Z';
    const saved = ['Arrived at sorting centre', 'Departed sorting centre'].map((description, i) => ({
      ...row(`${source}:old-${i}`, at, description, 'in_transit'), location: null,
      raw_data: { provider_code: `SCAN-${i}` },
    }));
    const incoming = saved.map((item, i) => ({
      ...item, provider_event_id: `${source}:located-${i}`, location: 'Example City, France',
    }));
    const expected = incoming.map((item, i) => [item.provider_event_id, saved[i]!.provider_event_id]);
    expect([...sameInstantIdentities(incoming, saved, source)]).toEqual(expected);
    expect([...sameInstantIdentities(incoming, saved.map((item) => ({ ...item, location: 'Example City, France' })), source)])
      .toEqual(expected);
    expect(sameInstantIdentities([incoming[0]!], [saved[0]!, { ...saved[0]!, provider_event_id: `${source}:duplicate` }], source).size)
      .toBe(0);
    expect(sameInstantIdentities([incoming[0]!, { ...incoming[0]!, provider_event_id: `${source}:duplicate` }], [saved[0]!], source).size)
      .toBe(0);
    for (const different of [
      { ...saved[0]!, stage: 'out_for_delivery' },
      { ...saved[0]!, location: 'Another City, France' },
      { ...saved[0]!, observed_without_provider_timestamp: true },
    ]) expect(sameInstantIdentities([incoming[0]!], [different], source).size).toBe(0);
    if (source === 'swiss-post') {
      expect(sameInstantIdentities([incoming[0]!], [{ ...saved[0]!, raw_data: { provider_code: 'OTHER' } }], source).size).toBe(0);
    }
  });

  it('updates a UPS scan when its location is filled in', () => {
    const at = '2026-07-11T18:05:00Z';
    const saved = { ...row('ups:without-location', at, 'Package collected', 'accepted'), location: null };
    const incoming = { ...scan('ups:with-location', at, 'Package collected', 'accepted'), location: 'Example City, France' };
    expect([...sameInstantIdentities([incoming], [saved], 'ups')])
      .toEqual([['ups:with-location', 'ups:without-location']]);
    for (const different of [
      { ...saved, description: 'Package departed' },
      { ...saved, stage: 'in_transit' },
      { ...saved, location: 'Another City, France' },
      { ...saved, observed_without_provider_timestamp: true },
      { ...saved, provider_event_id: 'unknown:without-location' },
    ]) expect(sameInstantIdentities([incoming], [different], 'ups').size).toBe(0);
    expect(sameInstantIdentities([incoming], [saved, { ...saved, provider_event_id: 'ups:another' }], 'ups').size).toBe(0);
    expect(sameInstantIdentities([incoming, { ...incoming, provider_event_id: 'ups:departure', description: 'Package departed' }],
      [saved], 'ups').size).toBe(0);
  });

  it('updates a reworded coded scan without changing its saved identity', () => {
    const at = '2026-07-11T18:05:00Z';
    const incoming = { ...scan('india-post:flight-details', at, 'Flight ZZ0101 departed: FRA → CDG'),
      raw_data: { provider_code: 'AircraftTakeOff' } };
    const saved = { ...row('india-post:uplift', at, 'UPLIFT'), provider_code: 'AircraftTakeOff' };
    expect([...sameInstantIdentities([incoming], [saved], 'india-post')])
      .toEqual([['india-post:flight-details', 'india-post:uplift']]);
    for (const code of ['ItemReceived', '', undefined]) {
      expect(sameInstantIdentities([incoming], [{ ...saved, provider_code: code }], 'india-post').size).toBe(0);
    }
    expect(sameInstantIdentities([incoming], [saved, { ...saved, provider_event_id: 'india-post:another' }], 'india-post').size).toBe(0);
    expect(sameInstantIdentities([incoming], [{ ...saved, provider_event_id: 'other:flight' }], 'india-post').size).toBe(0);
    expect(sameInstantIdentities([{ ...incoming, raw_data: { provider_code: 'Unknown' } }],
      [{ ...saved, provider_code: 'Unknown' }], 'india-post').size).toBe(0);
  });

  it('matches reworded scans sharing an instant by their unique provider codes', () => {
    const at = '2026-07-11T18:05:00Z';
    const saved = [
      { ...row('india-post:arrival', at, 'Arrived at sorting centre'), location: 'Example Office 000000', provider_code: 'MailArrived' },
      { ...row('india-post:receipt', at, 'Item received'), location: 'Example Office 000000', provider_code: 'ItemReceived' },
    ];
    const incoming = saved.map(({ provider_code, ...item }) => ({ ...item, provider_event_id: `${item.provider_event_id}-located`,
      location: 'Example Office 000001', raw_data: { provider_code } }));
    expect(pairs(sameInstantIdentities(incoming, saved, 'india-post'))).toEqual([
      ['india-post:arrival-located', 'india-post:arrival'],
      ['india-post:receipt-located', 'india-post:receipt'],
    ]);
    // An unchanged scan in the batch does not prevent the other code's reuse.
    expect([...sameInstantIdentities([incoming[0]!, saved[1]!], saved, 'india-post')])
      .toEqual([['india-post:arrival-located', 'india-post:arrival']]);
    expect([...sameInstantIdentities([incoming[0]!], saved, 'india-post')])
      .toEqual([['india-post:arrival-located', 'india-post:arrival']]);
    // Repeated codes at one instant are still ambiguous in either direction.
    expect([...sameInstantIdentities(incoming, [...saved, { ...saved[0]!, provider_event_id: 'india-post:another-arrival' }], 'india-post')])
      .toEqual([['india-post:receipt-located', 'india-post:receipt']]);
    expect([...sameInstantIdentities([...incoming, { ...incoming[0]!, provider_event_id: 'india-post:another-new-arrival' }], saved, 'india-post')])
      .toEqual([['india-post:receipt-located', 'india-post:receipt']]);
    for (const code of ['', 'Unknown', 'OtherCode']) {
      const changed = [{ ...incoming[0]!, raw_data: { provider_code: code } }, incoming[1]!];
      expect(sameInstantIdentities(changed, saved, 'india-post').has('india-post:arrival-located')).toBe(false);
    }
  });
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

  it('does not reuse an observation as a carrier scan identity', () => {
    const instant = '2026-07-16T08:12:00Z';
    const observed = { ...row('dpd:observed', instant, 'Delivered'),
      raw_data: { observed_without_provider_timestamp: true } };
    expect(sameInstantIdentities([scan('dpd:dated', instant, 'Delivered')], [observed], 'dpd').size).toBe(0);
    const incomingObservation = { ...scan('dpd:observed', instant, 'Delivered'),
      raw_data: { observed_without_provider_timestamp: true } };
    expect(sameInstantIdentities([incomingObservation], [row('dpd:dated', instant, 'Delivered')], 'dpd').size).toBe(0);
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

describe('scans a source once read on one zone\'s clock', () => {
  // La Poste's 07:50 in Paris, relayed by India Post as India's 07:50 (02:20 UTC).
  const location = 'EXAMPLE EXCHANGE OFFICE 999001';
  const labelled = { provider_event_id: 'india-post:labelled', occurred_at: '2026-07-14T02:20:00+00:00',
    time: '2026-07-14T02:20:00Z', stage: 'in_transit', description: 'Item Received', location, provider_code: 'ItemReceived' };
  const abroad = { package_id: 'package-1', provider_event_id: 'india-post:abroad', occurred_at: '2026-07-14T05:50:00.000Z',
    stage: 'in_transit', description: 'Item received at office of exchange (Inb)', location,
    raw_data: { time: '2026-07-14T07:50:00+02:00', provider_code: 'ItemReceived' } };
  // The same scan stored on its own clock, and a reply that reads it as labelled again.
  const own = { ...labelled, provider_event_id: 'india-post:own', occurred_at: '2026-07-14T05:50:00+00:00', time: '2026-07-14T07:50:00+02:00' };
  const relabelled = { ...abroad, provider_event_id: 'india-post:relabelled', occurred_at: '2026-07-14T02:20:00.000Z',
    raw_data: { time: '2026-07-14T02:20:00Z', provider_code: 'ItemReceived' } };

  it('moves the stored row to the scan\'s own clock in place, and back, whatever the wording', () => {
    expect([...sameInstantIdentities([abroad], [labelled], 'india-post')]).toEqual([['india-post:abroad', 'india-post:labelled']]);
    expect([...sameInstantIdentities([relabelled], [own], 'india-post')]).toEqual([['india-post:relabelled', 'india-post:own']]);
    // A stored row without its time string is read as labelled.
    expect(sameInstantIdentities([abroad], [{ ...labelled, time: undefined }], 'india-post').size).toBe(1);
    // Under a zero offset of its own too.
    const london = { ...abroad, occurred_at: '2026-07-14T07:50:00.000Z', raw_data: { ...abroad.raw_data, time: '2026-07-14T07:50:00+00:00' } };
    expect(sameInstantIdentities([london], [labelled], 'india-post').size).toBe(1);
  });

  it('needs the same provider code, location and wall clock, and a row no scan of the batch carries', () => {
    for (const different of [
      { ...labelled, provider_code: 'ItemDispatched' },
      { ...labelled, provider_code: undefined },
      { ...labelled, location: 'ANOTHER EXCHANGE OFFICE 999001' },
      { ...labelled, occurred_at: '2026-07-14T02:21:00+00:00', time: '2026-07-14T02:21:00Z' },
      { ...labelled, observed_without_provider_timestamp: true },
      { ...labelled, provider_event_id: 'unknown:labelled' },
    ]) expect(sameInstantIdentities([abroad], [different], 'india-post').size).toBe(0);
    const unknownCode = { ...abroad, raw_data: { ...abroad.raw_data, provider_code: 'Unknown' } };
    expect(sameInstantIdentities([unknownCode], [{ ...labelled, provider_code: 'Unknown' }], 'india-post').size).toBe(0);
    expect(sameInstantIdentities([abroad, { ...labelled, package_id: 'package-1' }], [labelled], 'india-post').size).toBe(0);
    // Two scans both labelled, 5 h 30 apart, are two scans.
    const later = { ...relabelled, provider_event_id: 'india-post:later', occurred_at: '2026-07-14T07:50:00.000Z',
      raw_data: { time: '2026-07-14T07:50:00Z', provider_code: 'ItemReceived' } };
    expect(sameInstantIdentities([later], [labelled], 'india-post').size).toBe(0);
    // An offset that is the zone's own is a label.
    const indian = { ...abroad, occurred_at: '2026-07-14T02:20:00.000Z', raw_data: { ...abroad.raw_data, time: '2026-07-14T07:50:00+05:30' } };
    expect(sameInstantIdentities([indian], [{ ...labelled, occurred_at: '2026-07-13T20:50:00+00:00', time: '2026-07-13T20:50:00Z' }], 'india-post').size).toBe(0);
  });

  it('keeps ambiguous scans and rows unmatched, and other sources out', () => {
    expect(sameInstantIdentities([abroad], [labelled, { ...labelled, provider_event_id: 'india-post:twin' }], 'india-post').size).toBe(0);
    expect(sameInstantIdentities([abroad, { ...abroad, provider_event_id: 'india-post:twin' }], [labelled], 'india-post').size).toBe(0);
    const dpd = (row: Record<string, unknown>) => ({ ...row, provider_event_id: String(row.provider_event_id).replace('india-post', 'dpd') });
    expect(sameInstantIdentities([dpd(abroad)], [dpd(labelled)], 'dpd').size).toBe(0);
  });

  it('leaves the same-instant match first', () => {
    expect([...sameInstantIdentities([abroad], [labelled, own], 'india-post')]).toEqual([['india-post:abroad', 'india-post:own']]);
  });
});

describe('rows an earlier take-over left under an old identity', () => {
  const at = '2026-09-27T02:03:08+08:00';
  const instant = '2026-09-26T18:03:08+00:00';
  // AliExpress first stored the town in brackets; its policy moved it to the place, in place.
  const scan = { provider_event_id: 'aliexpress:current', occurred_at: '2026-09-26T18:03:08.000Z', stage: 'in_transit',
    description: 'Processing at sorting center', location: 'Example Town', raw_data: { time: at } };
  const saved = { provider_event_id: 'aliexpress:bracketed', occurred_at: instant, stage: 'in_transit',
    description: 'Processing at sorting center', location: 'Example Town', time: at };

  it('lets a scan take over the row whose time, place and wording it carries', () => {
    expect(pairs(restatedIdentities([scan], [saved]))).toEqual([['aliexpress:current', 'aliexpress:bracketed']]);
    expect(pairs(restatedIdentities([scan], [{ ...saved, description: ' Processing at sorting center ', location: 'Example Town ' }])))
      .toEqual([['aliexpress:current', 'aliexpress:bracketed']]);
  });

  it('needs the same source, instant, time, place and wording', () => {
    for (const row of [
      { ...saved, provider_event_id: 'swiss-post:bracketed' },
      { ...saved, provider_event_id: 'app:pending' },
      { ...saved, occurred_at: '2026-09-26T18:03:09+00:00' },
      { ...saved, time: '2026-09-26T18:03:08Z' },
      { ...saved, time: undefined },
      { ...saved, location: 'Other Town' },
      { ...saved, description: 'Departed from sorting center' },
      { ...saved, observed_without_provider_timestamp: true },
    ]) expect(restatedIdentities([scan], [row]).size).toBe(0);
  });

  it('leaves a scan stored under its own identity, a row the batch carries, and two alike rows alone', () => {
    expect(restatedIdentities([scan], [saved, { ...saved, provider_event_id: 'aliexpress:current' }]).size).toBe(0);
    expect(restatedIdentities([scan, { ...scan, provider_event_id: 'aliexpress:bracketed' }], [saved]).size).toBe(0);
    expect(restatedIdentities([scan], [saved, { ...saved, provider_event_id: 'aliexpress:copy' }]).size).toBe(0);
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
    expect([...shared.shifted].sort()).toEqual(['unknown:delivered', 'unknown:out']);
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
    const late = sharedScans([scan('unknown:out', '2026-01-04T15:59:03Z', 'Out for Delivery')], corrected);
    expect(pairs(late.skipped)).toEqual([['unknown:out', 'unknown:out']]);
    expect([...late.shifted]).toEqual(['unknown:out']);
    const sameInstant = sharedScans([scan('unknown:out', '2026-01-04T12:59:03Z', 'With delivery courier')], corrected);
    expect(sameInstant.skipped.size + sameInstant.reused.size).toBe(0);
    // A carrier's scan whose own identity is stored is left to the upsert.
    const own = sharedScans([scan('gofo:out', '2026-01-04T12:59:03Z', 'Out for Delivery')], [row('gofo:out', '2026-01-04T12:59:03+00:00', 'Out for Delivery')]);
    expect(own.skipped.size + own.reused.size).toBe(0);
  });

  it('matches whole quarter hours up to 14 hours away, times to the minute with the same wording only', () => {
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

  it('matches the same wording dated to the minute the other scan falls in, without a clock offset', () => {
    const precise = row('ups:label', '2026-01-02T21:25:25+00:00', 'Label Created', 'registered');
    const late = sharedScans([scan('unknown:label', '2026-01-02T21:25:00Z', 'label created')], [precise]);
    expect(pairs(late.skipped)).toEqual([['unknown:label', 'ups:label']]);
    expect(late.shifted.size).toBe(0);
    // The carrier's scan takes over the copy stored to the minute, which then keeps its second.
    const early = sharedScans([scan('ups:label', '2026-01-02T21:25:25Z', 'Label Created')],
      [row('unknown:label', '2026-01-02T21:25:00+00:00', 'Label Created')]);
    expect(pairs(early.reused)).toEqual([['ups:label', 'unknown:label']]);
    expect(early.shifted.size).toBe(0);
    const again = sharedScans([scan('unknown:label', '2026-01-02T21:25:00Z', 'Label Created')],
      [row('unknown:label', '2026-01-02T21:25:25+00:00', 'Label Created')]);
    expect(pairs(again.skipped)).toEqual([['unknown:label', 'unknown:label']]);
    expect(again.shifted.size).toBe(0);
  });

  it('leaves a minute apart, other wording, both to the second, or two rows in the minute alone', () => {
    const matched = (at: string, description = 'Label Created', rows = [row('ups:label', '2026-01-02T21:25:25+00:00', 'Label Created')]) => {
      const shared = sharedScans([scan('unknown:label', at, description)], rows);
      return shared.skipped.size + shared.reused.size;
    };
    expect(matched('2026-01-02T21:25:00Z')).toBe(1);
    for (const at of ['2026-01-02T21:26:00Z', '2026-01-02T21:24:00Z', '2026-01-02T21:25:40Z']) expect(matched(at), at).toBe(0);
    expect(matched('2026-01-02T21:25:00Z', 'Picked up')).toBe(0);
    expect(matched('2026-01-02T21:25:00Z', 'Label Created', [
      row('ups:label', '2026-01-02T21:25:25+00:00', 'Label Created'), row('ups:again', '2026-01-02T21:25:50+00:00', 'Label Created'),
    ])).toBe(0);
    // A row at the scan's own instant, or one the batch shows at its own instant, is not a copy's twin.
    expect(matched('2026-01-02T21:25:00Z', 'Label Created', [
      row('ups:label', '2026-01-02T21:25:25+00:00', 'Label Created'), row('ups:other', '2026-01-02T21:25:00+00:00', 'Picked up'),
    ])).toBe(0);
    expect(sharedScans([scan('unknown:label', '2026-01-02T21:25:00Z', 'Label Created'),
      scan('unknown:other', '2026-01-02T21:25:25Z', 'Ready')], [row('ups:label', '2026-01-02T21:25:25+00:00', 'Label Created')])
      .skipped.has('unknown:label')).toBe(false);
    // Two carriers' scans are not a copy.
    expect(sharedScans([scan('dpd:label', '2026-01-02T21:25:00Z', 'Label Created')],
      [row('ups:label', '2026-01-02T21:25:25+00:00', 'Label Created')]).reused.size).toBe(0);
  });

  // A carrier's own scans, and a universal provider's own wording of them, unclassified and two hours early.
  const registered = scan('paack:registered', '2026-01-06T10:50:30Z', 'Shipment registered', 'registered');
  const accepted = scan('paack:accepted', '2026-01-06T16:38:19Z', 'Shipment accepted', 'accepted');
  const received = scan('unknown:received', '2026-01-06T08:50:30Z', 'Order details received', 'pending');
  const centre = scan('unknown:centre', '2026-01-06T14:38:19Z', 'In the distribution centre', 'pending');
  const stored = (event: ReturnType<typeof scan>) => row(String(event.provider_event_id),
    event.occurred_at.replace('Z', '+00:00'), event.description, event.stage);

  it('matches other wording on a clock a zone off, whichever source arrives first', () => {
    const late = sharedScans([received, centre], [registered, accepted].map(stored));
    expect(pairs(late.skipped)).toEqual([['unknown:centre', 'paack:accepted'], ['unknown:received', 'paack:registered']]);
    expect([...late.shifted].sort()).toEqual(['unknown:centre', 'unknown:received']);

    const early = sharedScans([registered, accepted], [received, centre].map(stored));
    expect(pairs(early.reused)).toEqual([['paack:accepted', 'unknown:centre'], ['paack:registered', 'unknown:received']]);
    expect([...early.shifted].sort()).toEqual(['paack:accepted', 'paack:registered']);
    // Classified alike, and some hours later.
    expect(sharedScans([{ ...centre, stage: 'accepted', occurred_at: '2026-01-07T03:38:19Z' }], [stored(accepted)]).skipped.size)
      .toBe(1);
  });

  it('leaves other wording a zone off alone without seconds, a stage that agrees or a carrier on one side', () => {
    const matched = (events: ReturnType<typeof scan>[], rows = [stored(accepted)]) => {
      const shared = sharedScans(events, rows);
      return shared.skipped.size + shared.reused.size;
    };
    // Times to the minute: two scans of a day often fall whole quarter hours apart.
    expect(matched([{ ...centre, occurred_at: '2026-01-06T14:38:00Z' }],
      [stored({ ...accepted, occurred_at: '2026-01-06T16:38:00Z' })])).toBe(0);
    for (const stage of ['in_transit', 'delivered']) expect(matched([{ ...centre, stage }]), stage).toBe(0);
    // Not a zone's offset: 20 minutes, a quarter or half hour (a carrier's follow-up scan), over 14 hours.
    for (const occurredAt of ['2026-01-06T16:18:19Z', '2026-01-06T16:23:19Z', '2026-01-06T16:08:19Z', '2026-01-07T06:53:19Z']) {
      expect(matched([{ ...centre, occurred_at: occurredAt }]), occurredAt).toBe(0);
    }
    // Two copies, or two carriers' scans, are not a carrier's clock against a provider's.
    expect(matched([centre], [stored({ ...accepted, provider_event_id: 'unknown:accepted' })])).toBe(0);
    expect(matched([{ ...accepted, provider_event_id: 'dpd:accepted', occurred_at: centre.occurred_at }])).toBe(0);
    // Two rows a zone away, or a row already at the scan's instant.
    expect(matched([centre], [stored(accepted), stored({ ...accepted, provider_event_id: 'paack:again', occurred_at: '2026-01-06T17:38:19Z' })]))
      .toBe(0);
    expect(matched([centre], [stored(accepted), stored({ ...registered, occurred_at: centre.occurred_at, stage: 'in_transit' })])).toBe(0);
  });

  it('never moves a row the batch shows at its own instant', () => {
    // The provider reports the carrier's scan at its real time too: the other scan is its own.
    const sameTime = scan('unknown:accepted', accepted.occurred_at, 'Accepted', 'accepted');
    expect(pairs(sharedScans([centre, sameTime], [stored(accepted)]).skipped)).toEqual([['unknown:accepted', 'paack:accepted']]);
    // A row a carrier took over stays with that carrier's scan, not a later scan whose seconds agree.
    const taken = row('unknown:sorted', '2026-01-06T10:00:07+00:00', 'Sorted', 'in_transit');
    const shared = sharedScans([scan('gofo:sorted', '2026-01-06T10:00:07Z', 'Sorted', 'in_transit'),
      scan('gofo:loaded', '2026-01-06T12:00:07Z', 'Loaded', 'in_transit')], [taken]);
    expect(pairs(shared.reused)).toEqual([['gofo:sorted', 'unknown:sorted']]);
    expect(shared.shifted.size).toBe(0);
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

  it('retains real provider scans when the stored matching row is only an observation', () => {
    const observed = { ...row('mrw:observed', '2026-09-25T12:00:00Z', 'Delivered', 'delivered'),
      raw_data: { observed_without_provider_timestamp: true } };
    expect(sharedScans([scan('unknown:dated', '2026-09-25T12:00:00Z', 'Delivered', 'delivered')],
      [observed]).skipped.size).toBe(0);
    expect(sharedScans([scan('unknown:dated', '2026-09-25T10:00:00Z', 'Delivered', 'delivered')],
      [observed]).skipped.size).toBe(0);
  });
});

describe('newest-event times set by copies read in the wrong zone', () => {
  const at = (iso: string) => Date.parse(iso);
  const none = { reused: new Map<string, string>(), skipped: new Map<string, string>() };
  const twin = row('gofo:out', '2026-01-04T12:59:03+00:00', 'Out for Delivery');
  const copy = scan('unknown:out', '2026-01-04T15:59:03Z', 'Out for Delivery');
  const skipped = { reused: new Map<string, string>(), skipped: new Map([['unknown:out', 'gofo:out']]) };

  it('reads a skipped copy at its stored twin instant', () => {
    const late = at('2026-01-04T15:59:03Z');
    expect(withoutCopyDrift(late, [copy], [twin], skipped)).toBe(at('2026-01-04T12:59:03Z'));
    // A newer scan of the batch, or a time the batch rows do not carry, still counts.
    expect(withoutCopyDrift(late, [copy, scan('unknown:new', '2026-01-04T14:00:00Z', 'Arrived')], [twin], skipped))
      .toBe(at('2026-01-04T14:00:00Z'));
    expect(withoutCopyDrift(late, [copy], [twin], skipped, { also: [at('2026-01-04T14:30:00Z')] })).toBe(at('2026-01-04T14:30:00Z'));
    // The router caps a future-dated copy at the time of the check: the copy still explains it.
    expect(withoutCopyDrift(at('2026-01-04T15:00:00Z'), [copy], [twin], skipped)).toBe(at('2026-01-04T12:59:03Z'));
  });

  it('keeps a time the copies do not explain', () => {
    expect(withoutCopyDrift(at('2026-01-04T16:30:00Z'), [copy], [twin], skipped)).toBe(at('2026-01-04T16:30:00Z'));
    expect(withoutCopyDrift(at('2026-01-04T12:00:00Z'), [copy], [twin], skipped)).toBe(at('2026-01-04T12:00:00Z'));
    expect(withoutCopyDrift(at('2026-01-04T15:59:03Z'), [copy], [twin], none)).toBe(at('2026-01-04T15:59:03Z'));
    expect(withoutCopyDrift(Number.NaN, [copy], [twin], skipped)).toBeNaN();
  });

  it('reads a copy the carrier took over at the carrier scan instant', () => {
    const stored = [row('gofo:label', '2026-01-02T12:30:00+00:00', 'Shipping Label Created'), row('unknown:out', '2026-01-04T15:59:03+00:00', 'Out for Delivery')];
    const takeover = { reused: new Map([['gofo:out', 'unknown:out']]), skipped: new Map<string, string>() };
    const events = [scan('gofo:out', '2026-01-04T12:59:03Z', 'Out for Delivery'), scan('gofo:label', '2026-01-02T12:30:00Z', 'Shipping Label Created')];
    expect(withoutCopyDrift(at('2026-01-04T15:59:03Z'), events, stored, takeover, { withStored: true })).toBe(at('2026-01-04T12:59:03Z'));
    // A stored scan newer than the corrected one keeps the watermark there.
    const newer = [...stored, row('unknown:sorted', '2026-01-04T14:10:00+00:00', 'Sorted')];
    expect(withoutCopyDrift(at('2026-01-04T15:59:03Z'), events, newer, takeover, { withStored: true })).toBe(at('2026-01-04T14:10:00Z'));
    // A stage change stamped when the sync saw it is not a scan time.
    const observed = { ...scan('gofo:observed', '2026-01-05T11:00:00.123Z', 'Out for Delivery'), raw_data: { observed_without_provider_timestamp: true } };
    expect(withoutCopyDrift(at('2026-01-04T15:59:03Z'), [...events, observed], stored, takeover, { withStored: true })).toBe(at('2026-01-04T12:59:03Z'));
  });
});
