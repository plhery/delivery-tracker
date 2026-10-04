import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_ID, OWNER_KEY, pendingView, testView } from '../test/parcelLinks';
import type { PeekSession } from './session';

// The parcel's screens stand in as plain words, and arrive when the test lets them.
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), arrive: () => undefined as void, fetched: 0 }));
vi.mock('./links', async (original) => ({ ...await original<typeof import('./links')>(), lookupParcel: mocks.lookup }));
/** The code as the next page will fetch it: it counts the fetch, and arrives when the test says. */
function parcelScreens() {
  vi.doMock('./ParcelScreens', async () => {
    mocks.fetched += 1;
    await new Promise<void>((resolve) => { mocks.arrive = resolve; });
    return {
      ParcelPage: ({ linkId, entrance }: { linkId: string; entrance: string }) => <p>Parcel page {linkId}, {entrance}</p>,
      DeviceParcels: () => <p>On this device</p>,
    };
  });
}

const visitor: PeekSession = { account: 'visitor', signIn: () => undefined };
const root = document.documentElement;
/** Other work on the machine can hold a test back; what is waited for here comes in a moment otherwise. */
const WAIT = { timeout: 10_000 };

/** A page as it loads: its modules run anew, with what the browser holds at that moment. */
async function page() {
  vi.resetModules();
  mocks.fetched = 0;
  parcelScreens();
  const { PeekRoot } = await import('./PeekRoot');
  const { rememberParcel, forgetAllRecents } = await import('./recents');
  return { PeekRoot, rememberParcel, forgetAllRecents };
}

beforeEach(() => { mocks.lookup.mockResolvedValue({ id: LINK_ID, key: OWNER_KEY, view: pendingView() }); });
afterEach(() => { vi.useRealTimers(); vi.doUnmock('./ParcelScreens'); delete root.dataset.entry; localStorage.clear(); history.replaceState(null, '', '/'); });

describe('the parcel screens’ code', () => {
  it('is fetched once the door is live, so a lookup’s answer finds its page ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { PeekRoot } = await page();
    render(<PeekRoot session={visitor} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    expect(mocks.fetched).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(mocks.fetched).toBe(1);
  });

  it('keeps an answer that comes first at the door, and hands it over when the page’s code is here', async () => {
    const { PeekRoot } = await page();
    render(<PeekRoot session={visitor} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Tracking number or link' }), '1234567899');
    await user.click(screen.getByRole('button', { name: 'Track' }));
    await waitFor(() => expect(mocks.fetched).toBe(1), WAIT);
    // The answer is in, the code is not: the address has not moved, and the door still stands.
    expect(location.pathname).toBe('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeInTheDocument();
    await act(async () => { mocks.arrive(); });
    expect(await screen.findByText(`Parcel page ${LINK_ID}, reveal`, {}, WAIT)).toBeVisible();
    expect(location.pathname).toBe(`/p/${LINK_ID}`);
  });

  it('keeps the door at an address that became a parcel’s, until the page can be drawn', async () => {
    const { PeekRoot } = await page();
    render(<PeekRoot session={visitor} />);
    await act(async () => { history.pushState(null, '', `/p/${LINK_ID}`); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeInTheDocument();
    expect(mocks.fetched).toBe(1);
    await act(async () => { mocks.arrive(); });
    expect(await screen.findByText(`Parcel page ${LINK_ID}, direct`, {}, WAIT)).toBeVisible();
  });

  it('brings the list of the device’s parcels to a door that has some', async () => {
    const { PeekRoot, rememberParcel, forgetAllRecents } = await page();
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
    render(<PeekRoot session={visitor} />);
    expect(screen.queryByText('On this device')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.fetched).toBe(1), WAIT);
    await act(async () => { mocks.arrive(); });
    expect(await screen.findByText('On this device', {}, WAIT)).toBeVisible();
    forgetAllRecents();
  });

  it('is asked for at once by a browser marked as having parcels on the device', async () => {
    root.dataset.entry = 'device';
    await page();
    expect(mocks.fetched).toBe(1);
    delete root.dataset.entry;
    await page();
    expect(mocks.fetched).toBe(0);
  });
});
