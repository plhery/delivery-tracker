import { describe, expect, it } from 'vitest';
import {
  calendarDay, countryTimeZone, epochMillisTime, epochSecondsTime, explicitOffsetTime, isoTime, mislabeledLocalTime,
  mislabeledWallTime, sharedClockZone, zonedTime,
} from './index';

describe('time policies', () => {
  it('keeps explicit offsets and rejects naive values', () => {
    expect(explicitOffsetTime('2026-09-10T08:15:00+01:00')).toEqual({ iso: '2026-09-10T08:15:00+01:00', timestamp: Date.parse('2026-09-10T07:15:00Z') });
    expect(explicitOffsetTime('2026-09-10T08:15:00Z')?.iso).toBe('2026-09-10T08:15:00Z');
    expect(explicitOffsetTime('2026-09-10T08:15:00')).toBeNull();
    expect(explicitOffsetTime(1234)).toBeNull();
  });

  it('reads naive wall-clock values in a declared zone', () => {
    const parsed = zonedTime('2026-01-15 09:30:00', 'yyyy-MM-dd HH:mm:ss', 'Europe/Prague');
    expect(parsed?.iso).toBe('2026-01-15T09:30:00+01:00');
    expect(zonedTime('15/01/2026 09:30:00', 'dd/MM/yyyy HH:mm:ss', 'Europe/Madrid', { locale: 'es-ES' })?.iso).toBe('2026-01-15T09:30:00+01:00');
    expect(zonedTime('not a date', 'yyyy-MM-dd', 'UTC')).toBeNull();
  });

  it('reads ISO values with or without an offset', () => {
    expect(isoTime('2026-07-01T10:00:00', 'Europe/Zurich')?.iso).toBe('2026-07-01T10:00:00+02:00');
    expect(isoTime('2026-07-01T10:00:00-04:00', 'Europe/Zurich')?.iso).toBe('2026-07-01T10:00:00-04:00');
  });

  it('re-reads a local time a provider labeled as UTC or with its own offset', () => {
    // PostNL: a Swiss scan at 09:15 local, sent as "09:15Z".
    expect(mislabeledLocalTime('2026-06-10T09:15:00Z', 'Europe/Zurich')).toEqual({
      iso: '2026-06-10T09:15:00+02:00', timestamp: Date.parse('2026-06-10T07:15:00Z'),
    });
    // ParcelsApp: the same local clock re-labeled "+00:00" or shifted into "+02:00".
    expect(mislabeledLocalTime('2026-06-10T14:05:00+00:00', 'Europe/Zurich')?.iso).toBe('2026-06-10T14:05:00+02:00');
    expect(mislabeledLocalTime('2026-06-10T13:30:00+02:00', 'Europe/Zurich')?.iso).toBe('2026-06-10T11:30:00+02:00');
    expect(mislabeledLocalTime('2026-01-15T09:30:00', 'Asia/Kolkata')?.iso).toBe('2026-01-15T09:30:00+05:30');
    expect(mislabeledLocalTime('not a date', 'UTC')).toBeNull();
  });

  it('exposes the wall clock a mislabeled time is re-read from', () => {
    expect(mislabeledWallTime('2026-06-10T14:05:00+00:00')).toBe('2026-06-10T14:05:00.000');
    expect(mislabeledWallTime('2026-06-10T13:30:00+02:00')).toBe('2026-06-10T11:30:00.000');
    expect(mislabeledWallTime('2026-01-15T09:30:00')).toBe('2026-01-15T09:30:00.000');
    expect(mislabeledWallTime('not a date')).toBeNull();
  });

  it('picks one zone only when every zone reads the wall clock as the same instant', () => {
    const central = ['Europe/Zurich', 'Europe/Paris', 'Europe/Berlin'];
    expect(sharedClockZone(central, '2026-06-10T14:05:00')).toBe('Europe/Zurich');
    expect(sharedClockZone(central, '2026-01-15T09:30:00')).toBe('Europe/Zurich');
    // Around both 2026 DST changes, the skipped and the repeated hour included.
    for (const wall of ['2026-03-29T01:30:00', '2026-03-29T02:30:00', '2026-03-29T03:30:00',
      '2026-10-25T01:30:00', '2026-10-25T02:30:00', '2026-10-25T03:30:00']) {
      expect(sharedClockZone(central, wall)).toBe('Europe/Zurich');
    }
    for (const wall of ['2026-06-10T14:05:00', '2026-01-15T09:30:00', '2026-03-29T00:30:00', '2026-10-25T01:30:00']) {
      expect(sharedClockZone(['Europe/Zurich', 'Europe/London'], wall)).toBeNull();
    }
    expect(sharedClockZone([], '2026-06-10T14:05:00')).toBeNull();
    expect(sharedClockZone(['Europe/Zurich', 'Not/AZone'], '2026-06-10T14:05:00')).toBeNull();
    expect(sharedClockZone(['Europe/Zurich'], 'not a date')).toBeNull();
    // An instant is the same everywhere: that is not a shared clock.
    expect(sharedClockZone(['Europe/Zurich', 'Europe/London'], '2026-06-10T14:05:00Z')).toBeNull();
  });

  it('maps single-zone countries by code or English name only', () => {
    expect(countryTimeZone('CH')).toBe('Europe/Zurich');
    expect(countryTimeZone(' switzerland ')).toBe('Europe/Zurich');
    expect(countryTimeZone('India')).toBe('Asia/Kolkata');
    expect(countryTimeZone('US')).toBeNull();
    expect(countryTimeZone('Canada')).toBeNull();
    expect(countryTimeZone(undefined)).toBeNull();
  });

  it('accepts epoch values only when positive and finite', () => {
    expect(epochMillisTime(1_760_000_000_000)?.iso).toBe('2025-10-09T08:53:20Z');
    expect(epochMillisTime('1760000000000')?.timestamp).toBe(1_760_000_000_000);
    expect(epochMillisTime(0)).toBeNull();
    expect(epochMillisTime('')).toBeNull();
    expect(epochSecondsTime(1_760_000_000)?.iso).toBe('2025-10-09T08:53:20Z');
  });

  it('validates calendar days', () => {
    expect(calendarDay(2026, 2, 29)).toBeNull();
    expect(calendarDay(2026, 1, 1)).toBe('2026-01-01');
    expect(calendarDay(2026, 1.5, 1)).toBeNull();
  });
});
