import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiAuthenticationError } from '../lib/apiClient';
import { createDemoRepo } from '../store/demoRepo';
import { LINK_ID, OTHER_LINK_ID, OWNER_KEY, testView } from '../test/parcelLinks';
import { createDemoLinks, ParcelLinkError, type ParcelLinksClient } from './links';
import {
  announceKeepOutcome,
  clearPendingKeep,
  keepParcelLink,
  keepPendingInDemo,
  keepPendingParcel,
  onKeepOutcome,
  PENDING_KEEP_STORAGE_KEY,
  pendingKeep,
  rememberPendingKeep,
  type KeepOutcome,
} from './pending';
import { forgetAllRecents, recentFor, rememberParcel, renameParcel } from './recents';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  demo: null as ParcelLinksClient | null,
}));
vi.mock('./links', async (original) => ({
  ...await original<typeof import('./links')>(),
  claimParcelLinks: mocks.claim,
  readParcelLink: (...call: Parameters<ParcelLinksClient['readParcelLink']>) => mocks.demo!.readParcelLink(...call),
  forgetParcelLink: (...call: Parameters<ParcelLinksClient['forgetParcelLink']>) => mocks.demo!.forgetParcelLink(...call),
}));

const auth = { userId: 'user-1', getAccessToken: async () => 'token' };
let heard: KeepOutcome[] = [];
let stop = () => {};

beforeEach(() => {
  mocks.claim.mockReset();
  heard = [];
  stop = onKeepOutcome((outcome) => heard.push(outcome));
});
afterEach(() => { stop(); clearPendingKeep(); forgetAllRecents(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe('the note of a parcel to keep', () => {
  it('lasts for this tab, for a day, and holds only the link id', () => {
    const now = Date.parse('2026-10-02T08:00:00Z');
    expect(pendingKeep(now)).toBeNull();
    rememberPendingKeep(LINK_ID, now);
    expect(pendingKeep(now)).toBe(LINK_ID);
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEEP_STORAGE_KEY)!)).toEqual({ id: LINK_ID, at: now });
    expect(localStorage.getItem(PENDING_KEEP_STORAGE_KEY)).toBeNull();
    expect(pendingKeep(now + 24 * 3_600_000 - 1)).toBe(LINK_ID);
    expect(pendingKeep(now + 24 * 3_600_000)).toBeNull();
    expect(pendingKeep(now - 1)).toBeNull();
    rememberPendingKeep('not a link', now);
    expect(pendingKeep(now)).toBe(LINK_ID);
  });

  it('is dropped on request, for a given link only when it is the noted one', () => {
    rememberPendingKeep(LINK_ID);
    clearPendingKeep(OTHER_LINK_ID);
    expect(pendingKeep()).toBe(LINK_ID);
    clearPendingKeep(LINK_ID);
    expect(pendingKeep()).toBeNull();
    sessionStorage.setItem(PENDING_KEEP_STORAGE_KEY, '{broken');
    expect(pendingKeep()).toBeNull();
  });

  it('survives storage that refuses, for as long as the page lives', () => {
    const denied = () => { throw new DOMException('denied', 'SecurityError'); };
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(denied);
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(denied);
    vi.spyOn(window.sessionStorage, 'removeItem').mockImplementation(denied);
    rememberPendingKeep(LINK_ID);
    expect(pendingKeep()).toBe(LINK_ID);
    clearPendingKeep();
    expect(pendingKeep()).toBeNull();
  });
});

describe('keep outcomes', () => {
  it('reach every listener, and wait for the first one when nobody listens yet', () => {
    const outcome: KeepOutcome = { id: LINK_ID, outcome: 'kept', packageId: 'p1', name: null };
    announceKeepOutcome(outcome);
    expect(heard).toEqual([outcome]);
    stop();
    announceKeepOutcome({ ...outcome, outcome: 'already' });
    const late: KeepOutcome[] = [];
    const stopLate = onKeepOutcome((next) => late.push(next));
    expect(late).toEqual([{ ...outcome, outcome: 'already' }]);
    stopLate();
    const later: KeepOutcome[] = [];
    onKeepOutcome((next) => later.push(next))();
    expect(later).toEqual([]);
  });
});

describe('keeping after sign-in', () => {
  it('claims the noted parcel once with the device’s key and name, then drops the device’s copy', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
    renameParcel(LINK_ID, 'New sneakers');
    rememberPendingKeep(LINK_ID);
    let answer: (results: unknown) => void = () => undefined;
    mocks.claim.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const first = keepPendingParcel(auth);
    // A second render, or StrictMode's second effect, must not claim again.
    expect(await keepPendingParcel(auth)).toBeNull();
    answer([{ id: LINK_ID, outcome: 'kept', packageId: 'p1' }]);
    const outcome = { id: LINK_ID, outcome: 'kept', packageId: 'p1', name: 'New sneakers' };
    expect(await first).toEqual(outcome);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.claim).toHaveBeenCalledWith([{ id: LINK_ID, key: OWNER_KEY, label: 'New sneakers' }], auth, undefined);
    expect(heard).toEqual([outcome]);
    expect(recentFor(LINK_ID)).toBeNull();
    expect(pendingKeep()).toBeNull();
    expect(await keepPendingParcel(auth)).toBeNull();
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it('drops the device’s copy for a parcel the account already follows, and keeps it when the account cannot take it', async () => {
    for (const [result, kept] of [['already', false], ['quota', true], ['unavailable', true]] as const) {
      rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
      rememberPendingKeep(LINK_ID);
      mocks.claim.mockResolvedValueOnce([{ id: LINK_ID, outcome: result }]);
      expect(await keepPendingParcel(auth)).toMatchObject({ outcome: result });
      expect(recentFor(LINK_ID) !== null).toBe(kept);
      // The server answered: asking again would not change it.
      expect(pendingKeep()).toBeNull();
    }
    expect(heard.map(({ outcome }) => outcome)).toEqual(['already', 'quota', 'unavailable']);
  });

  it('keeps a link without a device copy by its id alone, and reads no answer as unavailable', async () => {
    mocks.claim.mockResolvedValueOnce([{ id: LINK_ID, outcome: 'kept', packageId: 'p1' }]).mockResolvedValueOnce([]);
    expect(await keepParcelLink(LINK_ID, auth)).toEqual({ id: LINK_ID, outcome: 'kept', packageId: 'p1', name: null });
    expect(mocks.claim).toHaveBeenCalledWith([{ id: LINK_ID, key: undefined, label: undefined }], auth, undefined);
    expect(await keepParcelLink(LINK_ID, auth)).toEqual({ id: LINK_ID, outcome: 'unavailable', name: null });
    // Keeping from the page itself says nothing to the deliveries app.
    expect(heard).toEqual([]);
  });

  it('leaves the note for the next visit when no answer comes, and says nothing when the sign-in ended', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
    rememberPendingKeep(LINK_ID);
    mocks.claim.mockRejectedValueOnce(new ParcelLinkError('offline'));
    expect(await keepPendingParcel(auth)).toEqual({ id: LINK_ID, outcome: 'failed', name: null });
    expect(pendingKeep()).toBe(LINK_ID);
    expect(recentFor(LINK_ID)).not.toBeNull();

    mocks.claim.mockRejectedValueOnce(new ApiAuthenticationError());
    expect(await keepPendingParcel(auth)).toBeNull();
    const ended = new AbortController();
    mocks.claim.mockImplementationOnce(async () => { ended.abort(); throw ended.signal.reason; });
    expect(await keepPendingParcel({ ...auth, signal: ended.signal })).toBeNull();
    expect(heard.map(({ outcome }) => outcome)).toEqual(['failed']);
    expect(pendingKeep()).toBe(LINK_ID);
  });
});

describe('keeping in the demo', () => {
  beforeEach(() => { mocks.demo = createDemoLinks(window.localStorage); });

  async function lookedUp(name?: string) {
    const lookup = await mocks.demo!.lookupParcel({ trackingNumber: '1ZDEMO202600000009' });
    const view = await mocks.demo!.readParcelLink(lookup.id, { key: lookup.key, advance: true });
    if (view === 'unavailable') throw new Error('The demo link should exist');
    rememberParcel({ id: lookup.id, key: lookup.key, view, name });
    return lookup;
  }

  it('moves the noted parcel, with its history and name, into the demo deliveries and forgets the device copy', async () => {
    const repo = createDemoRepo(window.localStorage);
    const { id, key } = await lookedUp('Kind of Blue');
    expect(await keepPendingInDemo(repo)).toBeNull();
    rememberPendingKeep(id);
    const outcome = await keepPendingInDemo(repo);
    expect(outcome).toMatchObject({ id, outcome: 'kept', name: 'Kind of Blue' });
    const kept = (await repo.list()).find((parcel) => parcel.id === outcome!.packageId)!;
    expect(kept).toMatchObject({ trackingNumber: '1ZDEMO202600000009', label: 'Kind of Blue', carrier: 'ups' });
    expect(kept.events.map((event) => event.stage)).toEqual(['registered', 'accepted', 'in_transit']);
    expect(recentFor(id)).toBeNull();
    expect(await mocks.demo!.readParcelLink(id, { key })).toBe('unavailable');
    expect(pendingKeep()).toBeNull();
    expect(heard).toEqual([outcome]);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('answers “already” for a number the demo deliveries hold, and falls back to adding by number', async () => {
    const repo = createDemoRepo(window.localStorage);
    const first = await lookedUp();
    rememberPendingKeep(first.id);
    const { packageId } = (await keepPendingInDemo(repo))!;
    const again = await lookedUp();
    rememberPendingKeep(again.id);
    expect(await keepPendingInDemo(repo)).toMatchObject({ outcome: 'already', packageId });
    expect(recentFor(again.id)).toBeNull();

    const plain = { ...createDemoRepo(window.localStorage), adopt: undefined };
    await plain.deletePermanently!(packageId!);
    const third = await lookedUp('By number');
    rememberPendingKeep(third.id);
    expect(await keepPendingInDemo(plain)).toMatchObject({ outcome: 'kept' });
    expect((await plain.list()).find((parcel) => parcel.label === 'By number')?.events.map((event) => event.stage)).toEqual(['pending']);
  });

  it('keeps nothing for a link that is gone or that this device only views', async () => {
    const repo = createDemoRepo(window.localStorage);
    const before = (await repo.list()).length;
    rememberPendingKeep(LINK_ID);
    expect(await keepPendingInDemo(repo)).toEqual({ id: LINK_ID, outcome: 'unavailable', name: null });
    expect(pendingKeep()).toBeNull();

    const { id } = await mocks.demo!.lookupParcel({ trackingNumber: '1ZDEMO202600000002' });
    rememberPendingKeep(id);
    expect(await keepPendingInDemo(repo)).toMatchObject({ outcome: 'unavailable' });
    expect(await repo.list()).toHaveLength(before);
  });

  it('reports a failure without losing the note', async () => {
    const { id } = await lookedUp();
    rememberPendingKeep(id);
    const broken = { ...createDemoRepo(window.localStorage), adopt: async () => { throw new Error('storage is full'); } };
    expect(await keepPendingInDemo(broken)).toMatchObject({ id, outcome: 'failed' });
    expect(pendingKeep()).toBe(id);
    expect(recentFor(id)).not.toBeNull();
  });
});
