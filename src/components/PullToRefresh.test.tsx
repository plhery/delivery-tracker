import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PullToRefresh } from './PullToRefresh';

function setup(onRefresh = vi.fn().mockResolvedValue(true)) {
  const click = vi.fn();
  const view = render(<PullToRefresh enabled hidden={false} onRefresh={onRefresh}>
    <button onClick={click}>Parcel</button><input aria-label="Search" />
  </PullToRefresh>);
  const parcel = screen.getByRole('button', { name: 'Parcel' });
  const surface = view.container.querySelector('.pull-refresh')!;
  return { ...view, parcel, surface, onRefresh, click };
}
function start(target: Element, x = 120, y = 100) {
  fireEvent.touchStart(target, { touches: [{ clientX: x, clientY: y, identifier: 1 }] });
}
function move(target: Element, x: number, y: number) {
  return fireEvent.touchMove(target, { touches: [{ clientX: x, clientY: y, identifier: 1 }] });
}
function release(target: Element) { fireEvent.touchEnd(target, { touches: [] }); }

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('PullToRefresh', () => {
  it('requires a deliberate downward release, prevents accidental card clicks, and acknowledges completion', async () => {
    vi.useFakeTimers();
    const { parcel, surface, onRefresh, click } = setup();
    start(parcel);
    expect(move(parcel, 120, 165)).toBe(false);
    expect(surface).not.toHaveAttribute('data-armed');
    release(parcel);
    expect(onRefresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(500));
    start(parcel);
    move(parcel, 120, 290);
    expect(surface).toHaveAttribute('data-armed', 'true');
    // The drag moves the content directly, without an inherited variable on the list.
    const content = surface.querySelector<HTMLElement>('.pull-refresh__content')!;
    expect(content.style.transform).toMatch(/^translate3d\(0(px)?, 8\d\.\d+px, 0(px)?\)$/);
    expect(surface.getAttribute('style')).toBeNull();
    expect(onRefresh).not.toHaveBeenCalled();
    release(parcel);
    fireEvent.click(parcel);
    expect(click).not.toHaveBeenCalled();
    // The request starts after the release motion's first frame.
    expect(onRefresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(surface).toHaveAttribute('data-phase', 'refreshing');
    start(parcel); move(parcel, 120, 300); release(parcel);
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(880));
    expect(surface).toHaveAttribute('data-phase', 'success');
    await act(() => vi.advanceTimersByTimeAsync(1_200));
    expect(surface).toHaveAttribute('data-phase', 'idle');
    expect(content.style.transform).toBe('');
    fireEvent.click(parcel);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('ignores horizontal swipes, upward scrolling, touches away from the top, and form controls', () => {
    const { parcel, onRefresh } = setup();
    start(parcel); expect(move(parcel, 300, 110)).toBe(true); move(parcel, 300, 300); release(parcel);
    start(parcel); expect(move(parcel, 120, 70)).toBe(true); move(parcel, 120, 300); release(parcel);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(80);
    start(parcel); expect(move(parcel, 120, 300)).toBe(true); release(parcel);
    vi.restoreAllMocks();
    const input = screen.getByRole('textbox');
    start(input); expect(move(input, 120, 300)).toBe(true); release(input);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('cancels an armed gesture on touch cancellation, reversal, or a second finger', async () => {
    vi.useFakeTimers();
    const { parcel, onRefresh } = setup();
    start(parcel); move(parcel, 120, 300); fireEvent.touchCancel(parcel); release(parcel);
    await act(() => vi.advanceTimersByTimeAsync(500));
    start(parcel); move(parcel, 120, 300); move(parcel, 120, 120); release(parcel);
    await act(() => vi.advanceTimersByTimeAsync(500));
    start(parcel); move(parcel, 120, 300);
    fireEvent.touchStart(parcel, { touches: [{ identifier: 1 }, { identifier: 2 }] });
    release(parcel);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('labels the wait with reported progress and announces the result', async () => {
    vi.useFakeTimers();
    let finish!: (updated: boolean) => void;
    const onRefresh = vi.fn((report: (status: string) => void) => {
      report('Checking with the carrier…');
      return new Promise<boolean>((resolve) => { finish = resolve; });
    });
    const { parcel, surface } = setup(onRefresh);
    const label = surface.querySelector('.pull-refresh__label')!;
    const announcement = surface.querySelector('[aria-live]')!;
    start(parcel); move(parcel, 120, 300);
    expect(announcement).toHaveTextContent('Release to refresh');
    release(parcel);
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(label).toHaveTextContent('Checking with the carrier…');
    expect(announcement).toHaveTextContent('');
    await act(async () => { finish(true); });
    await act(() => vi.advanceTimersByTimeAsync(880));
    expect(label).toHaveTextContent('Tracking updated');
    expect(announcement).toHaveTextContent('Tracking updated');
    await act(() => vi.advanceTimersByTimeAsync(1_200));
    expect(label).toHaveTextContent('Pull to refresh');
  });

  it('keeps a slow request visible, reports failure without a success check, and permits retry', async () => {
    vi.useFakeTimers();
    let fail!: (error: Error) => void;
    const onRefresh = vi.fn(() => new Promise<boolean>((_, reject) => { fail = reject; }));
    const { parcel, surface, unmount } = setup(onRefresh);
    start(parcel); move(parcel, 120, 300); release(parcel);
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(surface).toHaveAttribute('data-phase', 'refreshing');
    await act(async () => { fail(new Error('Offline')); });
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(surface).toHaveAttribute('data-phase', 'error');
    await act(() => vi.advanceTimersByTimeAsync(1_600));
    start(parcel); move(parcel, 120, 300); release(parcel);
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(onRefresh).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => { fail(new Error('Offline')); });
    expect(document.documentElement).not.toHaveClass('has-pull-refresh');
    expect(vi.getTimerCount()).toBe(0);
  });
});
