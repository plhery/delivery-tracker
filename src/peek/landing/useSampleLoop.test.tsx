import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_SAMPLE_MS, SAMPLE_BEATS, SAMPLE_PERIOD_MS, useSampleLoop } from './useSampleLoop';

const pass = (milliseconds: number) => act(() => { vi.advanceTimersByTime(milliseconds); });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useSampleLoop', () => {
  it('plays a sample every four seconds: pasted, the carriers asked, one answering, the field cleared', () => {
    const { result } = renderHook(() => useSampleLoop(3, true));
    expect(result.current).toEqual({ index: 0, phase: 'rest' });
    pass(FIRST_SAMPLE_MS - 1);
    expect(result.current.phase).toBe('rest');
    pass(1);
    expect(result.current).toEqual({ index: 0, phase: 'paste' });
    pass(300);
    expect(result.current).toEqual({ index: 0, phase: 'finding' });
    // The carriers are asked for most of a second before one answers.
    pass(899);
    expect(result.current.phase).toBe('finding');
    pass(1);
    expect(result.current).toEqual({ index: 0, phase: 'found' });
    pass(2_400);
    expect(result.current).toEqual({ index: 0, phase: 'clearing' });
    pass(400);
    expect(result.current).toEqual({ index: 1, phase: 'paste' });
    pass(SAMPLE_PERIOD_MS);
    expect(result.current).toEqual({ index: 2, phase: 'paste' });
    // After the last sample the first comes round again.
    pass(SAMPLE_PERIOD_MS);
    expect(result.current).toEqual({ index: 0, phase: 'paste' });
  });

  it('keeps its beats inside the four seconds, in order', () => {
    const starts = SAMPLE_BEATS.map(([, start]) => start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts.at(-1)).toBeLessThan(SAMPLE_PERIOD_MS);
  });

  it('does nothing until it runs', () => {
    const { result } = renderHook(() => useSampleLoop(3, false));
    pass(20_000);
    expect(result.current).toEqual({ index: 0, phase: 'rest' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves the field at rest the moment it stops, and for good', () => {
    const { result, rerender } = renderHook(({ running }) => useSampleLoop(3, running), { initialProps: { running: true } });
    pass(FIRST_SAMPLE_MS + 1_300);
    expect(result.current.phase).toBe('found');
    rerender({ running: false });
    expect(result.current.phase).toBe('rest');
    expect(vi.getTimerCount()).toBe(0);
    pass(20_000);
    expect(result.current.phase).toBe('rest');
  });

  it('goes on with the next sample when it runs again', () => {
    const { result, rerender } = renderHook(({ running }) => useSampleLoop(3, running), { initialProps: { running: true } });
    pass(FIRST_SAMPLE_MS + 500);
    expect(result.current).toEqual({ index: 0, phase: 'finding' });
    rerender({ running: false });
    rerender({ running: true });
    // Nothing of the interrupted sample is left in the field while it waits to start.
    expect(result.current.phase).toBe('rest');
    pass(FIRST_SAMPLE_MS);
    expect(result.current).toEqual({ index: 1, phase: 'paste' });
  });

  it('clears its timer when the page goes', () => {
    const { unmount } = renderHook(() => useSampleLoop(3, true));
    pass(FIRST_SAMPLE_MS + 100);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('has nothing to play without samples', () => {
    const { result } = renderHook(() => useSampleLoop(0, true));
    pass(10_000);
    expect(result.current.phase).toBe('rest');
  });
});
