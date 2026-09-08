import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePendingInvitation } from '../lib/friendInvites';
import type { FriendsClient } from '../lib/friends';
import type { ApiFriendsSnapshot } from '../generated/apiContract';
import { FriendInvitation } from './FriendInvitation';

const code = 'ab'.repeat(16);
const noProfile: ApiFriendsSnapshot = { profile: null, ownCard: null, friends: [] };
const enrolled: ApiFriendsSnapshot = { ...noProfile, profile: { nickname: 'Alex', shareStats: true, shareArrival: false } };
const signIn = vi.fn().mockResolvedValue(undefined);
function Harness({ client }: { client?: FriendsClient }) {
  const invitation = usePendingInvitation();
  return invitation.pending ? <FriendInvitation invitation={invitation} onDismiss={() => invitation.clear()} client={client}
    configured googleEnabled emailOtpEnabled={false} signInWithGoogle={signIn} sendCode={vi.fn()} verifyCode={vi.fn()} /> : <p>Invitation closed</p>;
}
beforeEach(() => {
  history.replaceState(null, '', `/invite#${code}`);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ previewNickname: 'Paul' }))));
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); history.replaceState(null, '', '/'); signIn.mockClear(); });

it('opens into personalized sign-in and never offers the demo or accepts automatically', async () => {
  const user = userEvent.setup(); render(<Harness />);
  expect(await screen.findByRole('heading', { name: 'Your friend Paul sent you an invitation' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Tap to open your parcel' }));
  await user.click(await screen.findByRole('button', { name: 'Continue with Google' }));
  expect(signIn).toHaveBeenCalledOnce();
  expect(screen.getByText('Sign in to accept the invitation')).toBeVisible();
  expect(screen.queryByRole('button', { name: /demo/i })).toBeNull();
  expect(JSON.parse(sessionStorage.getItem('sdt.pendingFriendInvitation.v1')!).opened).toBe(true);
  expect(fetch).toHaveBeenCalledWith('/api/friends/invite-preview', expect.objectContaining({ credentials: 'omit', cache: 'no-store', body: JSON.stringify({ code }) }));
});
it('requires an explicit accept and ignores repeated taps', async () => {
  let finish!: (value: { snapshot: ApiFriendsSnapshot }) => void;
  const client: FriendsClient = { load: vi.fn().mockResolvedValue(enrolled), action: vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; })) };
  const user = userEvent.setup(); render(<Harness client={client} />);
  await screen.findByRole('heading', { name: 'Your friend Paul sent you an invitation' });
  await user.click(screen.getByRole('button', { name: 'Tap to open your parcel' }));
  const accept = await screen.findByRole('button', { name: 'Become friends' });
  expect(client.action).not.toHaveBeenCalled();
  fireEvent.click(accept); fireEvent.click(accept);
  expect(client.action).toHaveBeenCalledExactlyOnceWith({ action: 'accept_invite', code }, []);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  expect(screen.queryByRole('heading', { name: 'Your friend Paul sent you an invitation' })).toBeNull();
  await act(async () => finish({ snapshot: enrolled }));
  expect(screen.getByText('Invitation closed')).toBeVisible();
  expect(location.search).toBe('?view=friends');
});
it('shows the profile preview and saves explicit sharing choices before joining', async () => {
  const client: FriendsClient = { load: vi.fn().mockResolvedValue(noProfile), action: vi.fn().mockResolvedValue({ snapshot: enrolled }) };
  const user = userEvent.setup(); render(<Harness client={client} />);
  await screen.findByRole('heading', { name: 'Your friend Paul sent you an invitation' });
  await user.click(screen.getByRole('button', { name: 'Tap to open your parcel' }));
  await user.click(await screen.findByRole('button', { name: 'Become friends' }));
  expect(screen.getByRole('region', { name: 'Profile preview:' })).toBeVisible();
  expect(client.action).not.toHaveBeenCalled();
  await user.type(screen.getByRole('textbox', { name: 'Nickname' }), 'Alex');
  await user.click(screen.getByRole('switch', { name: 'Arrivals this week' }));
  await user.click(screen.getByRole('button', { name: 'Create profile & accept' }));
  await waitFor(() => expect(client.action).toHaveBeenCalledTimes(2));
  expect(vi.mocked(client.action).mock.calls.map(([action]) => action)).toEqual([
    { action: 'save_profile', nickname: 'Alex', shareStats: true, shareArrival: false }, { action: 'accept_invite', code },
  ]);
});
it('keeps an expired invitation closed and allows dismissal', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 404 }));
  const user = userEvent.setup(); render(<Harness />);
  expect(await screen.findByRole('alert')).toHaveTextContent('This invitation is no longer available');
  expect(screen.getByRole('button', { name: 'Tap to open your parcel' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByText('Invitation closed')).toBeVisible();
  expect(sessionStorage.length).toBe(0);
});
it('clears sender information on background and ignores a late preview', async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<Harness />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  await act(async () => finish(new Response(JSON.stringify({ previewNickname: 'Paul' }))));
  expect(screen.queryByRole('heading', { name: 'Your friend Paul sent you an invitation' })).toBeNull();
});
