import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getNotificationPreferences, inspectPushState } from './lib/pushNotifications';
import { createDemoRepo } from './store/demoRepo';
import { ParcelsProvider } from './store/ParcelsContext';
import type { ParcelRepo, ParcelWithEvents } from './types';

vi.mock('./lib/pushNotifications', async (original) => ({
  ...await original<typeof import('./lib/pushNotifications')>(),
  inspectPushState: vi.fn(),
  getNotificationPreferences: vi.fn(),
}));

const EMAIL_ON = {
  enabledStages: ['out_for_delivery', 'delivered'] as const, quietHoursStart: null, quietHoursEnd: null, timezone: 'Europe/Zurich',
  emailOnDelivery: true, emailAvailable: true,
};
const session = () => ({ userId: 'account', getAccessToken: vi.fn().mockResolvedValue('token') });

/** An account's deliveries: the demo's parcels behind the API's interface, with the email mute the server has. */
function accountRepo() {
  const demo = createDemoRepo(localStorage);
  const muted = new Set<string>();
  const withEmail = (parcel: ParcelWithEvents): ParcelWithEvents => ({ ...parcel, emailMuted: muted.has(parcel.id) });
  const setEmailMuted = vi.fn(async (id: string, value: boolean) => {
    if (value) muted.add(id); else muted.delete(id);
    return withEmail((await demo.list()).find((parcel) => parcel.id === id)!);
  });
  const repo: ParcelRepo = { ...demo, mode: 'api', list: async () => (await demo.list()).map(withEmail), setEmailMuted };
  return { repo, setEmailMuted };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.mocked(inspectPushState).mockReset().mockResolvedValue({ kind: 'unsupported' });
  vi.mocked(getNotificationPreferences).mockReset().mockResolvedValue({ ...EMAIL_ON, enabledStages: [...EMAIL_ON.enabledStages] });
});

describe('the delivery email in the deliveries', () => {
  it('reads the preferences once per sign-in and mutes the email for one parcel from its bell', async () => {
    const { repo, setEmailMuted } = accountRepo();
    const apiAuth = session();
    const user = userEvent.setup();
    render(<ParcelsProvider repo={repo}><App apiAuth={apiAuth} accountEmail="alex@example.com" /></ParcelsProvider>);

    await user.click(await screen.findByText('Belgian chocolate 🍫'));
    const detail = screen.getByRole('dialog', { name: 'Belgian chocolate 🍫' });
    await user.click(await within(detail).findByRole('button', { name: 'Alerts for this parcel' }));
    const sheet = screen.getByRole('dialog', { name: 'Alerts for Belgian chocolate 🍫' });
    expect(within(sheet).getByRole('switch', { name: 'Notifications' })).toHaveAccessibleDescription('Delivery day only, as in Settings');
    const email = within(sheet).getByRole('switch', { name: 'Email when it’s delivered' });
    expect(email).toHaveAccessibleDescription('To alex@example.com');
    await user.click(email);
    await waitFor(() => expect(email).not.toBeChecked());
    const [id, muted] = setEmailMuted.mock.calls[0];
    expect(muted).toBe(true);
    expect((await repo.list()).find((parcel) => parcel.id === id)).toMatchObject({ label: 'Belgian chocolate 🍫', emailMuted: true });
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    await user.click(within(detail).getByRole('button', { name: /back/i }));

    // Another parcel: its bell knows the account's choice without asking the server again.
    await user.click(await screen.findByText('Moon lamp 🌙'));
    expect(await within(screen.getByRole('dialog', { name: 'Moon lamp 🌙' })).findByRole('button', { name: 'Alerts for this parcel' })).toBeVisible();
    expect(getNotificationPreferences).toHaveBeenCalledExactlyOnceWith(apiAuth);
  });

  it('offers the email on a delivered parcel of an account that never chose', async () => {
    vi.mocked(getNotificationPreferences).mockResolvedValue({ ...EMAIL_ON, enabledStages: [...EMAIL_ON.enabledStages], emailOnDelivery: null });
    const user = userEvent.setup();
    render(<ParcelsProvider repo={accountRepo().repo}><App apiAuth={session()} accountEmail="alex@example.com" /></ParcelsProvider>);
    await user.click(await screen.findByText('Coffee beans ☕'));
    const detail = screen.getByRole('dialog', { name: 'Coffee beans ☕' });
    expect(await within(detail).findByRole('region', { name: 'An email when the next one arrives?' })).toBeVisible();
    // A delivered parcel has nothing left to announce: its bell is the plain mute.
    expect(within(detail).getByRole('button', { name: 'Turn off parcel alerts' })).toBeVisible();
  });

  it('leaves the demo as it is: no preferences are read, the bell mutes, nothing is offered', async () => {
    const user = userEvent.setup();
    render(<ParcelsProvider repo={createDemoRepo(localStorage)}><App apiAuth={session()} accountEmail="alex@example.com" /></ParcelsProvider>);
    await user.click(await screen.findByText('Belgian chocolate 🍫'));
    const detail = screen.getByRole('dialog', { name: 'Belgian chocolate 🍫' });
    await user.click(within(detail).getByRole('button', { name: 'Turn off parcel alerts' }));
    expect(await within(detail).findByRole('button', { name: 'Turn parcel alerts on' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(detail).getByRole('button', { name: /back/i }));
    await user.click(await screen.findByText('Coffee beans ☕'));
    expect(within(screen.getByRole('dialog', { name: 'Coffee beans ☕' })).queryByRole('region', { name: /next one arrives/ })).toBeNull();
    expect(getNotificationPreferences).not.toHaveBeenCalled();
  });
});
