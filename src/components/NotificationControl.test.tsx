import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disablePushNotifications,
  enablePushNotifications,
  getNotificationPreferences,
  inspectPushState,
  saveNotificationPreferences,
} from '../lib/pushNotifications';
import { NotificationControl } from './NotificationControl';

vi.mock('../lib/pushNotifications', () => ({
  inspectPushState: vi.fn(),
  updatePushNotificationLocale: vi.fn().mockResolvedValue(undefined),
  enablePushNotifications: vi.fn(),
  disablePushNotifications: vi.fn(),
  getNotificationPreferences: vi.fn(),
  saveNotificationPreferences: vi.fn(),
  ALL_NOTIFICATION_STAGES: [
    'registered', 'accepted', 'in_transit', 'customs', 'out_for_delivery',
    'failed_attempt', 'ready_for_pickup', 'delivered', 'returned',
  ],
  IMPORTANT_NOTIFICATION_STAGES: [
    'customs', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup',
    'delivered', 'returned',
  ],
  DELIVERY_DAY_NOTIFICATION_STAGES: ['out_for_delivery', 'delivered'],
}));

beforeEach(() => {
  vi.mocked(inspectPushState).mockReset();
  vi.mocked(enablePushNotifications).mockReset();
  vi.mocked(disablePushNotifications).mockReset();
  vi.mocked(getNotificationPreferences).mockReset().mockResolvedValue({
    enabledStages: ['out_for_delivery', 'delivered'],
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: 'Europe/Zurich',
  });
  vi.mocked(saveNotificationPreferences).mockReset().mockImplementation(
    async (preferences) => preferences,
  );
});

describe('NotificationControl', () => {
  it('enables alerts and shows the configured cadence', async () => {
    vi.mocked(inspectPushState).mockResolvedValue({ kind: 'prompt', publicKey: 'public' });
    vi.mocked(enablePushNotifications).mockResolvedValue(true);
    const apiAuth = {
      userId: 'user-1',
      getAccessToken: vi.fn().mockResolvedValue('token'),
    };
    const user = userEvent.setup();
    render(<NotificationControl apiAuth={apiAuth} />);

    await user.click(screen.getByRole('button', { name: 'Notification settings' }));
    expect(await screen.findByText(/every 10 minutes from 08:00 to 22:00/i)).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Delivery updates' }));
    expect(inspectPushState).toHaveBeenCalledWith(apiAuth);
    expect(enablePushNotifications).toHaveBeenCalledWith('public', apiAuth, 'en');
    expect(await screen.findByText("You’re set for parcel updates")).toBeInTheDocument();
  });

  it('turns alerts off for only this device', async () => {
    vi.mocked(inspectPushState)
      .mockResolvedValueOnce({ kind: 'enabled', publicKey: 'public' })
      .mockResolvedValueOnce({ kind: 'prompt', publicKey: 'public' });
    vi.mocked(disablePushNotifications).mockResolvedValue();
    const user = userEvent.setup();
    render(<NotificationControl />);
    await user.click(await screen.findByRole('button', { name: 'Notifications enabled' }));
    await user.click(screen.getByRole('switch', { name: 'Delivery updates' }));
    expect(disablePushNotifications).toHaveBeenCalled();
    expect(await screen.findByText(/Know when your parcel needs you/i)).toBeInTheDocument();
  });

  it('gives iPhone installation guidance when Web Push is unavailable', async () => {
    vi.mocked(inspectPushState).mockResolvedValue({ kind: 'unsupported' });
    const user = userEvent.setup();
    render(<NotificationControl />);
    await user.click(screen.getByRole('button', { name: 'Notification settings' }));
    expect(await screen.findByText(/add Delivery Tracker to your Home Screen/i)).toBeInTheDocument();
  });

  it('saves event presets and clears the retired quiet hours', async () => {
    vi.mocked(getNotificationPreferences).mockResolvedValue({
      enabledStages: ['out_for_delivery', 'delivered'], quietHoursStart: '22:00', quietHoursEnd: '08:00', timezone: 'Europe/Zurich',
    });
    vi.mocked(inspectPushState).mockResolvedValue({ kind: 'enabled', publicKey: 'public' });
    const apiAuth = {
      userId: 'user-1',
      getAccessToken: vi.fn().mockResolvedValue('token'),
    };
    const user = userEvent.setup();
    render(<NotificationControl apiAuth={apiAuth} />);

    await user.click(await screen.findByRole('button', { name: 'Notifications enabled' }));
    await user.click(await screen.findByRole('radio', { name: /important only/i }));
    expect(screen.queryByRole('checkbox', { name: /quiet hours/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(saveNotificationPreferences).toHaveBeenCalledWith({
      enabledStages: [
        'customs', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup',
        'delivered', 'returned',
      ],
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: expect.any(String),
    }, apiAuth);
    expect(await screen.findByText('Preferences saved')).toBeInTheDocument();
  });
});
