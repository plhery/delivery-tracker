import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../shared/friends-demo.json';
import type { ApiFriendsActionResponse, ApiFriendsSnapshot } from '../generated/apiContract';
import { createFriendsClient, ownFriendCard, type FriendsClient } from '../lib/friends';
import { Friends } from './Friends';
import { webcrypto } from 'node:crypto';

const previewId = 'Ab7kP2mQ9xR4tY6n';
const sharedLink = window.location.origin + '/i/' + previewId;
beforeEach(() => vi.stubGlobal('crypto', webcrypto));

const enrolled = (): ApiFriendsSnapshot => ({ ...structuredClone(fixture), ownCard: ownFriendCard([], fixture.profile) }) as ApiFriendsSnapshot;
function realClient(): FriendsClient { return { checkInvitation: vi.fn().mockResolvedValue(undefined), load: vi.fn().mockResolvedValue(enrolled()), action: vi.fn() }; }
async function show(client = createFriendsClient(true), demo = true) {
  const user = userEvent.setup();
  const onExitDemo = vi.fn();
  render(<Friends client={client} parcels={[]} demo={demo} onExitDemo={onExitDemo} />);
  await screen.findByRole('button', { name: 'Invite a friend' }); return { user, client, onExitDemo };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); history.replaceState(null, '', '/'); });

describe('Friends', () => {
  it('shows only safe stats, opens stamps, and requires confirmation to remove a friend', async () => {
    const { user } = await show();
    expect(screen.getByText('Stats kept private')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^Mila/ }));
    const sheet = screen.getByRole('dialog', { name: 'Passport' });
    await user.click(within(sheet).getByRole('button', { name: 'Express arrival' }));
    expect(within(sheet).getByRole('button', { name: 'Express arrival' })).toHaveAttribute('popovertarget');
    expect(sheet.querySelector('.passport-bubble')?.textContent).toContain('First arrival');
    await user.click(within(sheet).getByText('Manage friendship'));
    await user.click(within(sheet).getByRole('button', { name: 'Remove friend' }));
    expect(within(sheet).getByText('Remove Mila?')).toBeVisible();
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(within(sheet).queryByText('Remove Mila?')).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Remove friend' }));
    await user.click(within(sheet).getByRole('button', { name: 'Remove friend' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: /^Mila/ })).toBeNull();
  });
  it('keeps privacy choices mounted, saves them, and omits removed entry points', async () => {
    const { user } = await show();
    expect(screen.queryByRole('button', { name: 'Open an invitation link' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Sharing preferences' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).queryByRole('button', { name: 'Turn off Friends' })).toBeNull();
    const stats = within(sheet).getByRole('switch', { name: 'Stats & stamps' });
    const arrival = within(sheet).getByRole('switch', { name: 'Arrivals this week' });
    await user.click(stats); await user.click(arrival);
    expect(within(sheet).getByRole('switch', { name: 'Stats & stamps' })).toBe(stats);
    expect(within(sheet).getByText('Stats kept private')).toBeVisible();
    await user.clear(within(sheet).getByRole('textbox')); expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(within(sheet).getByRole('textbox'), '  Robin  '); await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Sharing preferences' }));
    expect(screen.getByRole('textbox')).toHaveValue('Robin');
    expect(screen.getByRole('switch', { name: 'Stats & stamps' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Arrivals this week' })).toBeChecked();
  });
  it('starts with a quiet introduction and enables both sharing options for a new profile', async () => {
    const client = realClient();
    vi.mocked(client.load).mockResolvedValue({ profile: null, ownCard: null, friends: [] });
    vi.mocked(client.action).mockResolvedValue({ snapshot: { ...enrolled(), friends: [] } });
    const user = userEvent.setup(); render(<Friends client={client} parcels={[]} demo={false} />);
    await user.click(await screen.findByRole('button', { name: 'Create profile' }));
    expect(screen.getByRole('switch', { name: 'Stats & stamps' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Arrivals this week' })).toBeChecked();
    const sheet = screen.getByRole('dialog'); expect(within(sheet).getByRole('button', { name: 'Create profile' })).toBeDisabled();
    await user.type(within(sheet).getByRole('textbox'), 'Alex'); await user.click(within(sheet).getByRole('button', { name: 'Create profile' }));
    expect(client.action).toHaveBeenCalledWith({ action: 'save_profile', nickname: 'Alex', shareStats: true, shareArrival: true }, []);
    expect(await screen.findByText('Add your first friend')).toBeVisible();
  });
  it('keeps demo invitations local and offers sign-in', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { user, onExitDemo } = await show(); await user.click(screen.getByRole('button', { name: 'Invite a friend' }));
    const sheet = screen.getByRole('dialog'); expect(within(sheet).getByRole('button', { name: 'Replay package opening' })).toBeVisible();
    await user.click(within(sheet).getByRole('button', { name: 'Sign in instead' }));
    expect(onExitDemo).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it('prepares a single-use link on the first invite click, then copies and revokes it', async () => {
    const client = realClient();
    vi.mocked(client.action).mockImplementation(async (input) => input.action === 'create_invite' ? { inviteCode: 'a'.repeat(32), previewId, expiresAt: '2026-09-16T00:00:00Z' } : { snapshot: enrolled() });
    const { user } = await show(client, false);
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    expect(client.action).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Invite a friend' }));
    const sheet = screen.getByRole('dialog');
    await within(sheet).findByRole('textbox', { name: 'Invitation link' });
    await user.click(within(sheet).getByText('Manage links'));
    expect(client.action).toHaveBeenCalledExactlyOnceWith({ action: 'create_invite' }, []);
    expect(within(sheet).queryByRole('button', { name: 'Invite a friend' })).not.toBeInTheDocument();
    await user.click(await within(sheet).findByRole('button', { name: 'Copy link' }));
    expect(copy).toHaveBeenCalledWith(sharedLink);
    expect(within(sheet).getByRole('button', { name: 'Copied' })).toBeVisible();
    const field = within(sheet).getByRole('textbox', { name: 'Invitation link' });
    fireEvent.focus(field); expect(field).toHaveValue(sharedLink);
    await user.click(within(sheet).getByRole('button', { name: 'Cancel this invitation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.action).toHaveBeenLastCalledWith({ action: 'revoke_invite', code: 'a'.repeat(32) }, []);
  });
  it('shows six older invitations and cancels them without replacing the visible link', async () => {
    const client = realClient();
    vi.mocked(client.action).mockResolvedValueOnce({ inviteCode: 'a'.repeat(32), previousInviteCount: 6 })
      .mockResolvedValue({ snapshot: enrolled(), previousInviteCount: 0 });
    const { user } = await show(client, false);
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(screen.getByRole('button', { name: 'Invite a friend' }));
    const sheet = screen.getByRole('dialog');
    await within(sheet).findByRole('textbox', { name: 'Invitation link' });
    await user.click(within(sheet).getByText('Manage links'));
    const field = await within(sheet).findByRole('textbox', { name: 'Invitation link' });
    const link = (field as HTMLInputElement).value;
    expect(within(sheet).getByRole('button', { name: 'Cancel this invitation' })).toBeVisible();
    await user.click(within(sheet).getByRole('button', { name: 'Cancel 6 previous links' }));
    expect(client.action).toHaveBeenLastCalledWith({ action: 'revoke_previous_invites', code: 'a'.repeat(32) }, []);
    expect(within(sheet).getByRole('status')).toHaveTextContent('Previous invitations cancelled');
    expect(field).toHaveValue(link);
    await user.click(within(sheet).getByRole('button', { name: 'Copy link' }));
    expect(copy).toHaveBeenCalledWith(link);
    expect(within(sheet).queryByText('Cancel 6 previous links')).toBeNull();
    expect(client.action).toHaveBeenCalledTimes(2);
    await user.click(within(sheet).getByRole('button', { name: 'Cancel this invitation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.action).toHaveBeenLastCalledWith({ action: 'revoke_invite', code: 'a'.repeat(32) }, []);
  });
  it('can cancel just the visible invitation while older invitations are active', async () => {
    const client = realClient();
    vi.mocked(client.action).mockResolvedValueOnce({ inviteCode: 'a'.repeat(32), previousInviteCount: 1 })
      .mockResolvedValue({ snapshot: enrolled() });
    const { user } = await show(client, false);
    await user.click(screen.getByRole('button', { name: 'Invite a friend' }));
    const sheet = screen.getByRole('dialog');
    await within(sheet).findByRole('textbox', { name: 'Invitation link' });
    await user.click(within(sheet).getByText('Manage links'));
    expect(await within(sheet).findByRole('button', { name: 'Cancel 1 previous links' })).toBeVisible();
    await user.click(within(sheet).getByRole('button', { name: 'Cancel this invitation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.action).toHaveBeenCalledTimes(2);
    expect(client.action).toHaveBeenLastCalledWith({ action: 'revoke_invite', code: 'a'.repeat(32) }, []);
  });
  it('keeps the count and link after a failed cancellation, then allows a retry', async () => {
    const client = realClient();
    vi.mocked(client.action).mockResolvedValueOnce({ inviteCode: 'a'.repeat(32), previousInviteCount: 1 })
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue({ snapshot: enrolled(), previousInviteCount: 0 });
    const { user } = await show(client, false);
    await user.click(screen.getByRole('button', { name: 'Invite a friend' }));
    const sheet = screen.getByRole('dialog');
    await within(sheet).findByRole('textbox', { name: 'Invitation link' });
    await user.click(within(sheet).getByText('Manage links'));
    const cancel = await within(sheet).findByRole('button', { name: 'Cancel 1 previous links' });
    const field = within(sheet).getByRole('textbox', { name: 'Invitation link' });
    const link = (field as HTMLInputElement).value;
    await user.click(cancel);
    expect(within(sheet).getByRole('alert')).toBeVisible();
    expect(cancel).toBeEnabled();
    expect(field).toHaveValue(link);
    expect(within(sheet).queryByText('Previous invitations cancelled')).toBeNull();
    await user.click(cancel);
    expect(within(sheet).getByRole('status')).toHaveTextContent('Previous invitations cancelled');
    expect(field).toHaveValue(link);
  });
  it('creates once under StrictMode and makes a failed first attempt retryable', async () => {
    const client = realClient();
    let reject: (error: Error) => void = () => undefined;
    vi.mocked(client.action).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }))
      .mockResolvedValue({ inviteCode: 'a'.repeat(32), previewId, expiresAt: '2026-09-16T00:00:00Z' });
    render(<StrictMode><Friends client={client} parcels={[]} demo={false} /></StrictMode>);
    const button = await screen.findByRole('button', { name: 'Invite a friend' });
    fireEvent.click(button); fireEvent.click(button);
    expect(client.action).toHaveBeenCalledTimes(1);
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('status', { name: 'Invitation link' })).toBeVisible();
    await act(async () => reject(new Error('Offline')));
    expect(within(sheet).getByRole('alert')).toBeVisible();
    expect(client.action).toHaveBeenCalledTimes(1);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Retry' }));
    expect(await within(sheet).findByRole('textbox', { name: 'Invitation link' })).toHaveValue(sharedLink);
    expect(client.action).toHaveBeenCalledTimes(2);
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
