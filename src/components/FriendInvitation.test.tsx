import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePendingInvitation } from '../lib/friendInvites';
import { FriendsError, type FriendsClient } from '../lib/friends';
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
it('lands a friendship stamp on the same opened parcel before leaving for Friends', async () => {
  const friend = { id: '11111111-1111-4111-8111-111111111111', nickname: 'Paul', stats: null, arrivedThisWeek: null };
  const client: FriendsClient = { load: vi.fn().mockResolvedValue(enrolled), action: vi.fn().mockResolvedValue({ snapshot: { ...enrolled, friends: [friend] }, acceptedFriend: friend }) };
  const user = userEvent.setup(); const { container } = render(<Harness client={client} />);
  await screen.findByRole('heading', { name: 'Your friend Paul sent you an invitation' });
  await user.click(screen.getByRole('button', { name: 'Tap to open your parcel' }));
  const parcel = container.querySelector('.arrival__parcel');
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);
  await user.click(await screen.findByRole('button', { name: 'Become friends' }));
  expect(await screen.findByRole('heading', { name: 'Friendship delivered' })).toBeVisible();
  expect(container.querySelector('.friendship-receipt')).toBeInTheDocument();
  expect(container.querySelector('.arrival__parcel')).toBe(parcel);
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  expect(sessionStorage.getItem('sdt.pendingFriendInvitation.v1')).toBeNull();
  expect(await screen.findByText('Invitation closed', {}, { timeout: 1800 })).toBeVisible();
  expect(client.action).toHaveBeenCalledOnce();
  expect(location.search).toBe('?view=friends');
});
it('shows the profile preview and saves explicit sharing choices before joining', async () => {
  const client: FriendsClient = { load: vi.fn().mockResolvedValue(noProfile), action: vi.fn().mockResolvedValue({ snapshot: enrolled }) };
  const user = userEvent.setup(); render(<Harness client={client} />);
  await screen.findByRole('heading', { name: 'Your friend Paul sent you an invitation' });
  await user.click(screen.getByRole('button', { name: 'Tap to open your parcel' }));
  await user.click(await screen.findByRole('button', { name: 'Turn on Friends to accept' }));
  const setup = within(screen.getByRole('dialog', { name: 'Turn on Friends' }));
  expect(setup.getByRole('region', { name: 'Profile preview:' })).toBeVisible();
  expect(setup.getByRole('switch', { name: 'Stats & stamps' })).toBeChecked();
  expect(setup.getByRole('switch', { name: 'Arrivals this week' })).toBeChecked();
  expect(client.action).not.toHaveBeenCalled();
  await user.type(screen.getByRole('textbox', { name: 'Nickname' }), 'Alex');
  await user.click(screen.getByRole('switch', { name: 'Arrivals this week' }));
  await user.click(screen.getByRole('button', { name: 'Turn on Friends & accept' }));
  await waitFor(() => expect(client.action).toHaveBeenCalledTimes(2));
  expect(vi.mocked(client.action).mock.calls.map(([action]) => action)).toEqual([
    { action: 'save_profile', nickname: 'Alex', shareStats: true, shareArrival: false }, { action: 'accept_invite', code },
  ]);
  expect(await screen.findByText('Invitation closed')).toBeVisible();
});
it('can cancel setup without enabling Friends or losing the invitation', async () => {
  const client: FriendsClient = { load: vi.fn().mockResolvedValue(noProfile), action: vi.fn() };
  const user = userEvent.setup(); render(<Harness client={client} />);
  await screen.findByRole('heading', { name: 'Your friend Paul sent you an invitation' });
  await user.click(screen.getByRole('button', { name: 'Tap to open your parcel' }));
  await user.click(await screen.findByRole('button', { name: 'Turn on Friends to accept' }));
  await user.type(screen.getByRole('textbox', { name: 'Nickname' }), 'Alex');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(client.action).not.toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem('sdt.pendingFriendInvitation.v1')!).code).toBe(code);
  await user.click(screen.getByRole('button', { name: 'Turn on Friends to accept' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(client.action).not.toHaveBeenCalled();
});
it('keeps the draft after a failed setup and never accepts before Friends is enabled', async () => {
  const client: FriendsClient = { load: vi.fn().mockResolvedValue(noProfile), action: vi.fn()
    .mockRejectedValueOnce(new FriendsError('friends.actionFailed'))
    .mockResolvedValueOnce({ snapshot: noProfile })
    .mockResolvedValue({ snapshot: enrolled }) };
  const user = userEvent.setup(); render(<Harness client={client} />);
  await screen.findByRole('heading', { name: 'Your friend Paul sent you an invitation' });
  await user.click(screen.getByRole('button', { name: 'Tap to open your parcel' }));
  await user.click(await screen.findByRole('button', { name: 'Turn on Friends to accept' }));
  await user.type(screen.getByRole('textbox', { name: 'Nickname' }), 'Alex');
  await user.click(screen.getByRole('switch', { name: 'Stats & stamps' }));
  for (let attempt = 0; attempt < 2; attempt++) {
    await user.click(screen.getByRole('button', { name: 'Turn on Friends & accept' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Alex');
    expect(screen.getByRole('switch', { name: 'Stats & stamps' })).not.toBeChecked();
    expect(vi.mocked(client.action).mock.calls.every(([request]) => request.action === 'save_profile')).toBe(true);
  }
  await user.click(screen.getByRole('button', { name: 'Turn on Friends & accept' }));
  expect(await screen.findByText('Invitation closed')).toBeVisible();
  expect(client.action).toHaveBeenLastCalledWith({ action: 'accept_invite', code }, []);
});
it('blocks dismissal and repeat submits while enabling, then retries only acceptance after a failure', async () => {
  let finish!: (value: { snapshot: ApiFriendsSnapshot }) => void;
  const client: FriendsClient = { load: vi.fn().mockResolvedValue(noProfile), action: vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockRejectedValueOnce(new FriendsError('friends.actionFailed'))
    .mockResolvedValue({ snapshot: enrolled }) };
  const user = userEvent.setup(); render(<Harness client={client} />);
  await screen.findByRole('heading', { name: 'Your friend Paul sent you an invitation' });
  await user.click(screen.getByRole('button', { name: 'Tap to open your parcel' }));
  await user.click(await screen.findByRole('button', { name: 'Turn on Friends to accept' }));
  await user.type(screen.getByRole('textbox', { name: 'Nickname' }), 'Alex');
  const submit = screen.getByRole('button', { name: 'Turn on Friends & accept' });
  fireEvent.click(submit); fireEvent.click(submit);
  const dialog = screen.getByRole('dialog', { name: 'Turn on Friends' });
  expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
  const animate = vi.fn();
  Object.defineProperty(dialog, 'animate', { value: animate, configurable: true });
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);
  await user.keyboard('{Escape}');
  fireEvent.click(dialog.parentElement!);
  expect(animate).not.toHaveBeenCalled();
  expect(dialog).toBeVisible();
  expect(client.action).toHaveBeenCalledOnce();
  await act(async () => finish({ snapshot: enrolled }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Turn on Friends to accept' })).toBeNull();
  expect(sessionStorage.getItem('sdt.pendingFriendInvitation.v1')).not.toBeNull();
  await user.click(screen.getByRole('button', { name: 'Become friends' }));
  expect(await screen.findByText('Invitation closed')).toBeVisible();
  expect(vi.mocked(client.action).mock.calls.map(([request]) => request.action)).toEqual(['save_profile', 'accept_invite', 'accept_invite']);
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
