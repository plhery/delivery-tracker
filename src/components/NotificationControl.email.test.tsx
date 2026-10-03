import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getNotificationPreferences,
  inspectPushState,
  saveNotificationPreferences,
  type NotificationPreferences,
} from '../lib/pushNotifications';
import de from '../../shared/locales/de.json';
import { I18nProvider } from '../i18n';
import { NotificationControl } from './NotificationControl';

const mocks = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../lib/pushNotifications', async (original) => ({
  ...await original<typeof import('../lib/pushNotifications')>(),
  inspectPushState: vi.fn(),
  updatePushNotificationLocale: vi.fn().mockResolvedValue(undefined),
  getNotificationPreferences: vi.fn(),
  saveNotificationPreferences: vi.fn(),
}));
vi.mock('../lib/analytics', async (original) => ({ ...await original<typeof import('../lib/analytics')>(), trackAction: mocks.track }));

const SAVED: NotificationPreferences = {
  enabledStages: ['out_for_delivery', 'delivered'],
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: 'Europe/Zurich',
  emailOnDelivery: false,
  emailAvailable: true,
};
/** What the server keeps: a request that leaves the email out does not change it. */
let stored: NotificationPreferences;

async function open(preferences: Partial<NotificationPreferences> = {}, email: string | null = 'alex@example.com') {
  stored = { ...SAVED, ...preferences };
  const apiAuth = { userId: 'user-1', getAccessToken: vi.fn().mockResolvedValue('token') };
  const user = userEvent.setup();
  render(<NotificationControl apiAuth={apiAuth} email={email ?? undefined} />);
  await user.click(await screen.findByRole('button', { name: 'Notifications enabled' }));
  await screen.findByRole('radio', { name: /delivery day only/i });
  return { user, apiAuth };
}
const section = () => screen.getByRole('region', { name: /^By email/ });
const emailSwitch = () => screen.getByRole('switch', { name: 'Email me when a parcel is delivered' });

beforeEach(() => {
  mocks.track.mockReset();
  vi.mocked(inspectPushState).mockReset().mockResolvedValue({ kind: 'enabled', publicKey: 'public' });
  vi.mocked(getNotificationPreferences).mockReset().mockImplementation(async () => stored);
  vi.mocked(saveNotificationPreferences).mockReset().mockImplementation(async (preferences) => {
    stored = { ...stored, ...preferences, emailOnDelivery: preferences.emailOnDelivery ?? stored.emailOnDelivery };
    return stored;
  });
});

describe('the delivery email in Settings', () => {
  it('stands after the event choice, with the address, an example and the privacy notice', async () => {
    await open();
    expect(within(section()).getByText('New')).toBeVisible();
    expect(emailSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(emailSwitch()).toHaveAccessibleDescription('To alex@example.com, the address you sign in with. One short email per parcel.');
    // After "Which updates?" and its Save button, before the note on how often tracking is checked.
    const order = (first: Element, second: Element) => first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(order(screen.getByRole('button', { name: 'Save preferences' }), section())).toBeTruthy();
    expect(order(section(), screen.getByText(/every 10 minutes from 08:00 to 22:00/i))).toBeTruthy();

    const example = within(section()).getByRole('link', { name: 'See an example' });
    expect(example).toHaveAttribute('href', '/email/example?lang=en');
    expect(example).toHaveAttribute('target', '_blank');
    expect(example).toHaveAttribute('rel', 'noopener');
    example.addEventListener('click', (event) => event.preventDefault());
    const privacy = within(section()).getByRole('link', { name: 'Privacy' });
    expect(privacy).toHaveAttribute('href', '/privacy.html');
    expect(privacy).not.toHaveAttribute('target');
    privacy.addEventListener('click', (event) => event.preventDefault());
    const user = userEvent.setup();
    await user.click(example);
    await user.click(privacy);
    expect(mocks.track.mock.calls).toEqual([['email-example-open'], ['privacy-open']]);
  });

  it.each([
    ['the server sends no email, or cannot write to this account', { emailAvailable: false }, 'alex@example.com'],
    ['the server says nothing about email', { emailAvailable: undefined, emailOnDelivery: undefined }, 'alex@example.com'],
    ['the session names no address', {}, null],
  ] as const)('shows nothing about email when %s', async (_why, preferences, email) => {
    await open(preferences, email);
    expect(screen.queryByText('By email')).toBeNull();
    expect(screen.queryByRole('switch', { name: /email/i })).toBeNull();
    expect(screen.queryByRole('link', { name: 'See an example' })).toBeNull();
  });

  it('saves at once, on its own: the last saved events, not the radios’ draft, and the state from the answer', async () => {
    const { user, apiAuth } = await open();
    // A draft of the radios that is not saved.
    await user.click(screen.getByRole('radio', { name: /all tracking updates/i }));
    await user.click(emailSwitch());
    expect(saveNotificationPreferences).toHaveBeenCalledExactlyOnceWith({
      enabledStages: ['out_for_delivery', 'delivered'],
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      emailOnDelivery: true,
    }, apiAuth);
    await waitFor(() => expect(emailSwitch()).toHaveAttribute('aria-checked', 'true'));
    expect(mocks.track).toHaveBeenCalledWith('email-delivery-change', 'success');
    // The draft is still there, unsaved.
    expect(screen.getByRole('radio', { name: /all tracking updates/i })).toBeChecked();
    expect(screen.queryByText('Preferences saved')).toBeNull();

    await user.click(emailSwitch());
    expect(saveNotificationPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ emailOnDelivery: false }), apiAuth);
    await waitFor(() => expect(emailSwitch()).toHaveAttribute('aria-checked', 'false'));
  });

  it('waits for the server: off and busy while saving, and no second save meanwhile', async () => {
    const { user } = await open();
    let answer!: (preferences: NotificationPreferences) => void;
    vi.mocked(saveNotificationPreferences).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    await user.click(emailSwitch());
    expect(emailSwitch()).toBeDisabled();
    expect(emailSwitch()).toHaveAttribute('aria-busy', 'true');
    expect(emailSwitch()).toHaveAttribute('aria-checked', 'false');
    // The event choice waits too, so the two saves cannot cross.
    expect(screen.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
    answer({ ...SAVED, emailOnDelivery: true });
    await waitFor(() => expect(emailSwitch()).toHaveAttribute('aria-checked', 'true'));
    expect(emailSwitch()).toBeEnabled();
    expect(saveNotificationPreferences).toHaveBeenCalledTimes(1);
  });

  it('stays as stored and says so when the save fails, then works again', async () => {
    const { user } = await open();
    // The server refuses to turn on an email it cannot send.
    vi.mocked(saveNotificationPreferences).mockRejectedValueOnce(new Error('Email is not available for this account'));
    await user.click(emailSwitch());
    expect(await within(section()).findByRole('alert')).toHaveTextContent('Couldn’t save your email setting. Try again.');
    expect(emailSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(emailSwitch()).toBeEnabled();
    expect(mocks.track).toHaveBeenCalledWith('email-delivery-change', 'error');

    await user.click(emailSwitch());
    await waitFor(() => expect(emailSwitch()).toHaveAttribute('aria-checked', 'true'));
    expect(within(section()).queryByRole('alert')).toBeNull();
  });

  it('keeps the email choice when the events are saved afterwards', async () => {
    const { user, apiAuth } = await open();
    await user.click(emailSwitch());
    await waitFor(() => expect(emailSwitch()).toHaveAttribute('aria-checked', 'true'));
    await user.click(screen.getByRole('radio', { name: /all tracking updates/i }));
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByText('Preferences saved')).toBeVisible();
    const [sent, auth] = vi.mocked(saveNotificationPreferences).mock.calls[1];
    expect(auth).toBe(apiAuth);
    // The request leaves the email out, and the server keeps what it has.
    expect(Object.keys(sent).sort()).toEqual(['enabledStages', 'quietHoursEnd', 'quietHoursStart', 'timezone']);
    expect(emailSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /all tracking updates/i })).toBeChecked();
  });

  it('links the example in the reader’s language', async () => {
    stored = { ...SAVED, emailOnDelivery: true };
    const apiAuth = { userId: 'user-1', getAccessToken: vi.fn().mockResolvedValue('token') };
    render(<I18nProvider initialLocale="de" initialMessages={de}><NotificationControl apiAuth={apiAuth} email="alex@example.com" /></I18nProvider>);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Benachrichtigungen aktiviert' }));
    expect(await screen.findByRole('switch', { name: 'E-Mail, sobald ein Paket zugestellt ist' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('link', { name: 'Beispiel ansehen' })).toHaveAttribute('href', '/email/example?lang=de');
    expect(screen.getByRole('link', { name: 'Datenschutz' })).toHaveAttribute('href', '/privacy.html');
  });
});
