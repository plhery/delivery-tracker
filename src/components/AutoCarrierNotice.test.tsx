import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AutoCarrierNotice } from './AutoCarrierNotice';
import type { Parcel } from '../types';

const now = new Date('2026-09-10T12:00:00Z');
const parcel = { carrier: 'ups', autoChangedFrom: 'dhl', autoChangedTo: 'ups', autoChangedAt: now.toISOString() } as Parcel;
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('shows the old carrier and expires after 12 hours without a refresh', () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  render(<AutoCarrierNotice parcel={parcel} />);
  expect(screen.getByText(/Swapped automatically from DHL/)).toBeTruthy();
  act(() => { vi.advanceTimersByTime(12 * 60 * 60_000); });
  expect(screen.queryByText(/Swapped automatically/)).toBeNull();
});
it.each([
  { autoChangedAt: 'invalid' }, { autoChangedAt: '2026-09-11T12:00:00Z' },
  { autoChangedAt: '2026-09-09T12:00:00Z' }, { carrier: 'fedex' }, { autoChangedFrom: 'ups' },
])('hides expired, invalid, future, or manually superseded corrections: %j', (overrides) => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  render(<AutoCarrierNotice parcel={{ ...parcel, ...overrides } as Parcel} />);
  expect(screen.queryByText(/Swapped automatically/)).toBeNull();
});
