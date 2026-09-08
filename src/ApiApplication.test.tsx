import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiApplication } from './ApiApplication';

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
}));

vi.mock('./auth/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('./store/apiRepo', () => ({
  browserStorage: mocks.browserStorage,
  createApiRepo: mocks.createApiRepo,
  clearApiCache: mocks.clearApiCache,
}));
vi.mock('./store/ParcelsContext', () => ({
  ParcelsProvider: ({ children }: { children: ReactNode }) => children,
  useParcels: () => ({ parcels: [] }),
}));
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
    emailOtpEnabled: true,
    signInWithGoogle: vi.fn(),
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

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); history.replaceState(null, '', '/'); });

describe('ApiApplication', () => {
  it('keeps a demo visitor’s invitation through sign-in, then accepts into Friends', async () => {
    const code = 'ab'.repeat(16);
    history.replaceState(null, '', '/invite#' + code);
    localStorage.setItem('sdt.web.experience.v1', 'demo');
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const snapshot = { profile: { nickname: 'Alex', shareStats: true, shareArrival: false }, ownCard: null, friends: [] };
    const fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => new Response(JSON.stringify(
      url.endsWith('invite-preview') ? { previewNickname: 'Paul' } : init?.method === 'POST' ? { snapshot } : snapshot,
    )));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    const view = render(<ApiApplication />);
    expect(await screen.findByText('Your friend Paul')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tap to open your parcel' }));
    expect(await screen.findByText('Configured sign in')).toBeVisible();
    mocks.auth.status = 'authenticated'; mocks.auth.user = USER;
    view.rerender(<ApiApplication />);
    const accept = await screen.findByRole('button', { name: 'Become friends' });
    expect(fetch.mock.calls.filter(([, init]) => String(init?.body).includes('accept_invite'))).toHaveLength(0);
    await user.click(accept);
    expect(await screen.findByText('owner@example.test')).toBeVisible();
    expect(location.search).toBe('?view=friends');
    expect(sessionStorage.getItem('sdt.pendingFriendInvitation.v1')).toBeNull();
  });
  it('restarts the unopened welcome after sign-out and remembers it for the next visit', async () => {
    mocks.auth.status = 'authenticated';
    mocks.auth.user = USER;
    const result = render(<ApiApplication />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(window.localStorage.getItem('sdt.web.experience.v1')).toBe('welcome'));
    mocks.auth.status = 'anonymous';
    mocks.auth.user = null;
    result.rerender(<ApiApplication />);
    expect(screen.getByRole('button', { name: 'Tap to open your parcel' })).toBeEnabled();
    expect(screen.queryByText('Configured sign in')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try the demo/ })).not.toBeInTheDocument();
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
