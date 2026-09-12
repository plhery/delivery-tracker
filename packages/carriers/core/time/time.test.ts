import { describe, expect, it } from 'vitest';
import { calendarDay, epochMillisTime, epochSecondsTime, explicitOffsetTime, isoTime, zonedTime } from './index';

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
