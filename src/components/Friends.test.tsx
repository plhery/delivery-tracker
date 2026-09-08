import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../shared/friends-demo.json';
import type { ApiFriendsActionResponse, ApiFriendsSnapshot } from '../generated/apiContract';
import { createFriendsClient, FriendsError, ownFriendCard, type FriendsClient } from '../lib/friends';
import { Friends } from './Friends';

const enrolled = (): ApiFriendsSnapshot => ({ ...structuredClone(fixture), ownCard: ownFriendCard([], fixture.profile) }) as ApiFriendsSnapshot;
function realClient(): FriendsClient { return { load: vi.fn().mockResolvedValue(enrolled()), action: vi.fn() }; }
async function show(client = createFriendsClient(true), demo = true) {
  const user = userEvent.setup(); render(<Friends client={client} parcels={[]} demo={demo} />);
  await screen.findByRole('button', { name: 'Invite a friend' }); return { user, client };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Friends', () => {
  it('shows only safe stats, opens stamps, and requires confirmation to remove a friend', async () => {
    const { user } = await show();
    expect(screen.getByText('Fictional friends')).toBeVisible();
    expect(screen.getByText('Stats kept private')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^Mila/ }));
    const sheet = screen.getByRole('dialog', { name: 'Mila' });
    await user.click(within(sheet).getByRole('button', { name: 'Express arrival' }));
    expect(within(sheet).getByRole('status')).toHaveTextContent('48 hours');
    await user.click(within(sheet).getByRole('button', { name: 'Remove friend' }));
    expect(within(sheet).getByText('Remove Mila?')).toBeVisible();
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(within(sheet).queryByText('Remove Mila?')).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Remove friend' }));
    await user.click(within(sheet).getByRole('button', { name: 'Remove friend' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: /^Mila/ })).toBeNull();
  });
  it('previews privacy switches before saving and lets people leave the circle', async () => {
    const { user } = await show();
    await user.click(screen.getByRole('button', { name: 'Sharing preferences' }));
    let sheet = screen.getByRole('dialog');
    const stats = within(sheet).getByRole('switch', { name: /^Stats & stamps/ });
    const arrival = within(sheet).getByRole('switch', { name: /^Arrivals this week/ });
    expect(arrival).not.toBeChecked();
    expect(sheet.querySelector('details')).not.toHaveAttribute('open');
    await user.click(within(sheet).getByText('Preview my profile'));
    await user.click(stats); await user.click(arrival);
    expect(within(sheet).getByText('Stats kept private')).toBeVisible();
    await user.clear(within(sheet).getByRole('textbox', { name: 'Nickname' }));
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(within(sheet).getByRole('textbox', { name: 'Nickname' }), '  Robin  ');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Sharing preferences' }));
    sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('textbox', { name: 'Nickname' })).toHaveValue('Robin');
    expect(within(sheet).getByRole('switch', { name: /^Stats & stamps/ })).not.toBeChecked();
    await user.click(within(sheet).getByRole('button', { name: 'Turn off Friends' }));
    await user.click(screen.getByRole('dialog').querySelector('button.button--primary')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Share your Passport')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create profile' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Nickname' }), 'Robin');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    expect(await screen.findByText('Add your first friend')).toBeVisible();
  });
  it('makes demo invitations clearly fictional without calling a server', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { user } = await show();
    await user.click(screen.getByRole('button', { name: 'Invite a friend' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Sign in to invite friends');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Enter an invite code' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Sign in to invite friends');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('creates, copies, and revokes a single-use invite only on deliberate actions', async () => {
    const client = realClient();
    vi.mocked(client.action).mockImplementation(async (input) => input.action === 'create_invite' ? { inviteCode: 'a'.repeat(32), expiresAt: '2026-09-16T00:00:00Z' } : { snapshot: enrolled() });
    const { user } = await show(client, false);
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(screen.getByRole('button', { name: 'Invite a friend' }));
    const sheet = screen.getByRole('dialog');
    expect(client.action).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole('button', { name: 'Invite a friend' }));
    await user.click(await within(sheet).findByRole('button', { name: 'Copy invite code' }));
    expect(copy).toHaveBeenCalledWith('a'.repeat(32));
    expect(within(sheet).getByRole('button', { name: 'Copied' })).toBeVisible();
    const field = within(sheet).getByRole('textbox', { name: 'Invite code' });
    fireEvent.focus(field); expect(field).toHaveValue('a'.repeat(32));
    await user.click(within(sheet).getByRole('button', { name: 'Cancel this invitation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.action).toHaveBeenLastCalledWith({ action: 'revoke_invite' }, []);
  });
  it('previews only a nickname, clears that preview when editing, and accepts explicitly', async () => {
    const client = realClient();
    vi.mocked(client.action).mockImplementation(async (input) => input.action === 'preview_invite' ? { previewNickname: 'Mila' } : { snapshot: enrolled() });
    const { user } = await show(client, false);
    await user.click(screen.getByRole('button', { name: 'Enter an invite code' }));
    const sheet = screen.getByRole('dialog');
    const field = within(sheet).getByRole('textbox', { name: 'Invite code' });
    expect(within(sheet).getByRole('button', { name: 'Preview invitation' })).toBeDisabled();
    await user.type(field, 'A'.repeat(32));
    await user.click(within(sheet).getByRole('button', { name: 'Preview invitation' }));
    expect(await within(sheet).findByText('Join Mila’s circle?')).toBeVisible();
    expect(client.action).toHaveBeenCalledTimes(1);
    fireEvent.change(field, { target: { value: 'b'.repeat(32) } });
    expect(within(sheet).queryByText('Join Mila’s circle?')).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Preview invitation' }));
    await user.click(await within(sheet).findByRole('button', { name: 'Become friends' }));
    expect(await screen.findByRole('status')).toHaveTextContent('A new friend');
  });
  it('reports expired invitations in the sheet without losing the input', async () => {
    const client = realClient(); vi.mocked(client.action).mockRejectedValue(new FriendsError('friends.inviteUnavailable'));
    const { user } = await show(client, false);
    await user.click(screen.getByRole('button', { name: 'Enter an invite code' }));
    const sheet = screen.getByRole('dialog');
    await user.type(within(sheet).getByRole('textbox', { name: 'Invite code' }), 'a'.repeat(32));
    await user.click(within(sheet).getByRole('button', { name: 'Preview invitation' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('This code has expired');
    expect(within(sheet).getByRole('textbox', { name: 'Invite code' })).toHaveValue('a'.repeat(32));
  });
  it('clears background data and ignores an old request after privacy changes', async () => {
    const client = realClient(); await show(client, false);
    let hidden = true;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.queryByRole('button', { name: /^Mila/ })).toBeNull();
    vi.mocked(client.load).mockResolvedValue({ ...enrolled(), friends: [] });
    hidden = false; fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByText('Add your first friend')).toBeVisible();
  });
  it('shows an unavailable state instead of demo people when live data fails', async () => {
    const client = realClient(); vi.mocked(client.load).mockRejectedValue(new Error('offline'));
    const user = userEvent.setup(); render(<Friends client={client} parcels={[]} demo={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Friends couldn’t load');
    expect(screen.queryByText('Mila')).toBeNull();
    vi.mocked(client.load).mockResolvedValue(enrolled());
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /^Mila/ })).toBeVisible();
  });
  it('prevents duplicate mutations and ignores an in-flight action after backgrounding', async () => {
    const client = realClient(); let resolve: (value: ApiFriendsActionResponse) => void = () => undefined;
    vi.mocked(client.action).mockReturnValue(new Promise((done) => { resolve = done; }));
    const { user } = await show(client, false);
    await user.click(screen.getByRole('button', { name: 'Sharing preferences' }));
    const save = within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' });
    fireEvent.click(save); fireEvent.click(save);
    expect(client.action).toHaveBeenCalledTimes(1); expect(save).toBeDisabled();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { resolve({ snapshot: enrolled() }); });
    expect(screen.queryByRole('button', { name: /^Mila/ })).toBeNull();
  });
});
