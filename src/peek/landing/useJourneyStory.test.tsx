import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCAN_MS, useJourneyStory } from './useJourneyStory';

const pass = (milliseconds: number) => act(() => { vi.advanceTimersByTime(milliseconds); });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useJourneyStory', () => {
  it('tells four scans in twelve seconds, then starts over', () => {
    const { result } = renderHook(() => useJourneyStory(4, true));
    expect(result.current).toBe(0);
    for (const scan of [1, 2, 3, 0, 1]) {
      pass(SCAN_MS - 1);
      expect(result.current).not.toBe(scan);
      pass(1);
      expect(result.current).toBe(scan);
    }
  });

  it('holds its scan while it is not playing, and gives it its full time afterwards', () => {
    const { result, rerender } = renderHook(({ playing }) => useJourneyStory(4, playing), { initialProps: { playing: true } });
    pass(SCAN_MS + 2_000);
    expect(result.current).toBe(1);
    rerender({ playing: false });
    expect(vi.getTimerCount()).toBe(0);
    pass(60_000);
    expect(result.current).toBe(1);
    rerender({ playing: true });
    pass(SCAN_MS - 1);
    expect(result.current).toBe(1);
    pass(1);
    expect(result.current).toBe(2);
  });

  it('stays on the first scan until it plays, and has no loop for a single scan', () => {
    const { result } = renderHook(() => useJourneyStory(4, false));
    pass(30_000);
    expect(result.current).toBe(0);
    const single = renderHook(() => useJourneyStory(1, true));
    pass(30_000);
    expect(single.result.current).toBe(0);
  });
});
