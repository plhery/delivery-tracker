import { describe, expect, it } from 'vitest';
import { firstScanCountry, formatJourneyDuration, passportStatistics } from './passport';
import type { ParcelWithEvents, Stage } from '../types';

function parcel(id: string, scans: Array<[Stage, string, string?]>, overrides: Partial<ParcelWithEvents> = {}): ParcelWithEvents {
  return { id, label: id, syncStatus: 'ok', carrier: 'swiss-post', trackingNumber: '993412345612345678', createdAt: '2026-08-01T00:00:00Z',
    events: scans.map(([stage, occurredAt, location], index) => ({ id: `${id}-${index}`, parcelId: id, stage, occurredAt, location, description: stage })), ...overrides };
}

describe('passport journeys', () => {
  it('starts at the physical scan, orders actual instants, and includes archived deliveries', () => {
    const stats = passportStatistics([
      parcel('fast', [
        ['delivered', '2026-08-05T10:00:00Z', 'Paris, France'],
        ['registered', '2026-08-01T00:00:00Z'],
        ['accepted', '2026-08-04T14:00:00+02:00', 'Berlin, Deutschland'],
      ], { archivedAt: '2026-08-06T12:00:00Z' }),
      parcel('slow', [['accepted', '2026-08-04T10:00:00Z', 'Paris, France'], ['delivered', '2026-08-06T12:00:00Z']], { carrier: 'dhl' }),
      parcel('active', [['in_transit', '2026-08-07T10:00:00Z', 'Lyon, France']]),
    ]);
    expect(stats).toMatchObject({ deliveredCount: 2, activeCount: 1, carrierCount: 2, durationSampleCount: 2,
      averageDeliveryDuration: 36 * 3600_000, fastestDelivery: { parcelId: 'fast', duration: 22 * 3600_000 },
      originCountries: [{ code: 'FR', count: 2 }, { code: 'DE', count: 1 }] });
  });

  it('does not manufacture durations from partial, invalid, or zero-length histories', () => {
    const stats = passportStatistics([
      parcel('partial', [['out_for_delivery', '2026-08-04T10:00:00Z'], ['delivered', '2026-08-04T12:00:00Z']]),
      parcel('invalid', [['accepted', 'invalid', 'CH'], ['delivered', '2026-08-04T12:00:00Z']]),
      parcel('instant', [['delivered', '2026-08-04T12:00:00Z'], ['accepted', '2026-08-04T12:00:00Z']]),
      parcel('label-only', [['registered', '2026-08-01T10:00:00Z'], ['delivered', '2026-08-04T12:00:00Z']]),
    ]);
    expect(stats.durationSampleCount).toBe(0);
    expect(stats.averageDeliveryDuration).toBeNull();
    expect(stats.fastestDelivery).toBeNull();
  });

  it('lets returns win tied timestamps and excludes them from delivery rewards', () => {
    const stats = passportStatistics([parcel('returned', [
      ['accepted', '2026-08-04T10:00:00Z', 'CH'],
      ['returned', '2026-08-05T12:00:00Z'],
      ['delivered', '2026-08-05T12:00:00Z'],
    ])]);
    expect(stats).toMatchObject({ activeCount: 0, deliveredCount: 0, durationSampleCount: 0 });
  });

  it('does not promote a later destination scan into a known origin', () => {
    const stats = passportStatistics([parcel('unknown', [
      ['pending', '2026-08-01T10:00:00Z', 'France'],
      ['registered', '2026-08-02T10:00:00Z', 'Germany'],
      ['accepted', '2026-08-04T10:00:00Z', 'Warehouse'],
      ['in_transit', '2026-08-04T20:00:00Z', 'Zürich, Switzerland'],
      ['delivered', '2026-08-05T12:00:00Z', 'Zürich, Switzerland'],
    ])]);
    expect(stats.originCountries).toEqual([]);
    expect(stats.durationSampleCount).toBe(1);
  });

  it('keeps an empty passport honest', () => {
    expect(passportStatistics([])).toMatchObject({ deliveredCount: 0, activeCount: 0, carrierCount: 0, fastestDelivery: null, originCountries: [] });
  });
});

describe('explicit origin countries', () => {
  it.each([['Zürich, Schweiz', 'CH'], ['Bâle (Suisse)', 'CH'], ['Milano, Italia', 'IT'], ['Paris; France', 'FR'], ['CH', 'CH'], ['California, US', 'US'], ['DE', 'DE'], ['USA', 'US'], ['London, UK', 'GB']])('reads %s as %s', (location, code) => expect(firstScanCountry(location)).toBe(code));
  it.each(['Paris', 'Basel', 'Los Angeles, CA', 'Wilmington, DE', 'Geneva, GE', 'Depot FR 123', '', undefined])('does not guess from %s', (location) => expect(firstScanCountry(location)).toBeNull());
  it('formats compact elapsed time in the chosen locale', () => {
    expect(formatJourneyDuration(34 * 3600_000, 'en-CH')).toBe('1d 10h');
    expect(formatJourneyDuration(90 * 60_000, 'fr-CH')).toBe('1h 30min');
  });
});

describe('new passport stamps', () => {
  it('uses observed routes and local completion dates, including archived and partial histories', () => {
    const parcels = [
      parcel('international', [
        ['accepted', '2026-10-31T12:00:00Z', 'Berlin, Germany'],
        ['ready_for_pickup', '2026-11-30T12:00:00Z', 'Zurich, Switzerland'],
        ['delivered', '2026-12-01T08:00:00Z', 'Zurich, Switzerland'],
        ['delivered', '2026-12-01T08:10:00Z', 'Zurich, Switzerland'],
      ], { archivedAt: '2026-12-02T12:00:00Z' }),
      parcel('domestic', [['accepted', '2026-11-29T12:00:00Z', 'CH'], ['delivered', '2026-12-01T09:00:00Z', 'CH']]),
      parcel('partial', [['delivered', '2026-11-30T23:30:00Z']]),
    ];
    expect(passportStatistics(parcels, 'Europe/Zurich')).toMatchObject({ crossBorderCount: 1, domesticDeliveryCount: 1,
      longWaitDeliveryCount: 1, pickupDeliveryCount: 1, decemberDeliveryCount: 3, maxDeliveriesInOneDay: 3 });
    expect(passportStatistics(parcels, 'UTC')).toMatchObject({ decemberDeliveryCount: 2, maxDeliveriesInOneDay: 2 });
  });

  it('does not award route or pickup stamps from labels, ambiguous locations, tied scans, or unfinished journeys', () => {
    const stats = passportStatistics([
      parcel('label', [['registered', '2026-11-01T00:00:00Z', 'DE'], ['accepted', '2026-11-02T00:00:00Z'], ['delivered', '2026-11-03T00:00:00Z', 'CH']]),
      parcel('ambiguous', [['accepted', '2026-11-01T00:00:00Z', 'Wilmington, DE'], ['delivered', '2026-11-03T00:00:00Z', 'Geneva, GE']]),
      parcel('tied', [['accepted', '2026-11-01T00:00:00Z', 'DE'], ['ready_for_pickup', '2026-11-01T00:00:00Z', 'CH'], ['delivered', '2026-11-01T00:00:00Z', 'CH']]),
      parcel('waiting', [['accepted', '2026-11-01T00:00:00Z', 'DE'], ['ready_for_pickup', '2026-12-02T00:00:00Z', 'CH']]),
      parcel('returned', [['accepted', '2026-11-01T00:00:00Z', 'DE'], ['delivered', '2026-12-02T00:00:00Z', 'CH'], ['returned', '2026-12-03T00:00:00Z']]),
      parcel('invalid', [['accepted', 'invalid', 'DE'], ['delivered', '2026-12-02T00:00:00Z', 'CH']]),
    ], 'UTC');
    expect(stats).toMatchObject({ crossBorderCount: 0, domesticDeliveryCount: 0, longWaitDeliveryCount: 0, pickupDeliveryCount: 0, decemberDeliveryCount: 0 });
  });

  it('requires more than 30 elapsed days and counts five distinct first-scan countries', () => {
    const countries = ['CH', 'DE', 'FR', 'IT', 'GB'];
    const parcels = countries.map((country, i) => parcel(String(i), [['accepted', '2026-11-01T00:00:00Z', country], ['delivered', '2026-12-01T00:00:00Z']]));
    expect(passportStatistics(parcels, 'UTC')).toMatchObject({ longWaitDeliveryCount: 0 });
    expect(passportStatistics(parcels, 'UTC').originCountries).toHaveLength(5);
    parcels[0].events[1].occurredAt = '2026-12-01T00:00:00.001Z';
    expect(passportStatistics(parcels, 'UTC').longWaitDeliveryCount).toBe(1);
  });
});
