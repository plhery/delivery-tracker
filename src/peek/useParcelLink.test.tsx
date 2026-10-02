import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_ID, OWNER_KEY, pendingView, testView } from '../test/parcelLinks';
import { ParcelLinkError, type ParcelLinkRead } from './links';
import { forgetAllRecents, recentFor, rememberParcel, renameParcel } from './recents';
import { firstCheckLanded, useParcelLink } from './useParcelLink';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./links', async (original) => ({
  ...await original<typeof import('./links')>(),
  readParcelLink: mocks.read,
}));

let hidden = false;
function setHidden(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}
/** Lets the pending reads settle, then moves the clock. */
async function pass(milliseconds: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}
const answers = (...results: (ParcelLinkRead | Error)[]) => {
  for (const result of results) {
    if (result instanceof Error) mocks.read.mockRejectedValueOnce(result);
    else mocks.read.mockResolvedValueOnce(result);
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.read.mockReset();
  mocks.read.mockResolvedValue(testView());
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  forgetAllRecents();
  history.replaceState(null, '', '/');
});

describe('useParcelLink', () => {
  it('opens a link directly: reads at once, remembers the parcel, then reads every 30 seconds', async () => {
    const hook = renderHook(() => useParcelLink(LINK_ID));
    expect(hook.result.current).toMatchObject({ status: 'loading', view: null, live: true, checking: false });
    await pass(0);
    expect(hook.result.current).toMatchObject({ status: 'ready', view: testView(), trouble: null, checking: false });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenLastCalledWith(LINK_ID, expect.objectContaining({ key: undefined, advance: false }));
    expect(recentFor(LINK_ID)).toMatchObject({ key: null, stage: 'in_transit' });
    await pass(29_999);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await pass(1);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await pass(30_000);
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });

  it('after a lookup, waits 2 s and backs off to 10 s until the first check lands, then settles at 30 s', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: pendingView() });
    answers(pendingView(), pendingView(), pendingView(), pendingView(), pendingView(), pendingView());
    const hook = renderHook(() => useParcelLink(LINK_ID, pendingView()));
    expect(hook.result.current).toMatchObject({ status: 'ready', checking: true, live: true });
    expect(firstCheckLanded(hook.result.current.view!)).toBe(false);
    expect(mocks.read).not.toHaveBeenCalled();
    const waits = [2_000, 3_000, 4_500, 6_750, 10_000, 10_000];
    for (const [index, wait] of waits.entries()) {
      await pass(wait - 1);
      expect(mocks.read).toHaveBeenCalledTimes(index);
      await pass(1);
      expect(mocks.read).toHaveBeenCalledTimes(index + 1);
    }
    // The owner key this device holds goes with every read.
    expect(mocks.read).toHaveBeenLastCalledWith(LINK_ID, expect.objectContaining({ key: OWNER_KEY }));
    expect(hook.result.current.checking).toBe(true);
    // The seventh read is the default answer: the story has landed.
    await pass(10_000);
    expect(hook.result.current).toMatchObject({ checking: false, view: testView() });
    await pass(29_999);
    expect(mocks.read).toHaveBeenCalledTimes(7);
    await pass(1);
    expect(mocks.read).toHaveBeenCalledTimes(8);
  });

  it('stops while the tab is hidden and catches up when it is shown again', async () => {
    const hook = renderHook(() => useParcelLink(LINK_ID));
    await pass(0);
    act(() => setHidden(true));
    expect(hook.result.current.live).toBe(false);
    await pass(120_000);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    act(() => setHidden(false));
    expect(hook.result.current.live).toBe(true);
    await pass(0);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await pass(30_000);
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });

  it('gets its first answer even when it opens in a hidden tab, without polling there', async () => {
    hidden = true;
    const hook = renderHook(() => useParcelLink(LINK_ID));
    await pass(0);
    expect(hook.result.current).toMatchObject({ status: 'ready', live: false });
    await pass(120_000);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it('shows the device’s last answer while offline, keeps trying, and recovers', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
    renameParcel(LINK_ID, 'New sneakers');
    answers(new ParcelLinkError('offline'), new TypeError('unexpected'));
    const hook = renderHook(() => useParcelLink(LINK_ID));
    expect(hook.result.current).toMatchObject({ status: 'ready', view: testView(), name: 'New sneakers' });
    await pass(0);
    expect(hook.result.current).toMatchObject({ status: 'ready', view: testView(), trouble: { kind: 'offline' } });
    await pass(2_000);
    expect(hook.result.current.trouble).toMatchObject({ kind: 'server' });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await pass(0);
    expect(hook.result.current).toMatchObject({ status: 'ready', trouble: null });
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });

  it('waits as long as a limit asks before reading again', async () => {
    answers(testView(), new ParcelLinkError('burst', { retryAfterSeconds: 45 }));
    const hook = renderHook(() => useParcelLink(LINK_ID));
    await pass(30_000);
    expect(hook.result.current.trouble).toMatchObject({ kind: 'burst' });
    await pass(44_999);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await pass(1);
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });

  it('stays loading with the reason when a first answer cannot come', async () => {
    answers(new ParcelLinkError('offline'));
    const hook = renderHook(() => useParcelLink(LINK_ID));
    await pass(0);
    expect(hook.result.current).toMatchObject({ status: 'loading', view: null, trouble: { kind: 'offline' } });
  });

  it('ends at a link that leads nowhere: no more reads, and the device’s copy goes', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
    answers('unavailable');
    const hook = renderHook(() => useParcelLink(LINK_ID));
    await pass(0);
    expect(hook.result.current).toMatchObject({ status: 'unavailable', view: null, name: null, live: false });
    expect(recentFor(LINK_ID)).toBeNull();
    await pass(120_000);
    act(() => setHidden(true));
    act(() => setHidden(false));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await pass(0);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it('checks on request with `advance`, and restarts the clock from that answer', async () => {
    const hook = renderHook(() => useParcelLink(LINK_ID));
    await pass(20_000);
    const delivered = testView({ stages: ['registered', 'in_transit', 'delivered'] });
    let answer: (view: ParcelLinkRead) => void = () => undefined;
    mocks.read.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    let refreshed: Promise<void> = Promise.resolve();
    act(() => { refreshed = hook.result.current.refresh(); });
    expect(hook.result.current.refreshing).toBe(true);
    expect(mocks.read).toHaveBeenLastCalledWith(LINK_ID, expect.objectContaining({ advance: true }));
    await act(async () => { answer(delivered); await refreshed; });
    expect(hook.result.current).toMatchObject({ refreshing: false, view: delivered });
    await pass(29_999);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await pass(1);
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });

  it('takes the name in the address once, saves it for a parcel without a name, and leaves the address alone', async () => {
    history.replaceState(null, '', `/p/${LINK_ID}#n=${encodeURIComponent('From Ada')}`);
    answers(testView({ owner: false }));
    const hook = renderHook(() => useParcelLink(LINK_ID));
    expect(hook.result.current.name).toBe('From Ada');
    await pass(0);
    expect(recentFor(LINK_ID)).toMatchObject({ name: 'From Ada', key: null });
    expect(location.hash).toBe(`#n=${encodeURIComponent('From Ada')}`);
    act(() => renameParcel(LINK_ID, 'My own name'));
    expect(hook.result.current.name).toBe('My own name');
    await pass(30_000);
    expect(recentFor(LINK_ID)!.name).toBe('My own name');
  });

  it('stops reading when the page closes, and ignores an answer that arrives afterwards', async () => {
    let answer: (view: ParcelLinkRead) => void = () => undefined;
    mocks.read.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const hook = renderHook(() => useParcelLink(LINK_ID));
    const signal = mocks.read.mock.calls[0][1].signal as AbortSignal;
    hook.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { answer(testView()); });
    await pass(120_000);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(recentFor(LINK_ID)).toBeNull();
  });
});
