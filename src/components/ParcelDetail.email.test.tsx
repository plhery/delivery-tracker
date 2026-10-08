import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiAuth } from '../lib/apiClient';
import {
  getNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from '../lib/pushNotifications';
import { loadNotificationPreferences } from '../store/notificationPreferences';
import { testParcel } from '../test/parcelLinks';
import type { ParcelWithEvents, Stage } from '../types';
import { ParcelDetail } from './ParcelDetail';

const mocks = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../lib/pushNotifications', async (original) => ({
  ...await original<typeof import('../lib/pushNotifications')>(),
  getNotificationPreferences: vi.fn(),
  saveNotificationPreferences: vi.fn(),
}));
vi.mock('../lib/analytics', async (original) => ({ ...await original<typeof import('../lib/analytics')>(), trackAction: mocks.track }));

const IMPORTANT: NotificationPreferences['enabledStages'] = ['customs', 'exception', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered', 'returned'];
const ON_ITS_WAY: Stage[] = ['registered', 'in_transit'];
const DELIVERED: Stage[] = ['registered', 'in_transit', 'delivered'];

/** How each switch's save ends; a test may hold one back. */
const saves = {
  notifications: vi.fn<(parcel: ParcelWithEvents, muted: boolean) => Promise<void>>(),
  email: vi.fn<(parcel: ParcelWithEvents, muted: boolean) => Promise<void>>(),
};

/** The detail as the deliveries show it: a save answers, and the parcel in the list changes. */
function Detail({ initial, auth, email, account = true }: { initial: ParcelWithEvents; auth: ApiAuth; email?: string; account?: boolean }) {
  const [parcel, setParcel] = useState(initial);
  return <ParcelDetail parcel={parcel} apiAuth={auth} accountEmail={email}
    onSetNotificationsMuted={async (current, muted) => { await saves.notifications(current, muted); setParcel((value) => ({ ...value, notificationsMuted: muted })); }}
    onSetEmailMuted={account ? async (current, muted) => { await saves.email(current, muted); setParcel((value) => ({ ...value, emailMuted: muted })); } : undefined}
    onBack={vi.fn()} onRename={vi.fn()} onChangeCarrier={vi.fn()} onRefresh={vi.fn()} onRestore={vi.fn()} onArchive={vi.fn()} onDelete={vi.fn()} />;
}

/** Opens a parcel's detail for an account whose preferences the deliveries have already read. */
async function open({ preferences = {}, parcel = {}, stages = ON_ITS_WAY, email = 'alex@example.com', account = true, read = true }: {
  preferences?: Partial<NotificationPreferences>;
  parcel?: Partial<ParcelWithEvents>;
  stages?: Stage[];
  email?: string | null;
  account?: boolean;
  read?: boolean;
} = {}) {
  const auth: ApiAuth = { userId: 'user-1', getAccessToken: async () => 'token' };
  vi.mocked(getNotificationPreferences).mockResolvedValue({
    enabledStages: IMPORTANT, quietHoursStart: null, quietHoursEnd: null, timezone: 'Europe/Zurich',
    emailOnDelivery: true, emailAvailable: true, ...preferences,
  });
  if (read) await loadNotificationPreferences(auth);
  const view = render(<Detail initial={testParcel({ id: 'package-1', label: 'New sneakers', ...parcel }, stages)} auth={auth} email={email ?? undefined} account={account} />);
  return { auth, user: userEvent.setup(), ...view };
}

const bell = () => document.querySelector<HTMLButtonElement>('.detail__notification')!;
const sheet = () => screen.getByRole('dialog', { name: 'Alerts for New sneakers' });
const offer = () => screen.queryByRole('region', { name: 'An email when the next one arrives?' });

beforeEach(() => {
  mocks.track.mockReset();
  saves.notifications.mockReset().mockResolvedValue(undefined);
  saves.email.mockReset().mockResolvedValue(undefined);
  vi.mocked(getNotificationPreferences).mockReset();
  vi.mocked(saveNotificationPreferences).mockReset().mockImplementation(async (preferences) => ({
    ...preferences, emailOnDelivery: preferences.emailOnDelivery ?? null, emailAvailable: true,
  }));
});

describe('a parcel’s bell', () => {
  it.each([
    ['the account’s email is off', { preferences: { emailOnDelivery: false } }],
    ['the account never chose', { preferences: { emailOnDelivery: null } }],
    ['the server sends no email', { preferences: { emailAvailable: false } }],
    ['the preferences are not read yet', { read: false }],
    ['the session names no address', { email: null }],
    ['the parcel is delivered', { stages: DELIVERED }],
    ['the parcel went back', { stages: ['registered', 'in_transit', 'returned'] as Stage[] }],
    ['there is no account, as in the demo', { account: false }],
  ])('stays the one-tap mute it is when %s', async (_why, setup) => {
    const { user } = await open(setup);
    expect(bell()).toHaveAccessibleName('Turn off parcel alerts');
    expect(bell()).toHaveAttribute('aria-pressed', 'false');
    expect(bell()).not.toHaveAttribute('aria-haspopup');
    await user.click(bell());
    expect(saves.notifications).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'package-1' }), true);
    await waitFor(() => expect(bell()).toHaveAccessibleName('Turn parcel alerts on'));
    expect(bell()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('dialog', { name: /^Alerts for/ })).toBeNull();
    expect(saves.email).not.toHaveBeenCalled();
  });

  it('opens the parcel’s alerts while the account’s email is on and the parcel is on its way', async () => {
    const { user } = await open();
    expect(bell()).toHaveAccessibleName('Alerts for this parcel');
    expect(bell()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(bell()).not.toHaveAttribute('aria-pressed');
    await user.click(bell());
    // Nothing is saved by opening.
    expect(saves.notifications).not.toHaveBeenCalled();
    const notifications = within(sheet()).getByRole('switch', { name: 'Notifications' });
    expect(notifications).toBeChecked();
    expect(notifications).toHaveAccessibleDescription('Important only, as in Settings');
    const email = within(sheet()).getByRole('switch', { name: 'Email when it arrives' });
    expect(email).toBeChecked();
    expect(email).toHaveAccessibleDescription('To alex@example.com');
    expect(within(sheet()).getByText('Switching one off here only mutes this parcel. Your defaults are in Settings › Delivery updates.')).toBeVisible();
    // It behaves as the other sheets do: the focus is inside, Escape closes it and hands the focus back.
    expect(sheet()).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alerts for New sneakers' })).toBeNull());
    expect(bell()).toHaveFocus();
    await user.click(bell());
    await user.click(within(sheet()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alerts for New sneakers' })).toBeNull());
    // Opening and closing asked the server for nothing more.
    expect(getNotificationPreferences).toHaveBeenCalledTimes(1);
  });

  it('names the sheet after the parcel, or as the bell is named when it has no name', async () => {
    const { user } = await open({ parcel: { label: '' } });
    await user.click(bell());
    expect(screen.getByRole('dialog', { name: 'Alerts for this parcel' })).toBeVisible();
  });

  it('saves each switch at once, for this parcel, and moves it when the server has answered', async () => {
    const { user } = await open();
    await user.click(bell());
    let answer!: () => void;
    saves.email.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const email = within(sheet()).getByRole('switch', { name: 'Email when it arrives' });
    const notifications = within(sheet()).getByRole('switch', { name: 'Notifications' });
    await user.click(email);
    expect(saves.email).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'package-1' }), true);
    // Still on, and busy, until the server answers; the other switch waits its turn.
    expect(email).toBeChecked();
    expect(email).toHaveAttribute('aria-busy', 'true');
    await user.click(notifications);
    expect(saves.notifications).not.toHaveBeenCalled();
    await act(async () => { answer(); });
    await waitFor(() => expect(email).not.toBeChecked());
    expect(email).not.toHaveAttribute('aria-busy');
    expect(notifications).toBeChecked();

    await user.click(notifications);
    expect(saves.notifications).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'package-1' }), true);
    await waitFor(() => expect(notifications).not.toBeChecked());
    await user.click(email);
    expect(saves.email).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'package-1' }), false);
    await waitFor(() => expect(email).toBeChecked());
    // The account's own choice was not touched.
    expect(saveNotificationPreferences).not.toHaveBeenCalled();
  });

  it('leaves a switch as it was and says so when its save fails', async () => {
    const { user } = await open();
    await user.click(bell());
    saves.email.mockRejectedValueOnce(new Error('offline'));
    const email = within(sheet()).getByRole('switch', { name: 'Email when it arrives' });
    await user.click(email);
    expect(await within(sheet()).findByRole('alert')).toHaveTextContent('Couldn’t save your alert settings. Try again.');
    expect(email).toBeChecked();
    await user.click(email);
    await waitFor(() => expect(email).not.toBeChecked());
    expect(within(sheet()).queryByRole('alert')).toBeNull();
  });

  it.each([
    [{ notificationsMuted: false, emailMuted: false }, false],
    [{ notificationsMuted: true, emailMuted: false }, false],
    [{ notificationsMuted: false, emailMuted: true }, false],
    [{ notificationsMuted: true, emailMuted: true }, true],
  ])('reads as off only when both alerts are off for the parcel: %o', async (parcel, off) => {
    await open({ parcel });
    expect(bell().hasAttribute('data-muted')).toBe(off);
  });
});

describe('the email offer on a delivered parcel', () => {
  const never = { stages: DELIVERED, preferences: { emailOnDelivery: null } };

  it('stands between the delivered card and the parcel’s facts, for an account that never chose', async () => {
    await open(never);
    const card = offer()!;
    expect(within(card).getByText('One short email per parcel, to alex@example.com. Nothing else.')).toBeVisible();
    expect(card.previousElementSibling).toHaveClass('detail__hero');
    expect(card.nextElementSibling).toHaveClass('detail__information');
    // In the page, not over it.
    expect(card.closest('[role="dialog"]')).toHaveAccessibleName('New sneakers');
  });

  it.each([
    ['the parcel is still on its way', { ...never, stages: ON_ITS_WAY }],
    ['the account turned the email on', { stages: DELIVERED, preferences: { emailOnDelivery: true } }],
    ['the account turned it off or declined', { stages: DELIVERED, preferences: { emailOnDelivery: false } }],
    ['the server sends no email', { stages: DELIVERED, preferences: { emailOnDelivery: null, emailAvailable: false } }],
    ['the preferences are not read yet', { ...never, read: false }],
    ['the session names no address', { ...never, email: null }],
  ])('is not made when %s', async (_why, setup) => {
    await open(setup);
    expect(offer()).toBeNull();
    expect(screen.queryByText(/next one arrives/)).toBeNull();
  });

  it('turns the email on and leaves a line in its place', async () => {
    const { user, auth } = await open(never);
    await user.click(within(offer()!).getByRole('button', { name: 'Turn on' }));
    expect(saveNotificationPreferences).toHaveBeenCalledExactlyOnceWith({
      enabledStages: IMPORTANT, quietHoursStart: null, quietHoursEnd: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, emailOnDelivery: true,
    }, auth);
    expect(await screen.findByRole('status')).toHaveTextContent('Email is on. You can change it in Settings › Delivery updates.');
    expect(offer()).toBeNull();
    expect(mocks.track).toHaveBeenCalledWith('email-offer-accept', 'success');
    // The focus stays in the parcel's page rather than nowhere.
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'New sneakers' }));
  });

  it('goes for good on “Not now”: the server remembers the answer', async () => {
    const { user, auth, unmount } = await open(never);
    await user.click(within(offer()!).getByRole('button', { name: 'Not now' }));
    expect(saveNotificationPreferences).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ emailOnDelivery: false }), auth);
    await waitFor(() => expect(offer()).toBeNull());
    expect(screen.queryByRole('status')).toBeNull();
    expect(mocks.track).toHaveBeenCalledWith('email-offer-decline', 'success');
    expect(localStorage.length).toBe(0);
    // Another delivered parcel of the same sign-in does not ask again.
    unmount();
    render(<Detail initial={testParcel({ id: 'package-2', label: 'Coffee beans' }, DELIVERED)} auth={auth} email="alex@example.com" />);
    expect(offer()).toBeNull();
  });

  it('stays, with a word about it, when the answer could not be saved', async () => {
    const { user } = await open(never);
    vi.mocked(saveNotificationPreferences).mockRejectedValueOnce(new Error('offline'));
    await user.click(within(offer()!).getByRole('button', { name: 'Turn on' }));
    expect(await within(offer()!).findByRole('alert')).toHaveTextContent('Couldn’t save your email setting. Try again.');
    expect(mocks.track).toHaveBeenCalledWith('email-offer-accept', 'error');
    expect(within(offer()!).getByRole('button', { name: 'Turn on' })).toBeEnabled();
    // The other answer still works.
    await user.click(within(offer()!).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(offer()).toBeNull());
    expect(screen.queryByRole('status')).toBeNull();
  });
});
