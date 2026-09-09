import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissNotificationInvitation, notificationInvitationDismissed } from '../lib/notificationInvitation';
import { enablePushNotifications, inspectPushState, type PushState } from '../lib/pushNotifications';
import { NotificationPrompt } from './NotificationPrompt';

vi.mock('../lib/pushNotifications', () => ({
  inspectPushState: vi.fn(),
  enablePushNotifications: vi.fn(),
}));

const apiAuth = { userId: 'prompt-user', getAccessToken: vi.fn().mockResolvedValue('token') };
const prompt = { kind: 'prompt', publicKey: 'public' } as const;
const popup = () => screen.queryByRole('region', { name: 'Get delivery updates' });

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(inspectPushState).mockReset().mockResolvedValue(prompt);
  vi.mocked(enablePushNotifications).mockReset().mockResolvedValue(true);
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('NotificationPrompt', () => {
  it('waits for eligibility without requesting permission or taking focus', async () => {
    const { rerender } = render(<><button>Keep tracking</button><NotificationPrompt apiAuth={apiAuth} eligible={false} /></>);
    screen.getByRole('button', { name: 'Keep tracking' }).focus();
    expect(popup()).not.toBeInTheDocument();
    expect(inspectPushState).not.toHaveBeenCalled();
    rerender(<><button>Keep tracking</button><NotificationPrompt apiAuth={apiAuth} eligible /></>);
    expect(await screen.findByRole('region', { name: 'Get delivery updates' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep tracking' })).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(enablePushNotifications).not.toHaveBeenCalled();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });

  it.each<PushState>([
    { kind: 'enabled', publicKey: 'public' }, { kind: 'blocked' },
    { kind: 'unsupported' }, { kind: 'unavailable' },
  ])('stays quiet for $kind browsers', async (state) => {
    vi.mocked(inspectPushState).mockResolvedValue(state);
    render(<NotificationPrompt apiAuth={apiAuth} eligible />);
    await act(async () => {});
    expect(popup()).not.toBeInTheDocument();
    expect(enablePushNotifications).not.toHaveBeenCalled();
  });

  it('stays quiet when checking fails or dismissal cannot be stored', async () => {
    vi.mocked(inspectPushState).mockRejectedValue(new Error('offline'));
    const { unmount } = render(<NotificationPrompt apiAuth={apiAuth} eligible />);
    await act(async () => {});
    expect(popup()).not.toBeInTheDocument();
    unmount();
    vi.mocked(inspectPushState).mockClear();
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked storage'); });
    render(<NotificationPrompt apiAuth={apiAuth} eligible />);
    expect(inspectPushState).not.toHaveBeenCalled();
    expect(popup()).not.toBeInTheDocument();
  });

  it.each(['Not now', 'Close'])('remembers %s across remounts without affecting another account', async (label) => {
    const user = userEvent.setup();
    const { unmount } = render(<NotificationPrompt apiAuth={apiAuth} eligible />);
    await user.click(await screen.findByRole('button', { name: label }));
    expect(notificationInvitationDismissed(apiAuth.userId)).toBe(true);
    unmount();
    const next = render(<NotificationPrompt apiAuth={apiAuth} eligible />);
    expect(popup()).not.toBeInTheDocument();
    next.unmount();
    render(<NotificationPrompt apiAuth={{ ...apiAuth, userId: 'other-user' }} eligible />);
    expect(await screen.findByRole('region', { name: 'Get delivery updates' })).toBeInTheDocument();
  });

  it('responds to a Settings dismissal and cross-tab storage changes', async () => {
    const { unmount } = render(<NotificationPrompt apiAuth={apiAuth} eligible />);
    await screen.findByRole('region', { name: 'Get delivery updates' });
    act(() => dismissNotificationInvitation(apiAuth.userId));
    expect(popup()).not.toBeInTheDocument();
    unmount();
    localStorage.clear();
    render(<NotificationPrompt apiAuth={apiAuth} eligible />);
    await screen.findByRole('region', { name: 'Get delivery updates' });
    localStorage.setItem(`deliveryTrackerNotificationInvitation:${apiAuth.userId}`, 'dismissed');
    fireEvent(window, new StorageEvent('storage'));
    expect(popup()).not.toBeInTheDocument();
  });

  it('enables once after a click, then closes even when the welcome alert was not sent', async () => {
    let finish!: (value: boolean) => void;
    vi.mocked(enablePushNotifications).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    render(<NotificationPrompt apiAuth={apiAuth} eligible />);
    await user.click(await screen.findByRole('button', { name: 'Enable notifications' }));
    expect(enablePushNotifications).toHaveBeenCalledExactlyOnceWith('public', apiAuth, 'en');
    expect(screen.getByRole('button', { name: 'Enabling…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeDisabled();
    await act(async () => finish(false));
    expect(popup()).not.toBeInTheDocument();
    expect(notificationInvitationDismissed(apiAuth.userId)).toBe(true);
  });

  it.each(['default', 'denied'])('remembers browser permission %s without showing an error', async (permission) => {
    vi.stubGlobal('Notification', { permission });
    vi.mocked(enablePushNotifications).mockRejectedValue(new Error('Notifications were not allowed'));
    const user = userEvent.setup();
    render(<NotificationPrompt apiAuth={apiAuth} eligible />);
    await user.click(await screen.findByRole('button', { name: 'Enable notifications' }));
    expect(popup()).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(notificationInvitationDismissed(apiAuth.userId)).toBe(true);
  });

  it('keeps a retry when permission was granted but registration failed', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' });
    vi.mocked(enablePushNotifications).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(true);
    const user = userEvent.setup();
    render(<NotificationPrompt apiAuth={apiAuth} eligible />);
    await user.click(await screen.findByRole('button', { name: 'Enable notifications' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t turn on alerts');
    expect(notificationInvitationDismissed(apiAuth.userId)).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(enablePushNotifications).toHaveBeenCalledTimes(2);
    expect(popup()).not.toBeInTheDocument();
  });

  it('provides iPhone installation steps without requesting permission', async () => {
    vi.mocked(inspectPushState).mockResolvedValue({ kind: 'install' });
    const user = userEvent.setup();
    render(<NotificationPrompt apiAuth={apiAuth} eligible />);
    await user.click(await screen.findByRole('button', { name: 'Show me how' }));
    expect(screen.getByRole('list')).toHaveTextContent('Share menu');
    expect(screen.getByRole('list')).toHaveTextContent('Add to Home Screen');
    expect(enablePushNotifications).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('rechecks permission on returning to the page and ignores stale results', async () => {
    let finish!: (state: PushState) => void;
    vi.mocked(inspectPushState).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { rerender } = render(<NotificationPrompt apiAuth={apiAuth} eligible />);
    rerender(<NotificationPrompt apiAuth={apiAuth} eligible={false} />);
    await act(async () => finish(prompt));
    expect(popup()).not.toBeInTheDocument();
    rerender(<NotificationPrompt apiAuth={apiAuth} eligible />);
    await screen.findByRole('region', { name: 'Get delivery updates' });
    vi.mocked(inspectPushState).mockResolvedValue({ kind: 'blocked' });
    fireEvent.focus(window);
    await waitFor(() => expect(popup()).not.toBeInTheDocument());
  });
});
