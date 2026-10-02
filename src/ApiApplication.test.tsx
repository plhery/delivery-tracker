import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiApplication } from './ApiApplication';
import { onKeepOutcome, pendingKeep, rememberPendingKeep, type KeepOutcome } from './peek/pending';
import { forgetAllRecents, recentFor, rememberParcel, renameParcel } from './peek/recents';
import { LINK_ID, OWNER_KEY, testView } from './test/parcelLinks';

const mocks = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  browserStorage: vi.fn(),
  createApiRepo: vi.fn(),
  clearApiCache: vi.fn(),
  disablePushNotifications: vi.fn(),
  unsubscribePushNotificationsLocally: vi.fn(),
  exportAccount: vi.fn(),
  downloadAccountExport: vi.fn(),
  deleteAccount: vi.fn(),
  retryLoad: vi.fn(),
  kept: vi.fn(),
}));

vi.mock('./auth/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('./store/apiRepo', () => ({
  browserStorage: mocks.browserStorage,
  createApiRepo: mocks.createApiRepo,
  clearApiCache: mocks.clearApiCache,
}));
vi.mock('./store/ParcelsContext', () => ({
  ParcelsProvider: ({ children }: { children: ReactNode }) => children,
  useParcels: () => ({ parcels: [], loading: false, retryLoad: mocks.retryLoad }),
}));
// The page itself has its own tests; here it shows what the app hands it.
vi.mock('./peek/ParcelPage', async () => {
  const { usePeekSession } = await import('./peek/session');
  return {
    ParcelPage: ({ linkId }: { linkId: string }) => {
      const session = usePeekSession();
      return <div>
        <p>Parcel page {linkId} for {session.account}{session.deliveries ? ` with ${session.deliveries.length} deliveries` : ''}</p>
        <button type="button" onClick={() => session.signIn(linkId)}>Sign in to keep it</button>
        {session.keep && <button type="button" onClick={() => void session.keep!(linkId).then(mocks.kept)}>Add to my deliveries</button>}
        {session.openDeliveries && <button type="button" onClick={() => session.openDeliveries!('p1')}>Open it</button>}
      </div>;
    },
  };
});
vi.mock('./lib/pushNotifications', () => ({
  disablePushNotifications: mocks.disablePushNotifications,
  unsubscribePushNotificationsLocally: mocks.unsubscribePushNotificationsLocally,
}));
vi.mock('./lib/account', () => ({
  exportAccount: mocks.exportAccount,
  downloadAccountExport: mocks.downloadAccountExport,
  deleteAccount: mocks.deleteAccount,
}));
vi.mock('./components/SignInScreen', () => ({
  SignInScreen: ({ configured }: { configured: boolean }) => (
    <div>{configured ? 'Configured sign in' : 'Unconfigured sign in'}</div>
  ),
}));
vi.mock('./App', () => ({
  default: ({
    accountEmail,
    onSignOut,
    onExportAccount,
    onDeleteAccount,
  }: {
    accountEmail: string;
    onSignOut: () => Promise<void>;
    onExportAccount: () => Promise<void>;
    onDeleteAccount: (confirmation: string) => Promise<void>;
  }) => (
    <div>
      <span>{accountEmail}</span>
      <button type="button" onClick={() => void onExportAccount()}>Export</button>
      <button type="button" onClick={() => void onDeleteAccount(accountEmail)}>Delete</button>
      <button type="button" onClick={() => void onSignOut()}>Sign out</button>
    </div>
  ),
}));

const USER = {
  id: '10000000-0000-0000-0000-000000000001',
  email: 'owner@example.test',
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('sdt.web.experience.v1', 'sign-in');
  window.dispatchEvent(new Event('storage'));
  mocks.auth = {
    status: 'anonymous',
    user: null,
    getAccessToken: vi.fn().mockResolvedValue('token'),
    googleEnabled: false,
    appleEnabled: false,
    emailOtpEnabled: true,
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    sendCode: vi.fn(),
    verifyCode: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
  };
  mocks.browserStorage.mockReturnValue(window.localStorage);
  mocks.createApiRepo.mockReturnValue({ mode: 'api' });
  mocks.disablePushNotifications.mockResolvedValue(undefined);
  mocks.unsubscribePushNotificationsLocally.mockResolvedValue(undefined);
  mocks.exportAccount.mockResolvedValue({ exportedAt: '2026-08-05T12:00:00Z' });
  mocks.deleteAccount.mockResolvedValue(undefined);
});

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); forgetAllRecents(); history.replaceState(null, '', '/'); });

/** Answers the claim request; everything else the signed-in app asks for is unavailable here. */
function claimAnswering(result: { id: string; outcome: string; packageId?: string }) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (path) => path === '/api/packages/claim'
    ? new Response(JSON.stringify({ results: [result] }))
    : new Response('{}', { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const claims = (fetch: ReturnType<typeof claimAnswering>) => fetch.mock.calls.filter(([path]) => path === '/api/packages/claim');

describe('ApiApplication', () => {
  it.each([true, false])('keeps the invitation through sign-in and accepts with Friends already enabled: %s', async (alreadyEnabled) => {
    const code = 'ab'.repeat(16);
    history.replaceState(null, '', '/invite#' + code);
    localStorage.setItem('sdt.web.experience.v1', 'demo');
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const snapshot = { profile: { nickname: 'Alex', shareStats: true, shareArrival: false }, ownCard: null, friends: [] };
    const fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => new Response(JSON.stringify(
      url.endsWith('invite-preview') ? { previewNickname: 'Paul' } : init?.method === 'POST' ? { snapshot } : alreadyEnabled ? snapshot : { profile: null, ownCard: null, friends: [] },
    )));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    const view = render(<ApiApplication />);
    expect(await screen.findByRole('heading', { name: 'Your friend Paul sent you an invitation' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tap to open your parcel' }));
    expect(await screen.findByText('Configured sign in')).toBeVisible();
    mocks.auth.status = 'authenticated'; mocks.auth.user = USER;
    view.rerender(<ApiApplication />);
    const accept = await screen.findByRole('button', { name: alreadyEnabled ? 'Become friends' : 'Turn on Friends to accept' }, { timeout: 10_000 });
    expect(fetch.mock.calls.filter(([, init]) => String(init?.body).includes('accept_invite'))).toHaveLength(0);
    await user.click(accept);
    if (!alreadyEnabled) {
      expect(screen.getByRole('dialog', { name: 'Turn on Friends' })).toBeVisible();
      await user.type(screen.getByRole('textbox', { name: 'Nickname' }), 'Alex');
      await user.click(screen.getByRole('button', { name: 'Turn on Friends & accept' }));
    }
    expect(await screen.findByText('owner@example.test')).toBeVisible();
    expect(location.search).toBe('?view=friends');
    expect(sessionStorage.getItem('sdt.pendingFriendInvitation.v1')).toBeNull();
  });
  it('returns to the front door after sign-out and remembers it for the next visit', async () => {
    mocks.auth.status = 'authenticated';
    mocks.auth.user = USER;
    const result = render(<ApiApplication />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(window.localStorage.getItem('sdt.web.experience.v1')).toBe('welcome'));
    mocks.auth.status = 'anonymous';
    mocks.auth.user = null;
    result.rerender(<ApiApplication />);
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    expect(screen.queryByText('Configured sign in')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Explore the demo/ })).not.toBeInTheDocument();
  });

  it('greets a visitor with the front door, opens sign-in from it and comes back', async () => {
    window.localStorage.removeItem('sdt.web.experience.v1');
    window.dispatchEvent(new Event('storage'));
    const user = userEvent.setup();
    render(<ApiApplication />);
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Tap to open your parcel' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Configured sign in')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Explore the demo' })).toBeVisible();
    expect(window.localStorage.getItem('sdt.web.experience.v1')).toBe('sign-in');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
  });

  it('shows a parcel page to anyone at once, while a saved sign-in is still being restored', () => {
    history.replaceState(null, '', `/p/${LINK_ID}`);
    mocks.auth.status = 'loading';
    const result = render(<ApiApplication parcelLinkId={LINK_ID} />);
    expect(screen.getByText(`Parcel page ${LINK_ID} for checking`)).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    mocks.auth.status = 'anonymous';
    result.rerender(<ApiApplication parcelLinkId={LINK_ID} />);
    expect(screen.getByText(`Parcel page ${LINK_ID} for visitor`)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add to my deliveries' })).not.toBeInTheDocument();
  });

  it('keeps a parcel page for someone signed in, who can add it and go to their deliveries', async () => {
    history.replaceState(null, '', `/p/${LINK_ID}`);
    mocks.auth.status = 'authenticated';
    mocks.auth.user = USER;
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
    const fetch = claimAnswering({ id: LINK_ID, outcome: 'kept', packageId: 'p1' });
    const user = userEvent.setup();
    render(<ApiApplication parcelLinkId={LINK_ID} />);
    expect(screen.getByText(`Parcel page ${LINK_ID} for signed-in with 0 deliveries`)).toBeVisible();
    expect(screen.queryByText('owner@example.test')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add to my deliveries' }));
    await waitFor(() => expect(mocks.kept).toHaveBeenCalledWith({ id: LINK_ID, outcome: 'kept', packageId: 'p1', name: null }));
    expect(claims(fetch)).toHaveLength(1);
    expect(JSON.parse(String(claims(fetch)[0][1]!.body))).toEqual({ links: [{ id: LINK_ID, key: OWNER_KEY }] });
    expect(new Headers(claims(fetch)[0][1]!.headers).get('Authorization')).toBe('Bearer token');
    expect(mocks.retryLoad).toHaveBeenCalled();
    expect(recentFor(LINK_ID)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    expect(location.pathname + location.search).toBe('/?parcel=p1');
    expect(screen.getByText('owner@example.test')).toBeVisible();
  });

  it('keeps the parcel a visitor asked to keep, once, as soon as they are signed in', async () => {
    window.localStorage.removeItem('sdt.web.experience.v1');
    window.dispatchEvent(new Event('storage'));
    history.replaceState(null, '', `/p/${LINK_ID}`);
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
    renameParcel(LINK_ID, 'New sneakers');
    const fetch = claimAnswering({ id: LINK_ID, outcome: 'kept', packageId: 'p1' });
    const heard: KeepOutcome[] = [];
    const stop = onKeepOutcome((outcome) => heard.push(outcome));
    const user = userEvent.setup();
    const result = render(<ApiApplication parcelLinkId={LINK_ID} />);
    await user.click(screen.getByRole('button', { name: 'Sign in to keep it' }));
    // Signing in happens at /, where a provider returns to; the note waits in this tab.
    expect(location.pathname).toBe('/');
    expect(screen.getByText('Configured sign in')).toBeVisible();
    expect(pendingKeep()).toBe(LINK_ID);
    expect(claims(fetch)).toHaveLength(0);

    mocks.auth.status = 'authenticated';
    mocks.auth.user = USER;
    result.rerender(<ApiApplication parcelLinkId={LINK_ID} />);
    expect(await screen.findByText('owner@example.test')).toBeVisible();
    await waitFor(() => expect(heard).toEqual([{ id: LINK_ID, outcome: 'kept', packageId: 'p1', name: 'New sneakers' }]));
    result.rerender(<ApiApplication parcelLinkId={LINK_ID} />);
    expect(claims(fetch)).toHaveLength(1);
    expect(JSON.parse(String(claims(fetch)[0][1]!.body))).toEqual({ links: [{ id: LINK_ID, key: OWNER_KEY, label: 'New sneakers' }] });
    expect(mocks.retryLoad).toHaveBeenCalled();
    expect(recentFor(LINK_ID)).toBeNull();
    expect(pendingKeep()).toBeNull();
    stop();
  });

  it('forgets the parcel to keep when the visitor backs out of sign-in', async () => {
    rememberPendingKeep(LINK_ID);
    const user = userEvent.setup();
    render(<ApiApplication />);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    expect(pendingKeep()).toBeNull();
  });

  it('signs out and clears private cache while push deregistration is stalled', async () => {
    mocks.auth.status = 'authenticated';
    mocks.auth.user = USER;
    mocks.disablePushNotifications.mockImplementationOnce(() => new Promise(() => {}));
    render(<ApiApplication />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    expect(mocks.auth.signOut).toHaveBeenCalledOnce();
    expect(mocks.clearApiCache).toHaveBeenCalledWith(window.localStorage, USER.id);
    expect(window.localStorage.getItem('sdt.web.experience.v1')).toBe('welcome');
  });

  it('renders loading and both sign-in configuration states', () => {
    mocks.auth.status = 'loading';
    const result = render(<ApiApplication />);
    expect(screen.getByRole('status')).toHaveTextContent('Opening your parcels…');

    mocks.auth.status = 'unconfigured';
    result.rerender(<ApiApplication />);
    expect(screen.getByText('Unconfigured sign in')).toBeInTheDocument();

    mocks.auth.status = 'anonymous';
    result.rerender(<ApiApplication />);
    expect(screen.getByText('Configured sign in')).toBeInTheDocument();
  });

  it('wires account export, deletion, and privacy-clean sign-out', async () => {
    mocks.auth.status = 'authenticated';
    mocks.auth.user = USER;
    mocks.disablePushNotifications.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<ApiApplication />);

    expect(screen.getByText('owner@example.test')).toBeInTheDocument();
    expect(mocks.createApiRepo).toHaveBeenCalledWith(
      30_000,
      1_000,
      window.localStorage,
      expect.objectContaining({ userId: USER.id }),
    );

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(mocks.downloadAccountExport).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER.id }),
      USER.email,
    ));
    expect(mocks.unsubscribePushNotificationsLocally).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(mocks.disablePushNotifications).toHaveBeenCalled());
    expect(mocks.clearApiCache).toHaveBeenCalledWith(window.localStorage, USER.id);
    expect(mocks.auth.signOut).toHaveBeenCalled();
  });
});

it.each([
  ['already_accepted', 'You’ve already accepted this invitation.'],
  ['already_friends', 'You’re already friends.'],
] as const)('opens the authenticated %s outcome without an error or an acceptance request', async (invitationState, message) => {
  history.replaceState(null, '', '/invite#' + 'ab'.repeat(16));
  mocks.auth.status = 'authenticated'; mocks.auth.user = USER;
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const snapshot = { profile: { nickname: 'Alex', shareStats: false, shareArrival: false }, ownCard: null, friends: [] };
  const fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('invite-preview')) return invitationState === 'already_accepted'
      ? new Response('{}', { status: 404 }) : new Response(JSON.stringify({ previewNickname: 'Paul' }));
    return new Response(JSON.stringify(init?.method === 'POST' ? { previewNickname: 'Paul', invitationState } : snapshot));
  });
  vi.stubGlobal('fetch', fetch);
  const user = userEvent.setup(); render(<ApiApplication />);
  await screen.findByRole('heading', { name: 'Your friend Paul sent you an invitation' });
  expect(screen.queryByText(message)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Tap to open your parcel' }));
  expect(await screen.findByRole('heading', { name: message })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(fetch.mock.calls.some(([, init]) => String(init?.body).includes('accept_invite'))).toBe(false);
});
