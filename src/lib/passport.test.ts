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
