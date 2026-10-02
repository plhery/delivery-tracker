import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TYPING_PAUSE_MS, useTypingPause } from './typingPause';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useTypingPause', () => {
  it('reports a value once typing has rested, and restarts the wait with every change', () => {
    const paused = vi.fn();
    const { rerender, unmount } = renderHook(({ value }) => useTypingPause(value, paused), { initialProps: { value: 'L' } });
    act(() => { vi.advanceTimersByTime(TYPING_PAUSE_MS - 1); });
    rerender({ value: 'LP' });
    act(() => { vi.advanceTimersByTime(TYPING_PAUSE_MS - 1); });
    expect(paused).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(paused.mock.calls).toEqual([['LP']]);
    rerender({ value: 'LP1' });
    unmount();
    act(() => { vi.advanceTimersByTime(TYPING_PAUSE_MS); });
    expect(paused).toHaveBeenCalledOnce();
  });

  it('calls the latest listener', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ listener }) => useTypingPause('1Z', listener), { initialProps: { listener: first } });
    rerender({ listener: second });
    act(() => { vi.advanceTimersByTime(TYPING_PAUSE_MS); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('1Z');
  });
});
