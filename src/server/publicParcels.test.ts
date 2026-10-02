import { afterEach, describe, expect, it, vi } from 'vitest';
import contractFixture from '../../contracts/fixtures/delivery-api.json';
import contract from '../../contracts/openapi.json';
import {
  isParcelLinkId,
  lookupBucket,
  lookupLimits,
  newOwnerKey,
  numberHint,
  ownerKeyHash,
  publicParcelResponse,
  secondsUntilUtcMidnight,
} from './publicParcels';

afterEach(() => { vi.unstubAllEnvs(); });

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

  it('reads the allowances from the environment, falling back to the defaults', () => {
    expect(lookupLimits({})).toEqual({ perClient: 15, overall: 3_000 });
    expect(lookupLimits({ PUBLIC_LOOKUPS_PER_DAY: ' 40 ', PUBLIC_LOOKUPS_GLOBAL_PER_DAY: '0' }))
      .toEqual({ perClient: 40, overall: 0 });
    expect(lookupLimits({ PUBLIC_LOOKUPS_PER_DAY: '-1', PUBLIC_LOOKUPS_GLOBAL_PER_DAY: 'many' }))
      .toEqual({ perClient: 15, overall: 3_000 });
  });

  it('retries a daily refusal at the next UTC midnight', () => {
    expect(secondsUntilUtcMidnight(new Date('2026-10-02T00:00:00Z'))).toBe(86_400);
    expect(secondsUntilUtcMidnight(new Date('2026-10-02T23:59:59.500Z'))).toBe(1);
    expect(secondsUntilUtcMidnight(new Date('2026-12-31T12:00:00Z'))).toBe(43_200);
  });
});

describe('what a link shows', () => {
  it('hints at a masked number with its ends, and shows less of a short one', () => {
    expect(numberHint('TESTPARCEL123456')).toEqual({ head: 'TEST', tail: '456' });
    expect(numberHint('TEST12345678')).toEqual({ head: 'TEST', tail: '678' });
    expect(numberHint('TEST1234')).toEqual({ head: 'TE', tail: '34' });
    expect(numberHint('T123')).toEqual({ head: 'T', tail: '3' });
    for (let length = 4; length <= 40; length += 1) {
      const number = `${'T'.repeat(length - 1)}1`;
      const hint = numberHint(number);
      // At least four characters, or half of a short number, stay hidden.
      expect(length - hint.head.length - hint.tail.length).toBeGreaterThanOrEqual(Math.min(4, length / 2));
      expect(number.startsWith(hint.head) && number.endsWith(hint.tail)).toBe(true);
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
        created_at: '2026-10-02T08:00:00Z', carrier_data: stored, tracking_events: [] },
    }).package;

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
  });

  it('answers with the shapes the web and iPhone clients decode from the shared fixture', () => {
    const { publicParcel, publicLookup } = contractFixture;
    const stored = {
      id: publicParcel.package.id, user_id: null, one_off: true, tracking_number: 'TESTPARCEL123456', label: '',
      carrier: 'dpd', created_at: '2026-10-02T08:00:00+00:00', current_stage: 'in_transit', archived_at: null,
      notifications_muted: false, tracking_url: null, dpd_postcode: '9999',
    };
    const link = { id: 'k7Qm2xHd9RtW', shared: false, show_number: false, created_at: '2026-10-02T08:00:00+00:00' };
    expect(publicParcelResponse({
      link: { ...link, owner: false, forget_at: '2026-12-31T08:05:00+00:00' },
      package: {
        ...stored, expected_delivery: '2026-10-03', last_status_text: 'In transit',
        last_synced_at: '2026-10-02T08:05:00+00:00', sync_status: 'ok', sync_error: null,
        carrier_data: { sender_name: 'Example Shop', weight_kg: 1.2, destination_country: 'CH', routing: { confirmed_postcode: '9999' } },
        tracking_events: [{ ...publicParcel.package.tracking_events[0], place: undefined, point: null }],
      },
    })).toEqual(publicParcel);
    expect({
      ...publicParcelResponse({
        link: { ...link, owner: true, forget_at: '2026-12-31T08:00:00+00:00' },
        package: {
          ...stored, current_stage: 'pending', expected_delivery: null, last_status_text: null,
          last_synced_at: null, sync_status: 'pending', sync_error: null, carrier_data: {},
          tracking_events: [{ ...publicLookup.package.tracking_events[0], place: undefined, point: null }],
        },
      }),
      key: publicLookup.key,
    }).toEqual(publicLookup);
  });

  it('drops a stored value of the wrong type instead of publishing it', () => {
    const { carrier_data: shown } = publicParcelResponse({
      link: { id: 'k7Qm2xHd9RtW', owner: true, created_at: '2026-10-02T08:00:00Z' },
      package: { id: 'parcel', tracking_number: 'TESTPARCEL123456', carrier: 'unknown', sync_status: 'ok',
        created_at: '2026-10-02T08:00:00Z', tracking_events: null,
        carrier_data: { sender_name: { name: 'nested' }, weight_kg: '2 kg', carrier_answered: 'yes', pickup_point: '', destination_country: 'CH' } },
    }).package;
    expect(shown).toEqual({ destination_country: 'CH' });
  });
});
