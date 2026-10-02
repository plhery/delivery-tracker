import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiAuth } from '../../lib/apiClient';
import { createDemoRepo } from '../../store/demoRepo';
import { LINK_ID, OTHER_LINK_ID, OWNER_KEY, testView } from '../../test/parcelLinks';
import { clearPendingKeep, rememberPendingKeep } from '../pending';
import { forgetAllRecents, forgetRecent, recentFor, rememberParcel, renameParcel, useRecents } from '../recents';
import { BringAlongInDemo, BringAlongParcels } from './BringAlong';
import { bringable, BRING_ALONG_STORAGE_KEY, bringAlong, bringAlongInDemo, markOffered, offeredParcels } from './deviceParcels';

const mocks = vi.hoisted(() => ({ claim: vi.fn(), read: vi.fn(), forget: vi.fn(), retryLoad: vi.fn() }));
vi.mock('../links', async (original) => ({
  ...await original<typeof import('../links')>(),
  claimParcelLinks: mocks.claim,
  readParcelLink: mocks.read,
  forgetParcelLink: mocks.forget,
}));
vi.mock('../../store/ParcelsContext', () => ({ useParcels: () => ({ retryLoad: mocks.retryLoad }) }));

const THIRD_LINK_ID = 'p4Rs9tUv2WxY';
const auth: ApiAuth = { userId: 'user-1', getAccessToken: async () => 'token' };
const ups = (id: string) => testView({ id, parcel: { carrier: 'ups', trackingNumber: '1ZDEMO202600000009', expectedDelivery: '2099-01-05' } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.forget.mockResolvedValue(undefined);
  rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView(), name: 'Coffee beans', now: 3 });
  rememberParcel({ id: OTHER_LINK_ID, key: OWNER_KEY, view: ups(OTHER_LINK_ID), now: 2 });
  // A link someone else shared has no key on this device: it is not this device's to bring.
  rememberParcel({ id: THIRD_LINK_ID, view: testView({ id: THIRD_LINK_ID, owner: false }), now: 1 });
});
afterEach(() => { forgetAllRecents(); clearPendingKeep(); });

const sheet = () => screen.getByRole('dialog', { name: 'Bring these parcels too?' });

describe('BringAlong', () => {
  it('offers the parcels this device looked up, each with its name or number and its status, and takes them with one request', async () => {
    mocks.claim.mockResolvedValue([{ id: LINK_ID, outcome: 'kept', packageId: 'p1' }, { id: OTHER_LINK_ID, outcome: 'already', packageId: 'p2' }]);
    const user = userEvent.setup();
    render(<BringAlongParcels auth={auth} />);
    expect(sheet()).toHaveAccessibleDescription('You looked them up on this device before signing in.');
    const rows = within(sheet()).getAllByRole('checkbox');
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => (row as HTMLInputElement).checked)).toBe(true);
    expect(within(sheet()).getByLabelText(/Coffee beans/)).toBeInTheDocument();
    expect(within(sheet()).getByLabelText(/1ZDEMO2…0009.*In transit · Expected: /)).toBeInTheDocument();
    expect(sheet()).not.toHaveTextContent('1ZDEMO202600000009');
    await user.click(within(sheet()).getByRole('button', { name: 'Add 2 parcels' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.claim).toHaveBeenCalledExactlyOnceWith([
      { id: LINK_ID, key: OWNER_KEY, label: 'Coffee beans' }, { id: OTHER_LINK_ID, key: OWNER_KEY, label: null },
    ], auth, undefined);
    // What the account has leaves the device; a shared link stays.
    expect(recentFor(LINK_ID)).toBeNull();
    expect(recentFor(OTHER_LINK_ID)).toBeNull();
    expect(recentFor(THIRD_LINK_ID)).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('2 parcels added to your deliveries');
    expect(mocks.retryLoad).toHaveBeenCalledOnce();
  });

  it('brings only what stays ticked, and does not ask about the rest again', async () => {
    mocks.claim.mockResolvedValue([{ id: LINK_ID, outcome: 'kept', packageId: 'p1' }]);
    const user = userEvent.setup();
    const { unmount } = render(<BringAlongParcels auth={auth} />);
    await user.click(within(sheet()).getByLabelText(/1ZDEMO2…0009/));
    await user.click(within(sheet()).getByRole('button', { name: 'Add 1 parcel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.claim.mock.calls[0][0]).toEqual([{ id: LINK_ID, key: OWNER_KEY, label: 'Coffee beans' }]);
    expect(screen.getByRole('status')).toHaveTextContent('1 parcel added to your deliveries');
    expect(recentFor(OTHER_LINK_ID)).not.toBeNull();
    unmount();
    render(<BringAlongParcels auth={auth} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect([...offeredParcels()].sort()).toEqual([LINK_ID, OTHER_LINK_ID].sort());
  });

  it('keeps everything on the device on “Not now”, and never asks about those parcels again', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<BringAlongParcels auth={auth} />);
    await user.click(within(sheet()).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(recentFor(LINK_ID)).not.toBeNull();
    unmount();
    render(<BringAlongParcels auth={auth} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    // A parcel looked up later is asked about on its own.
    const later = 'q5St2uVw3XyZ';
    act(() => rememberParcel({ id: later, key: OWNER_KEY, view: testView({ id: later }) }));
    expect(within(sheet()).getAllByRole('checkbox')).toHaveLength(1);
  });

  it('cannot add nothing, and says so when the request fails, keeping the choice', async () => {
    mocks.claim.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([{ id: LINK_ID, outcome: 'quota' }, { id: OTHER_LINK_ID, outcome: 'unavailable' }]);
    const user = userEvent.setup();
    render(<BringAlongParcels auth={auth} />);
    for (const row of within(sheet()).getAllByRole('checkbox')) await user.click(row);
    expect(within(sheet()).getByRole('button', { name: 'Add 0 parcels' })).toBeDisabled();
    for (const row of within(sheet()).getAllByRole('checkbox')) await user.click(row);
    await user.click(within(sheet()).getByRole('button', { name: 'Add 2 parcels' }));
    expect(await within(sheet()).findByRole('alert')).toHaveTextContent('Couldn’t add these parcels. Try again.');
    expect(recentFor(LINK_ID)).not.toBeNull();
    // A full account or a link that is gone brings nothing, and says nothing was added.
    await user.click(within(sheet()).getByRole('button', { name: 'Add 2 parcels' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('status')).toBeNull();
    expect(recentFor(LINK_ID)).not.toBeNull();
    expect(mocks.retryLoad).not.toHaveBeenCalled();
  });

  it('waits for the parcel that is being kept on its own, lets the deliveries say so first, and leaves it out', async () => {
    vi.useFakeTimers();
    rememberPendingKeep(LINK_ID);
    render(<BringAlongParcels auth={auth} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.queryByRole('dialog')).toBeNull();
    // The parcel is kept: its copy leaves the device and the note is dropped.
    act(() => { forgetRecent(LINK_ID); clearPendingKeep(LINK_ID); });
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
    expect(within(sheet()).getAllByRole('checkbox')).toHaveLength(1);
    expect(sheet()).toHaveTextContent('1ZDEMO2…0009');
    vi.useRealTimers();
  });

  it('moves the chosen parcels into the demo deliveries with their history and name, and forgets their links', async () => {
    const repo = createDemoRepo(window.localStorage);
    const before = (await repo.list()).length;
    mocks.read.mockImplementation(async (id: string) => id === LINK_ID ? testView({ parcel: { trackingNumber: 'DEMOTEST20260009' } }) : ups(OTHER_LINK_ID));
    const user = userEvent.setup();
    render(<BringAlongInDemo repo={repo} />);
    await user.click(within(sheet()).getByRole('button', { name: 'Add 2 parcels' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const parcels = await repo.list();
    expect(parcels).toHaveLength(before + 2);
    expect(parcels.find((parcel) => parcel.label === 'Coffee beans')).toMatchObject({ trackingNumber: 'DEMOTEST20260009', events: expect.objectContaining({ length: 2 }) });
    expect(mocks.forget).toHaveBeenCalledWith(LINK_ID, OWNER_KEY);
    expect(mocks.forget).toHaveBeenCalledWith(OTHER_LINK_ID, OWNER_KEY);
    expect(recentFor(LINK_ID)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('2 parcels added to your deliveries');
  });
});

describe('the device’s parcels to bring along', () => {
  function recents() {
    let list: ReturnType<typeof useRecents> = [];
    function Probe() { list = useRecents(); return null; }
    render(<Probe />);
    return list;
  }

  it('are the ones looked up here, without the one being kept and the ones already offered', () => {
    const all = recents();
    expect(bringable(all, null).map((recent) => recent.id)).toEqual([LINK_ID, OTHER_LINK_ID]);
    expect(bringable(all, LINK_ID).map((recent) => recent.id)).toEqual([OTHER_LINK_ID]);
    markOffered([OTHER_LINK_ID]);
    expect(bringable(all, null).map((recent) => recent.id)).toEqual([LINK_ID]);
    expect(JSON.parse(window.localStorage.getItem(BRING_ALONG_STORAGE_KEY)!)).toEqual([OTHER_LINK_ID]);
  });

  it('remember what was offered for the page’s life when storage cannot, and read a damaged list as empty', () => {
    window.localStorage.setItem(BRING_ALONG_STORAGE_KEY, '{not json');
    expect(offeredParcels().size).toBe(0);
    window.localStorage.setItem(BRING_ALONG_STORAGE_KEY, JSON.stringify({ not: 'a list' }));
    expect(offeredParcels().size).toBe(0);
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('full'); });
    markOffered([LINK_ID]);
    expect(offeredParcels().has(LINK_ID)).toBe(true);
    setItem.mockRestore();
    // Storage works again: the list goes back to it.
    markOffered([OTHER_LINK_ID]);
    expect(JSON.parse(window.localStorage.getItem(BRING_ALONG_STORAGE_KEY)!)).toEqual([LINK_ID, OTHER_LINK_ID]);
  });

  it('count what the account took, and leave the rest on the device', async () => {
    mocks.claim.mockResolvedValue([{ id: LINK_ID, outcome: 'kept', packageId: 'p1' }, { id: OTHER_LINK_ID, outcome: 'quota' }]);
    expect(await bringAlong([recentFor(LINK_ID)!, recentFor(OTHER_LINK_ID)!], auth)).toBe(1);
    expect(recentFor(LINK_ID)).toBeNull();
    expect(recentFor(OTHER_LINK_ID)).not.toBeNull();
  });

  it('in the demo, skip a link that is gone, count a parcel the demo already has, and fall back to the device’s last answer', async () => {
    const repo = createDemoRepo(window.localStorage);
    renameParcel(LINK_ID, null);
    mocks.read.mockResolvedValueOnce('unavailable').mockRejectedValueOnce(new Error('unreadable'));
    expect(await bringAlongInDemo([recentFor(LINK_ID)!, recentFor(OTHER_LINK_ID)!], repo)).toBe(1);
    expect(recentFor(LINK_ID)).not.toBeNull();
    expect(recentFor(OTHER_LINK_ID)).toBeNull();
    // The same number again: the demo has it, and the device copy goes all the same.
    rememberParcel({ id: OTHER_LINK_ID, key: OWNER_KEY, view: ups(OTHER_LINK_ID) });
    mocks.read.mockResolvedValue(ups(OTHER_LINK_ID));
    expect(await bringAlongInDemo([recentFor(OTHER_LINK_ID)!], repo)).toBe(1);
    expect(recentFor(OTHER_LINK_ID)).toBeNull();
    // A repository without `adopt` adds the number, and a failure other than a duplicate is the caller's.
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
    mocks.read.mockResolvedValue(testView());
    const add = vi.fn(async () => { throw new Error('storage full'); });
    await expect(bringAlongInDemo([recentFor(LINK_ID)!], { ...repo, adopt: undefined, add })).rejects.toThrow('storage full');
    expect(add).toHaveBeenCalledWith({ trackingNumber: '1234567899', label: '', carrier: 'dhl' });
  });
});
