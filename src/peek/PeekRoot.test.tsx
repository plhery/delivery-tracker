import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../test/parcelCode';
import { LINK_ID, OWNER_KEY, pendingView, testView } from '../test/parcelLinks';
import { PeekRoot } from './PeekRoot';
import { forgetAllRecents, recentFor, RECENTS_STORAGE_KEY } from './recents';
import { usePeekSession, type PeekSession } from './session';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), read: vi.fn() }));
vi.mock('./links', async (original) => ({
  ...await original<typeof import('./links')>(),
  lookupParcel: mocks.lookup,
  readParcelLink: mocks.read,
}));

const signIn = vi.fn();
const visitor: PeekSession = { account: 'visitor', signIn };
const moved = () => new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));

async function track() {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Tracking number or link' }), '1234567899');
  await user.click(screen.getByRole('button', { name: 'Track' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue({ id: LINK_ID, key: OWNER_KEY, view: pendingView() });
  mocks.read.mockResolvedValue(testView());
});
afterEach(() => {
  forgetAllRecents();
  vi.unstubAllGlobals();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  history.replaceState(null, '', '/');
});

describe('PeekRoot', () => {
  it('shows the front door at / and passes its sign-in button to the session', async () => {
    render(<PeekRoot session={visitor} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signIn).toHaveBeenCalledWith();
  });

  it('hands a lookup over: the key is saved, the address becomes the parcel’s, the page opens revealed', async () => {
    render(<PeekRoot session={visitor} />);
    const entries = history.length;
    await track();
    await waitFor(() => expect(location.pathname).toBe(`/p/${LINK_ID}`));
    expect(history.length).toBe(entries + 1);
    expect(recentFor(LINK_ID)).toMatchObject({ key: OWNER_KEY, syncStatus: 'pending' });
    expect(document.querySelector('.peekp-main')).toHaveAttribute('data-entrance', 'reveal');
    // The page starts from the lookup's answer instead of reading again.
    expect(screen.getByRole('heading', { level: 1, name: 'Checking for updates' })).toBeVisible();
    expect(mocks.read).not.toHaveBeenCalled();
    // The door waits under the page, started over: its field is empty again, and it lists the parcel.
    const door = document.querySelector<HTMLElement>('.door')!;
    expect(door).toHaveAttribute('inert');
    expect(within(door).getByLabelText('Tracking number or link')).toHaveValue('');
    expect(door.querySelector(`[data-parcel-link="${LINK_ID}"]`)).toHaveAttribute('href', `/p/${LINK_ID}`);
    expect(screen.getByRole('dialog', { name: 'Parcel details' })).toContainElement(document.querySelector('.peekp-main'));
  });

  it('opens a parcel of the device over the door, and closes it back to the door’s own step in the history', async () => {
    const user = userEvent.setup();
    render(<PeekRoot session={visitor} />);
    await track();
    await waitFor(() => expect(location.pathname).toBe(`/p/${LINK_ID}`));
    let waiting = moved();
    history.back();
    await act(() => waiting);
    const entries = history.length;
    const title = document.title;
    await user.click(screen.getByRole('link', { name: /DHL/ }));
    expect(location.pathname).toBe(`/p/${LINK_ID}`);
    expect(history.state).toEqual({ peekDoorSteps: 1 });
    const page = screen.getByRole('dialog', { name: 'Parcel details' });
    expect(document.querySelector('.door')).toHaveAttribute('inert');
    expect(document.title).not.toBe(title);
    // Its name leads home: the page closes, and Back from the door does not come back to it.
    waiting = moved();
    await user.click(within(page).getByRole('button', { name: 'Peek' }));
    await act(() => waiting);
    expect(location.pathname).toBe('/');
    expect(history.length).toBe(entries);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.door')).not.toHaveAttribute('inert');
    expect(screen.getByRole('link', { name: /DHL/ })).toHaveFocus();
    await waitFor(() => expect(document.title).toBe(title));
    // Escape closes it too.
    await user.click(screen.getByRole('link', { name: /DHL/ }));
    waiting = moved();
    await user.keyboard('{Escape}');
    await act(() => waiting);
    expect(location.pathname).toBe('/');
  });

  it('returns to the front door on Back, and opens the page like any link on Forward', async () => {
    render(<PeekRoot session={visitor} />);
    await track();
    await waitFor(() => expect(location.pathname).toBe(`/p/${LINK_ID}`));
    let waiting = moved();
    history.back();
    await act(() => waiting);
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    expect(screen.getByRole('link', { name: /DHL/ })).toHaveAttribute('href', `/p/${LINK_ID}`);
    waiting = moved();
    history.forward();
    await act(() => waiting);
    expect(await screen.findByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    expect(document.querySelector('.peekp-main')).toHaveAttribute('data-entrance', 'direct');
    expect(mocks.read).toHaveBeenCalledWith(LINK_ID, expect.objectContaining({ key: OWNER_KEY }));
  });

  it('opens the sample parcel from Pip: its own address, the page revealed with it, and nothing kept on the device', async () => {
    // Someone who asked for less motion: the box opens at once.
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<PeekRoot session={visitor} />);
    const entries = history.length;
    await userEvent.setup().click(screen.getByRole('link', { name: 'Open a sample parcel' }));
    await waitFor(() => expect(location.pathname).toBe('/sample'));
    expect(history.length).toBe(entries + 1);
    expect(screen.getByText('Sample parcel')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    expect(screen.getByText('Moon lamp 🌙')).toBeVisible();
    // The page opens with the sample the door read: no link is asked for, and no parcel is remembered.
    expect(document.querySelector('.peekp-main')).toHaveAttribute('data-entrance', 'reveal');
    expect(mocks.read).not.toHaveBeenCalled();
    expect(localStorage.getItem(RECENTS_STORAGE_KEY)).toBeNull();
    const waiting = moved();
    history.back();
    await act(() => waiting);
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    expect(document.querySelector('.door')).toHaveAttribute('data-view', 'first');
  });

  it('lets the browser move Pip between the two views where it can', async () => {
    const startViewTransition = vi.fn((update: () => void) => { update(); return {}; });
    Object.assign(document, { startViewTransition });
    render(<PeekRoot session={visitor} />);
    await track();
    await waitFor(() => expect(startViewTransition).toHaveBeenCalledOnce());
    // The update the browser runs has both the address and the page in place when it returns.
    expect(location.pathname).toBe(`/p/${LINK_ID}`);
    expect(document.querySelector('.peekp-main')).toHaveAttribute('data-entrance', 'reveal');
  });

  it('skips the transition under reduced motion, and still lands on the revealed page', async () => {
    const startViewTransition = vi.fn();
    Object.assign(document, { startViewTransition });
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<PeekRoot session={visitor} />);
    await track();
    await waitFor(() => expect(location.pathname).toBe(`/p/${LINK_ID}`));
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(document.querySelector('.peekp-main')).toHaveAttribute('data-entrance', 'reveal');
  });

  it('opens the parcel page for a parcel address, a malformed one included', async () => {
    history.replaceState(null, '', `/p/${LINK_ID}`);
    const view = render(<PeekRoot session={visitor} serverLinkId={LINK_ID} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    expect(document.querySelector('.peekp-main')).toHaveAttribute('data-entrance', 'direct');
    view.unmount();
    mocks.read.mockResolvedValue('unavailable');
    history.replaceState(null, '', '/p/not-a-link');
    render(<PeekRoot session={visitor} serverLinkId="unavailable" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'This parcel has been forgotten' })).toBeVisible();
    expect(mocks.read).toHaveBeenLastCalledWith('not-a-link', expect.anything());
  });

  it('gives the screens the session, signed in or not', () => {
    const seen: PeekSession[] = [];
    function Probe() {
      seen.push(usePeekSession());
      return null;
    }
    render(<Probe />);
    expect(seen[0].account).toBe('visitor');
    expect(seen[0].signIn()).toBeUndefined();
  });
});
