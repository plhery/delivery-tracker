import { afterEach, describe, expect, it, vi } from 'vitest';
import contractFixture from '../../contracts/fixtures/delivery-api.json';
import contract from '../../contracts/openapi.json';
import trackingMessages from '../../shared/tracking-messages.json';
import type { ApiTrackingEventRow } from '../generated/apiContract';
import {
  GIFT_ORIGIN_DESCRIPTION,
  giftEvents,
  isParcelLinkId,
  isWrappedGift,
  detectionBucket,
  detectionLimits,
  lookupBucket,
  lookupLimits,
  lookupNetworkBucket,
  newOwnerKey,
  numberHint,
  ownerKeyHash,
  parcelAlerts,
  publicParcelResponse,
  secondsUntilUtcMidnight,
  viewerParcel,
} from './publicParcels';
import { SupabaseServiceClient } from './supabase';
import type { JsonObject } from './types';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

/** What a server with Web Push says about alerts; the key is synthetic. */
const alerts = { available: true, vapidPublicKey: `B${'A'.repeat(86)}` };

describe('parcel link identifiers and owner keys', () => {
  it('accepts only twelve symbols of the alphabet without lookalikes', () => {
    expect(isParcelLinkId('k7Qm2xHd9RtW')).toBe(true);
    for (const invalid of ['k7Qm2xHd9Rt', 'k7Qm2xHd9RtWx', 'k7Qm2xHd9Rt0', 'k7Qm2xHd9Rt1', 'k7Qm2xHd9RtI',
      'k7Qm2xHd9RtO', 'k7Qm2xHd9Rtl', 'k7Qm2xHd9Rt-', '', null, 42]) {
      expect(isParcelLinkId(invalid)).toBe(false);
    }
  });

  it('draws a 256-bit key and stores only its SHA-256', () => {
    const key = newOwnerKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newOwnerKey()).not.toBe(key);
    expect(ownerKeyHash(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(ownerKeyHash(key)).toBe(ownerKeyHash(key));
    for (const invalid of ['', 'short', `${key}=`, `${key.slice(1)}!`, null, undefined, 42]) {
      expect(ownerKeyHash(invalid)).toBeNull();
    }
  });
});

describe('daily lookup allowances', () => {
  it('counts a client under a keyed hash of its address and the day', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    const day = new Date('2026-10-02T08:00:00Z');
    const bucket = lookupBucket('198.51.100.7', day);
    expect(bucket).toMatch(/^[0-9a-f]{64}$/);
    expect(bucket).not.toContain('198');
    // The same client all day, whatever the hour.
    expect(lookupBucket('198.51.100.7', new Date('2026-10-02T23:59:59Z'))).toBe(bucket);
    // Another client, another day and another server secret each give another bucket.
    expect(lookupBucket('198.51.100.8', day)).not.toBe(bucket);
    expect(lookupBucket('198.51.100.7', new Date('2026-10-03T00:00:00Z'))).not.toBe(bucket);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'another-service-key');
    expect(lookupBucket('198.51.100.7', day)).not.toBe(bucket);
  });

  it('counts an IPv6 line as one client', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    const day = new Date('2026-10-02T08:00:00Z');
    expect(lookupBucket('2001:db8:1:2:aaaa::1', day)).toBe(lookupBucket('2001:0db8:0001:0002::ffff', day));
    expect(lookupBucket('2001:db8:1:3::1', day)).not.toBe(lookupBucket('2001:db8:1:2::1', day));
  });

  it('counts the lines of an IPv6 /48 together under a hash of their own', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    const day = new Date('2026-10-02T08:00:00Z');
    const network = lookupNetworkBucket('2001:db8:1:2::1', day);
    expect(network).toMatch(/^network:[0-9a-f]{64}$/);
    expect(lookupNetworkBucket('2001:0db8:0001:ffff:aaaa::9', day)).toBe(network);
    expect(lookupNetworkBucket('2001:db8:2:2::1', day)).not.toBe(network);
    expect(lookupNetworkBucket('2001:db8:1:2::1', new Date('2026-10-03T00:00:00Z'))).not.toBe(network);
    expect(network).not.toBe(`network:${lookupBucket('2001:db8:1:2::1', day)}`);
    // An IPv4 address is its own network, and so is a client whose address is not known.
    for (const address of ['198.51.100.7', '::ffff:198.51.100.7', 'untrusted', 'unknown']) {
      expect(lookupNetworkBucket(address, day)).toBeNull();
    }
  });

  it('counts the numbers a client had carriers asked about under another hash than its lookups', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    const day = new Date('2026-10-02T08:00:00Z');
    const bucket = detectionBucket('198.51.100.7', day);
    expect(bucket).toMatch(/^detection:[0-9a-f]{64}$/);
    expect(bucket).not.toBe(`detection:${lookupBucket('198.51.100.7', day)}`);
    expect(detectionBucket('198.51.100.8', day)).not.toBe(bucket);
    expect(detectionBucket('198.51.100.7', new Date('2026-10-03T00:00:00Z'))).not.toBe(bucket);
    expect(detectionBucket('2001:db8:1:2:aaaa::1', day)).toBe(detectionBucket('2001:db8:1:2::ffff', day));
  });

  it('reads the allowances from the environment, falling back to the defaults', () => {
    expect(lookupLimits({})).toEqual({ perClient: 15, perNetwork: 150, overall: 3_000 });
    expect(lookupLimits({ PUBLIC_LOOKUPS_PER_DAY: ' 40 ', PUBLIC_LOOKUPS_GLOBAL_PER_DAY: '0' }))
      .toEqual({ perClient: 40, perNetwork: 400, overall: 0 });
    expect(lookupLimits({ PUBLIC_LOOKUPS_PER_DAY: '-1', PUBLIC_LOOKUPS_GLOBAL_PER_DAY: 'many' }))
      .toEqual({ perClient: 15, perNetwork: 150, overall: 3_000 });
    expect(detectionLimits({})).toEqual({ perClient: 60, overall: 10_000 });
    expect(detectionLimits({ PUBLIC_DETECTIONS_PER_DAY: '0', PUBLIC_DETECTIONS_GLOBAL_PER_DAY: ' 500 ' }))
      .toEqual({ perClient: 0, overall: 500 });
    expect(detectionLimits({ PUBLIC_DETECTIONS_PER_DAY: '1.5', PUBLIC_DETECTIONS_GLOBAL_PER_DAY: '' }))
      .toEqual({ perClient: 60, overall: 10_000 });
  });

  it('retries a daily refusal at the next UTC midnight', () => {
    expect(secondsUntilUtcMidnight(new Date('2026-10-02T00:00:00Z'))).toBe(86_400);
    expect(secondsUntilUtcMidnight(new Date('2026-10-02T23:59:59.500Z'))).toBe(1);
    expect(secondsUntilUtcMidnight(new Date('2026-12-31T12:00:00Z'))).toBe(43_200);
  });
});

describe('what a link shows', () => {
  it('hints at a masked number with its end only, and shows less of a short one', () => {
    expect(numberHint('TESTPARCEL123456')).toEqual({ head: '', tail: '3456' });
    expect(numberHint('TESTPARCEL1234567890')).toEqual({ head: '', tail: '7890' });
    expect(numberHint('TEST12345678')).toEqual({ head: '', tail: '678' });
    expect(numberHint('TEST1234')).toEqual({ head: '', tail: '34' });
    expect(numberHint('T123')).toEqual({ head: '', tail: '3' });
    for (let length = 4; length <= 40; length += 1) {
      const number = `${'T'.repeat(length - 1)}1`;
      const hint = numberHint(number);
      // At least three quarters of the number stay hidden, its start among them.
      expect(hint.head).toBe('');
      expect(hint.tail.length).toBeLessThanOrEqual(Math.min(4, length / 4));
      expect(hint.tail.length).toBeGreaterThan(0);
      expect(number.endsWith(hint.tail)).toBe(true);
    }
  });

  it('publishes exactly the carrier details the contract lists', () => {
    const schema = contract.components.schemas.PublicPackage;
    const listed = Object.keys(schema.properties.carrier_data.properties).sort();
    expect(schema.properties.carrier_data.additionalProperties).toBe(false);
    // A stored row with a value under every key the app has ever stored, and then some.
    const stored = Object.fromEntries([
      ...Object.keys(contract.components.schemas.PackageRow.properties.carrier_data.properties),
      'delivery_probe', 'swiss_post_probe', 'upu_history', 'direct_local_history', 'canonical_tracking_number',
      'international_tracking_number', 'delivery_tracking_number', 'pickup_code', 'last_update', 'events',
    ].map((key) => [key, ['carrier_answered', 'swiss_post_ready', 'dpd_postcode_verified'].includes(key) ? true
      : key === 'weight_kg' ? 2 : key === 'routing' ? { confirmed_postcode: '9999' } : `stored ${key}`]));
    const shown = (link: Record<string, unknown>) => publicParcelResponse({
      link: { id: 'k7Qm2xHd9RtW', created_at: '2026-10-02T08:00:00Z', forget_at: null, ...link },
      package: { id: 'parcel', tracking_number: 'TESTPARCEL123456', carrier: 'unknown', sync_status: 'ok',
        created_at: '2026-10-02T08:00:00Z', carrier_data: stored, tracking_events: [],
        // What its owner chose about alerts, and when the parcel joined an account, is the owner's alone.
        notifications_muted: true, email_muted: true, owned_since: '2026-10-01T08:00:00Z' },
    }, alerts).package;

    expect(Object.keys(shown({ owner: true }).carrier_data).sort()).toEqual(listed);
    expect(Object.keys(shown({ owner: false }).carrier_data).sort())
      .toEqual(listed.filter((key) => !key.endsWith('_tracking_number')));
    for (const hidden of ['routing', 'receiver_name', 'original_tracking_url', 'original_package_id',
      'dpd_postcode_verified', 'delivery_probe', 'upu_history', 'pickup_code']) {
      expect(listed).not.toContain(hidden);
    }
    // Every other field of the answer is one the contract requires, and nothing else.
    expect(Object.keys(shown({ owner: false })).sort()).toEqual([...schema.required].sort());
    expect(schema.additionalProperties).toBe(false);
    for (const link of [{ owner: false }, { owner: true }]) {
      expect(shown(link).notifications_muted).toBe(false);
      expect(JSON.stringify(shown(link))).not.toMatch(/email_muted|owned_since/);
    }
    // A gift on its way keeps back the sender, what describes the contents and where the parcel waits.
    expect(Object.keys(shown({ owner: false, gift: true, show_number: true }).carrier_data).sort()).toEqual(listed.filter((key) => (
      !key.endsWith('_tracking_number') && !['sender_name', 'pickup_point', 'dimensions_text', 'weight_kg'].includes(key)
    )));
  });

  it('says of every link whether it is a gift, whether it is shared and how to turn alerts on', () => {
    const link = contract.components.schemas.ParcelLink;
    const shown = (stored: Record<string, unknown>) => publicParcelResponse({
      link: { id: 'k7Qm2xHd9RtW', created_at: '2026-10-02T08:00:00Z', forget_at: null, ...stored },
      package: { id: 'parcel', tracking_number: 'TESTPARCEL123456', carrier: 'unknown', sync_status: 'ok',
        created_at: '2026-10-02T08:00:00Z', carrier_data: {}, tracking_events: [] },
    }, alerts).link;
    expect(Object.keys(shown({ owner: true })).sort()).toEqual(Object.keys(link.properties).filter((key) => key !== 'giftWords').sort());
    // Only the owner, who always reads the number, is told what viewers are shown.
    expect(shown({ owner: true, show_number: true })).toMatchObject({ showNumber: true, numberShown: true });
    expect(shown({ owner: true })).toMatchObject({ showNumber: false, numberShown: true });
    expect(shown({ show_number: true })).not.toHaveProperty('showNumber');
    expect(link.additionalProperties).toBe(false);
    expect(shown({})).toMatchObject({ gift: false, shared: true, alerts });
    expect(shown({ gift: true, stopped: true, owner: true })).toMatchObject({ gift: true, shared: false, role: 'owner' });
    // Only a real true makes a gift or a stop: a value of another type does not.
    expect(shown({ gift: 'yes', stopped: 1 })).toMatchObject({ gift: false, shared: true });
  });

  it('answers with the shapes the web and iPhone clients decode from the shared fixture', () => {
    const { publicParcel, publicLookup, publicGiftParcel } = contractFixture;
    const stored = {
      id: publicParcel.package.id, user_id: null, one_off: true, tracking_number: 'TESTPARCEL123456', label: '',
      carrier: 'dpd', created_at: '2026-10-02T08:00:00+00:00', current_stage: 'in_transit', archived_at: null,
      notifications_muted: false, tracking_url: null, dpd_postcode: '9999',
    };
    const link = { id: 'k7Qm2xHd9RtW', shared: false, show_number: false, created_at: '2026-10-02T08:00:00+00:00' };
    // These two fixtures are answers from before sharing: the server now adds what a link says about gifts, sharing and alerts.
    const since = <Answer extends { link: object }>(answer: Answer) => ({ ...answer, link: { ...answer.link, gift: false, shared: true, alerts } });
    expect(publicParcelResponse({
      link: { ...link, owner: false, forget_at: '2026-12-31T08:05:00+00:00' },
      package: {
        ...stored, expected_delivery: '2026-10-03', last_status_text: 'In transit',
        last_synced_at: '2026-10-02T08:05:00+00:00', sync_status: 'ok', sync_error: null,
        carrier_data: { sender_name: 'Example Shop', weight_kg: 1.2, destination_country: 'CH', routing: { confirmed_postcode: '9999' } },
        tracking_events: [{ ...publicParcel.package.tracking_events[0], place: undefined, point: null }],
      },
    }, alerts)).toEqual(since(publicParcel));
    expect({
      ...publicParcelResponse({
        link: { ...link, owner: true, forget_at: '2026-12-31T08:00:00+00:00' },
        package: {
          ...stored, current_stage: 'pending', expected_delivery: null, last_status_text: null,
          last_synced_at: null, sync_status: 'pending', sync_error: null, carrier_data: {},
          tracking_events: [{ ...publicLookup.package.tracking_events[0], place: undefined, point: null }],
        },
      }, alerts),
      key: publicLookup.key,
    }).toEqual(since(publicLookup));

    // The gift fixture is what a viewer gets of an account's parcel on its way from Germany.
    const [delivery, hub, accepted] = publicGiftParcel.package.tracking_events;
    const scan = (event: typeof delivery, description: string, location: string | null) => ({
      id: event.id, package_id: event.package_id, stage: event.stage, occurred_at: event.occurred_at, description, location,
    });
    expect(publicParcelResponse({
      link: { id: publicGiftParcel.link.id, owner: false, shared: true, show_number: true, gift: true, stopped: false,
        created_at: '2026-10-01T08:00:00+00:00', forget_at: null },
      package: {
        ...stored, id: publicGiftParcel.package.id, one_off: false, user_id: 'an-account', tracking_number: 'TESTGIFT23456789',
        label: 'A surprise', carrier: 'dhl', created_at: '2026-10-01T08:00:00+00:00', current_stage: 'out_for_delivery',
        expected_delivery: '2026-10-03', last_status_text: 'With the courier, sent from Hamburg',
        last_synced_at: '2026-10-02T08:05:00+00:00', sync_status: 'ok', sync_error: null,
        carrier_data: { sender_name: 'Example Shop', weight_kg: 1.2, destination_country: 'CH' },
        tracking_events: [
          scan(delivery, delivery.description, delivery.location),
          scan(hub, 'Departed the parcel centre', 'Leipzig, DE'),
          scan(accepted, 'Picked up from the sender', 'Hamburg, DE'),
          { id: 'registered-row', package_id: accepted.package_id, stage: 'registered', description: 'Announced by Example Shop',
            location: 'Hamburg, DE', occurred_at: '2026-10-01T08:00:00+00:00' },
        ],
      },
    }, alerts)).toEqual(publicGiftParcel);
    expect(contractFixture.parcelShare.link).toEqual({
      id: publicGiftParcel.link.id, showNumber: false, gift: true, createdAt: publicGiftParcel.link.createdAt,
    });
  });

  it('drops a stored value of the wrong type instead of publishing it', () => {
    const { carrier_data: shown } = publicParcelResponse({
      link: { id: 'k7Qm2xHd9RtW', owner: true, created_at: '2026-10-02T08:00:00Z' },
      package: { id: 'parcel', tracking_number: 'TESTPARCEL123456', carrier: 'unknown', sync_status: 'ok',
        created_at: '2026-10-02T08:00:00Z', tracking_events: null,
        carrier_data: { sender_name: { name: 'nested' }, weight_kg: '2 kg', carrier_answered: 'yes', pickup_point: '', destination_country: 'CH' } },
    }, alerts).package;
    expect(shown).toEqual({ destination_country: 'CH' });
  });
});

describe('a gift on its way', () => {
  const packageId = '53000000-0000-4000-a000-000000000001';
  let hour = 0;
  /** One stored scan, an hour after the one before it. */
  const scan = (stage: string, location: string | null, description = `Carrier wording for ${stage} at ${location}`): JsonObject => ({
    id: `scan-${hour + 1}`, package_id: packageId, stage, description, location,
    occurred_at: new Date(Date.parse('2026-10-01T06:00:00Z') + (hour += 1) * 3_600_000).toISOString(),
    point: location ? { latitude: 1, longitude: 2 } : null,
  });
  const journey = (...scans: JsonObject[]): JsonObject[] => { hour = 0; return scans.reverse(); };
  const stored = (events: JsonObject[], parcel: JsonObject = {}, link: JsonObject = {}) => ({
    link: { id: 'k7Qm2xHd9RtW', owner: false, shared: true, show_number: true, gift: true, stopped: false,
      created_at: '2026-10-01T05:00:00Z', forget_at: null, ...link },
    package: {
      id: packageId, tracking_number: 'TESTGIFT23456789', label: 'Sneakers for Ada', carrier: 'dhl', sync_status: 'ok',
      created_at: '2026-10-01T05:00:00Z', current_stage: 'in_transit', expected_delivery: '2026-10-03',
      last_status_text: 'Processed in Hamburg', last_synced_at: '2026-10-02T08:00:00Z', sync_error: null,
      carrier_data: { sender_name: 'Example Shop', weight_kg: 2, dimensions_text: '30 × 20 × 10 cm',
        pickup_point: 'Example Kiosk', active_tracking_number: 'TESTDELIVERYLEG01', original_tracking_number: 'TESTORIGINLEG0001',
        active_tracking_carrier: 'swiss-post', expected_delivery_from: '2026-10-03T08:00:00+02:00' },
      tracking_events: events, ...parcel,
    },
  });
  /** Each shown scan as "stage: description @ location (place)", oldest first. */
  const told = (events: ApiTrackingEventRow[]) => [...events].reverse().map((event) => (
    `${event.stage}: ${event.description} @ ${event.location} (${event.place ? `${event.place.precision} ${event.place.name}` : 'no place'})`
  ));
  const blurredIn = (country: string | null, name: string | null, stage: string) => (
    `${stage}: Left the sender @ ${country} (${name ? `country ${name}` : 'no place'})`
  );
  const kept = (stage: string, location: string | null, place: string) => (
    `${stage}: Carrier wording for ${stage} at ${location} @ ${location} (${place})`
  );

  it.each([
    {
      name: 'across a border: every scan in the origin country is blurred, the rest is shown',
      events: () => journey(
        scan('pending', null), scan('registered', 'Hamburg, DE'), scan('accepted', 'Hamburg, DE'), scan('in_transit', 'Leipzig, DE'),
        scan('customs', 'Basel, CH'), scan('in_transit', null), scan('out_for_delivery', 'Zürich, CH'),
      ),
      shown: [
        blurredIn('DE', 'Germany', 'accepted'), blurredIn('DE', 'Germany', 'in_transit'),
        kept('customs', 'Basel, CH', 'city Basel'), kept('in_transit', null, 'no place'),
        kept('out_for_delivery', 'Zürich, CH', 'city Zürich'),
      ],
    },
    {
      name: 'the origin is the earliest located scan, even one that is left out',
      events: () => journey(scan('registered', 'Shenzhen, CN'), scan('accepted', null), scan('in_transit', 'Liège, BE'), scan('in_transit', 'Zürich, CH')),
      shown: [blurredIn('CN', 'China', 'accepted'), kept('in_transit', 'Liège, BE', 'city Liège'), kept('in_transit', 'Zürich, CH', 'city Zürich')],
    },
    {
      name: 'a scan without a place counts as the origin until the parcel is seen elsewhere',
      events: () => journey(scan('accepted', 'Depot 12'), scan('in_transit', 'Hamburg, DE'), scan('exception', 'Held at the sender'), scan('in_transit', 'Zürich, CH'), scan('in_transit', 'Depot 7')),
      shown: [
        blurredIn('DE', 'Germany', 'accepted'), blurredIn('DE', 'Germany', 'in_transit'), blurredIn('DE', 'Germany', 'exception'),
        kept('in_transit', 'Zürich, CH', 'city Zürich'), kept('in_transit', 'Depot 7', 'no place'),
      ],
    },
    {
      name: 'a parcel that comes back to the origin country is blurred there again',
      events: () => journey(scan('accepted', 'Hamburg, DE'), scan('in_transit', 'Zürich, CH'), scan('returned', 'Hamburg, DE')),
      shown: [blurredIn('DE', 'Germany', 'accepted'), kept('in_transit', 'Zürich, CH', 'city Zürich'), blurredIn('DE', 'Germany', 'returned')],
    },
    {
      name: 'bound for another country but not there yet: everything so far is the origin',
      events: () => journey(scan('accepted', 'Hamburg, DE'), scan('in_transit', 'Leipzig, DE'), scan('in_transit', null)),
      parcel: { carrier_data: { destination_country: 'ch' } },
      shown: [blurredIn('DE', 'Germany', 'accepted'), blurredIn('DE', 'Germany', 'in_transit'), blurredIn('DE', 'Germany', 'in_transit')],
    },
    {
      name: 'within one country: only the scans before transit are blurred',
      events: () => journey(scan('registered', 'Bern, CH'), scan('accepted', 'Bern, CH'), scan('in_transit', 'Härkingen, CH'), scan('out_for_delivery', 'Zürich, CH')),
      parcel: { carrier_data: { destination_country: 'CH' } },
      shown: [blurredIn('CH', 'Switzerland', 'accepted'), kept('in_transit', 'Härkingen, CH', 'city Härkingen'), kept('out_for_delivery', 'Zürich, CH', 'city Zürich')],
    },
    {
      name: 'no destination known and no border crossed: treated as within one country',
      events: () => journey(scan('accepted', 'Hamburg, DE'), scan('in_transit', 'Leipzig, DE')),
      parcel: { carrier_data: {} },
      shown: [blurredIn('DE', 'Germany', 'accepted'), kept('in_transit', 'Leipzig, DE', 'city Leipzig')],
      onTheWay: ['Leipzig'],
    },
    {
      name: 'no scan located: the scans before transit lose their wording and say no country',
      events: () => journey(scan('accepted', 'Depot 12'), scan('in_transit', 'Depot 7')),
      parcel: { carrier_data: {} },
      shown: [blurredIn(null, null, 'accepted'), kept('in_transit', 'Depot 7', 'no place')],
    },
    {
      name: 'nothing but the announcement: no scan at all',
      events: () => journey(scan('pending', null), scan('registered', 'Hamburg, DE')),
      shown: [],
    },
  ])('$name', ({ events, parcel, shown, onTheWay }: {
    events: () => JsonObject[]; parcel?: JsonObject; shown: string[]; onTheWay?: string[];
  }) => {
    const answer = publicParcelResponse(stored(events(), parcel), alerts);
    expect(told(answer.package.tracking_events)).toEqual(shown);
    // Times, stages and identities stay; the newest scan comes first, as stored.
    const times = answer.package.tracking_events.map((event) => Date.parse(event.occurred_at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    for (const event of answer.package.tracking_events) {
      expect(Object.keys(event).sort()).toEqual(['description', 'id', 'location', 'occurred_at', 'package_id', 'place', 'stage']);
      if (event.description === GIFT_ORIGIN_DESCRIPTION) {
        // Nothing more precise than the country: no town, no facility, not the carrier's point.
        expect(!event.place || (event.place.precision === 'country' && !('site' in event.place))).toBe(true);
        expect(event.location === null || /^[A-Z]{2}$/.test(event.location)).toBe(true);
      }
    }
    // Neither the sender, the number, the name, the origin's towns nor the carrier's wording for them.
    const text = JSON.stringify(answer);
    for (const secret of ['Example Shop', 'Sneakers', 'TESTGIFT23456789', 'TESTDELIVERYLEG01', 'TESTORIGINLEG0001', 'Example Kiosk',
      '30 × 20', 'weight_kg', 'Hamburg', 'Leipzig', 'Shenzhen', 'Bern', 'Depot 12', 'Held at the sender', 'registered', '"point"']) {
      if (!onTheWay?.includes(secret)) expect(text).not.toContain(secret);
    }
    expect(answer.link).toMatchObject({ role: 'viewer', gift: true, numberShown: false, canKeep: false });
    expect(answer.package).toMatchObject({
      tracking_number: null, number_hint: { head: '', tail: '6789' }, label: '', last_status_text: null,
      expected_delivery: '2026-10-03',
    });
    expect(answer.package.carrier_data).not.toHaveProperty('sender_name');
  });

  const crossing = () => journey(
    scan('registered', 'Hamburg, DE'), scan('accepted', 'Hamburg, DE'), scan('in_transit', 'Leipzig, DE'), scan('delivered', 'Zürich, CH'),
  );

  it('comes out once it is delivered: a viewer sees what the viewer of any link sees', () => {
    const delivered = stored(crossing(), { current_stage: 'delivered' });
    const answer = publicParcelResponse(delivered, alerts);
    const plain = publicParcelResponse({ ...delivered, link: { ...delivered.link, gift: false } }, alerts);
    expect(answer).toEqual({ ...plain, link: { ...plain.link, gift: true } });
    expect(answer.link).toMatchObject({ gift: true, numberShown: true, canKeep: true });
    expect(answer.package.tracking_number).toBe('TESTGIFT23456789');
    expect(answer.package.carrier_data).toMatchObject({ sender_name: 'Example Shop', weight_kg: 2, pickup_point: 'Example Kiosk' });
    expect(answer.package.last_status_text).toBe('Processed in Hamburg');
    expect(told(answer.package.tracking_events)).toEqual([
      kept('registered', 'Hamburg, DE', 'city Hamburg'), kept('accepted', 'Hamburg, DE', 'city Hamburg'),
      kept('in_transit', 'Leipzig, DE', 'city Leipzig'), kept('delivered', 'Zürich, CH', 'city Zürich'),
    ]);
    // A delivered gift whose link hides the number still hides it.
    expect(publicParcelResponse(stored(crossing(), { current_stage: 'delivered' }, { show_number: false }), alerts).link)
      .toMatchObject({ numberShown: false, canKeep: false });
  });

  it.each(['in_transit', 'out_for_delivery', 'returned', 'exception', 'ready_for_pickup', undefined, null, 'DELIVERED'])(
    'stays wrapped for a viewer while the stored stage is %s', (stage) => {
      const answer = publicParcelResponse(stored(crossing(), { current_stage: stage }), alerts);
      expect(answer.package.tracking_number).toBeNull();
      expect(JSON.stringify(answer)).not.toMatch(/Hamburg|Leipzig|Example Shop/);
    },
  );

  it('always shows its owner everything', () => {
    const own = stored(crossing(), {}, { owner: true, shared: false, show_number: false });
    const answer = publicParcelResponse(own, alerts);
    expect(isWrappedGift(own)).toBe(false);
    expect(answer.link).toMatchObject({ role: 'owner', gift: true, numberShown: true, canKeep: true });
    expect(answer.package).toMatchObject({ tracking_number: 'TESTGIFT23456789', last_status_text: 'Processed in Hamburg' });
    expect(answer.package.carrier_data).toMatchObject({ sender_name: 'Example Shop', active_tracking_number: 'TESTDELIVERYLEG01' });
    expect(told(answer.package.tracking_events)[0]).toBe(kept('registered', 'Hamburg, DE', 'city Hamburg'));
    expect(answer.package.tracking_events).toHaveLength(4);
  });

  it('blurs with the description the clients translate', () => {
    expect(trackingMessages.events).toHaveProperty([GIFT_ORIGIN_DESCRIPTION]);
    expect(giftEvents([], null)).toEqual([]);
  });

  it('gives the page\'s metadata and preview the viewer\'s answer, never the owner\'s or the stored row', async () => {
    const client = new SupabaseServiceClient('https://database.example', 'service-key');
    const read = vi.spyOn(client, 'publicParcel').mockResolvedValue(stored(crossing()));
    const viewed = await viewerParcel(client, 'k7Qm2xHd9RtW');
    // No key, and not an opening.
    expect(read).toHaveBeenCalledExactlyOnceWith('k7Qm2xHd9RtW', null, false);
    expect(viewed).toMatchObject({ status: 'shown', wrappedGift: true });
    expect(JSON.stringify(viewed)).not.toMatch(/Hamburg|Leipzig|Example Shop|Sneakers|TESTGIFT23456789/);

    read.mockResolvedValue(stored(crossing(), { current_stage: 'delivered' }));
    expect(await viewerParcel(client, 'k7Qm2xHd9RtW')).toMatchObject({ status: 'shown', wrappedGift: false });
    read.mockResolvedValue('stopped');
    expect(await viewerParcel(client, 'k7Qm2xHd9RtW')).toEqual({ status: 'stopped' });
    read.mockResolvedValue(null);
    expect(await viewerParcel(client, 'k7Qm2xHd9RtW')).toEqual({ status: 'unavailable' });
    read.mockClear();
    expect(await viewerParcel(client, 'not-a-link-id!')).toEqual({ status: 'unavailable' });
    expect(read).not.toHaveBeenCalled();
  });
});

describe('whether a link can take alerts', () => {
  const client = new SupabaseServiceClient('https://database.example', 'service-key');

  it('says no without Web Push keys, and when they do not load', () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    vi.stubEnv('SMTP_HOST', '');
    expect(parcelAlerts(client)).toEqual({ available: false, vapidPublicKey: null, email: false });
    // A key without its other half is a configuration error: a parcel is still shown.
    vi.stubEnv('VAPID_PUBLIC_KEY', 'only-one-half');
    expect(parcelAlerts(client)).toEqual({ available: false, vapidPublicKey: null, email: false });
  });

  it('says whether this server emails accounts, whatever Web Push does', () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    vi.stubEnv('EMAIL_FROM', 'Peek <hello@example.com>');
    vi.stubEnv('CANONICAL_ORIGIN', 'https://peek.example.com');
    expect(parcelAlerts(client)).toEqual({ available: false, vapidPublicKey: null, email: true });
    vi.stubEnv('VAPID_PUBLIC_KEY', 'only-one-half');
    expect(parcelAlerts(client)).toEqual({ available: false, vapidPublicKey: null, email: true });
    // Mail settings that do not load read as none: startup reports them.
    vi.stubEnv('EMAIL_FROM', '');
    expect(parcelAlerts(client)).toEqual({ available: false, vapidPublicKey: null, email: false });
  });
});


it('withholds stored gift words from viewers until delivery, including unknown and returned stages', () => {
  const words = { name: 'Trail shoes', note: 'Happy birthday!', from: 'Sam' };
  const found = {
    link: { id: 'k7Qm2xHd9RtW', gift: true, gift_words: words, created_at: '2026-10-02T08:00:00Z' },
    package: { id: 'parcel', tracking_number: 'TESTPARCEL123456', carrier: 'unknown', sync_status: 'ok',
      created_at: '2026-10-02T08:00:00Z', carrier_data: {}, tracking_events: [] },
  };
  for (const stage of [null, 'pending', 'in_transit', 'out_for_delivery', 'ready_for_pickup', 'returned']) {
    const answer = publicParcelResponse({ ...found, package: { ...found.package, current_stage: stage } }, alerts);
    expect(answer.link).not.toHaveProperty('giftWords');
    expect(JSON.stringify(answer)).not.toMatch(/Trail shoes|birthday|Sam/);
  }
  expect(publicParcelResponse({ ...found, package: { ...found.package, current_stage: 'delivered' } }, alerts).link.giftWords).toEqual(words);
  expect(publicParcelResponse({ ...found, link: { ...found.link, owner: true } }, alerts).link.giftWords).toEqual(words);
  expect(publicParcelResponse({ ...found, link: { ...found.link, gift: false }, package: { ...found.package, current_stage: 'delivered' } }, alerts).link)
    .not.toHaveProperty('giftWords');
});
