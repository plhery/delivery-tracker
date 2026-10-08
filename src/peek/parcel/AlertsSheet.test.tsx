import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPHONE_SAFARI, IPHONE_SAFARI_27, restoreAlertBrowser, stubAlertBrowser, TEST_PUSH_ENDPOINT, TEST_PUSH_KEY } from '../../test/alertBrowser';
import { LINK_ID, OWNER_KEY } from '../../test/parcelLinks';
import { forgetAllLinkNotes, linkNote, noteLink } from '../deviceNotes';
import { ParcelLinkError, type ParcelAlerts } from '../links';
import { AlertsSheet } from './AlertsSheet';

const mocks = vi.hoisted(() => ({ set: vi.fn(), remove: vi.fn(), track: vi.fn() }));
vi.mock('../links', async (original) => ({ ...await original<typeof import('../links')>(), setParcelAlert: mocks.set, removeParcelAlert: mocks.remove }));
vi.mock('../../lib/analytics', async (original) => ({ ...await original<typeof import('../../lib/analytics')>(), trackAction: mocks.track }));

const SERVER: ParcelAlerts = { available: true, vapidPublicKey: TEST_PUSH_KEY };
const WINDOW = 'Today, 13:00–17:00';

function open(props: Partial<Parameters<typeof AlertsSheet>[0]> = {}) {
  const handlers = { onCalendar: vi.fn(() => true), onSignIn: vi.fn(), onClose: vi.fn() };
  const view = render(<AlertsSheet linkId={LINK_ID} ownerKey={null} alerts={SERVER} initialPreset="important" calendar={WINDOW} {...handlers} {...props} />);
  return { ...handlers, ...view };
}
const preset = (name: string) => screen.getByRole('button', { name });
const way = (name: RegExp) => screen.getByRole('radio', { name });

beforeEach(() => {
  mocks.set.mockReset().mockResolvedValue(undefined);
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.track.mockReset();
});
afterEach(() => {
  restoreAlertBrowser();
  forgetAllLinkNotes();
});

describe('the Ping me sheet', () => {
  it('offers this browser’s notifications and the calendar, chooses what to hear about, and asks the browser only on “Turn on”', async () => {
    const { requestPermission, pushManager } = stubAlertBrowser();
    const user = userEvent.setup();
    open({ ownerKey: OWNER_KEY });
    const sheet = screen.getByRole('dialog', { name: 'Ping me when it arrives' });
    expect(way(/^Notifications in this browser/)).toBeChecked();
    expect(within(sheet).getByText('Works while this page is closed. Stops when the parcel is delivered.')).toBeVisible();
    expect(way(/^Add the delivery window to my calendar/)).not.toBeChecked();
    expect(within(sheet).getByText('Today, 13:00–17:00 · a calendar file, nothing to send')).toBeVisible();
    const group = screen.getByRole('group', { name: 'Tell me about' });
    expect(within(group).getAllByRole('button').map((button) => [button.textContent, button.getAttribute('aria-pressed')]))
      .toEqual([['Every scan', 'false'], ['Important steps', 'true'], ['Delivery only', 'false']]);
    // Opening the sheet asked nothing of the browser.
    expect(requestPermission).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();

    await user.click(preset('Delivery only'));
    expect(preset('Delivery only')).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.set).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith(LINK_ID, {
      subscription: { endpoint: TEST_PUSH_ENDPOINT, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } }, preset: 'delivery', locale: 'en',
    }, OWNER_KEY);
    expect(await screen.findByText('Alerts are on in this browser')).toBeVisible();
    expect(screen.getByText('Peek pings this browser until the parcel is delivered.')).toBeVisible();
    expect(linkNote(LINK_ID).alert).toEqual({ preset: 'delivery', endpoint: TEST_PUSH_ENDPOINT });
    expect(mocks.track).toHaveBeenCalledWith('parcel-link-alerts', 'success');
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull();
  });

  it('once on, changes what it announces at once, and turns off', async () => {
    stubAlertBrowser({ permission: 'granted', existing: true });
    noteLink(LINK_ID, { alert: { preset: 'important', endpoint: TEST_PUSH_ENDPOINT } });
    const user = userEvent.setup();
    open();
    expect(screen.getByText('Alerts are on in this browser')).toBeVisible();
    expect(preset('Important steps')).toHaveAttribute('aria-pressed', 'true');
    await user.click(preset('Every scan'));
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith(LINK_ID, expect.objectContaining({ preset: 'all' }), null);
    await waitFor(() => expect(preset('Every scan')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('status')).toHaveTextContent('Preferences saved');
    // A change is not a second "turned on".
    expect(mocks.track).not.toHaveBeenCalledWith('parcel-link-alerts', 'success');

    mocks.set.mockRejectedValueOnce(new ParcelLinkError('offline'));
    await user.click(preset('Delivery only'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/connection/i);
    expect(preset('Every scan')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(LINK_ID, TEST_PUSH_ENDPOINT);
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeVisible();
    expect(linkNote(LINK_ID).alert).toBeUndefined();
    expect(mocks.track).toHaveBeenCalledWith('parcel-link-alerts-off', 'success');
  });

  it('keeps the alert on, and says so, when it cannot be turned off', async () => {
    stubAlertBrowser({ permission: 'granted', existing: true });
    noteLink(LINK_ID, { alert: { preset: 'important', endpoint: TEST_PUSH_ENDPOINT } });
    mocks.remove.mockRejectedValueOnce(new ParcelLinkError('server'));
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t update alert settings. Try again.');
    expect(screen.getByText('Alerts are on in this browser')).toBeVisible();
    expect(mocks.track).toHaveBeenCalledWith('parcel-link-alerts-off', 'error');
  });

  it('forgets an alert the browser no longer has, and offers to turn it on again', async () => {
    stubAlertBrowser({ permission: 'granted' });
    noteLink(LINK_ID, { alert: { preset: 'important', endpoint: TEST_PUSH_ENDPOINT } });
    open();
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeVisible();
    expect(linkNote(LINK_ID).alert).toBeUndefined();
  });

  it('says what to do when the browser refuses, and when the prompt is closed without an answer', async () => {
    const refused = stubAlertBrowser({ answer: 'denied' });
    const user = userEvent.setup();
    const first = open();
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Notifications are blocked for this site. Allow them in your browser’s site settings, then turn on again.');
    // Blocked now: the way is no longer offered, and the calendar is what remains.
    expect(way(/^Notifications in this browser/)).toBeDisabled();
    expect(way(/^Add the delivery window to my calendar/)).toBeChecked();
    expect(screen.queryByRole('group', { name: 'Tell me about' })).toBeNull();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith('parcel-link-alerts', 'error');
    expect(refused.pushManager.subscribe).not.toHaveBeenCalled();
    first.unmount();

    stubAlertBrowser({ answer: 'default' });
    open();
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The browser didn’t get a yes. Choose Turn on to be asked again.');
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeEnabled();
  });

  it('opens on plain guidance where notifications are blocked, missing, or not sent by this server', () => {
    stubAlertBrowser({ permission: 'denied' });
    const blocked = open();
    expect(way(/^Notifications in this browser/)).toBeDisabled();
    expect(screen.getByText('Notifications are blocked for this site. Allow them in your browser’s site settings, then turn on again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add to calendar' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull();
    blocked.unmount();

    vi.stubGlobal('Notification', undefined);
    const missing = open();
    expect(screen.getByText('This browser can’t show notifications.')).toBeVisible();
    missing.unmount();

    stubAlertBrowser();
    open({ alerts: { available: false, vapidPublicKey: null }, calendar: null });
    expect(screen.getByText('Alerts are temporarily unavailable. Try again later.')).toBeVisible();
    // Nothing can be done here: no button pretends otherwise.
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  it.each([
    [new ParcelLinkError('full'), 'This parcel already pings as many browsers as it can.'],
    [new ParcelLinkError('unconfigured'), 'Alerts are temporarily unavailable. Try again later.'],
    [new ParcelLinkError('stopped'), 'This parcel isn’t shared anymore'],
    [new ParcelLinkError('unavailable'), 'This parcel has been forgotten'],
    [new ParcelLinkError('server'), 'Couldn’t turn on alerts. Check your connection and try again.'],
  ])('says why the server refused: %s', async (refusal, message) => {
    const { subscription } = stubAlertBrowser();
    mocks.set.mockRejectedValueOnce(refusal);
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeEnabled();
    expect(linkNote(LINK_ID).alert).toBeUndefined();
    // The subscription made for this alert alone is dropped again.
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('adds the delivery window to the calendar instead, and says when the file could not be made', async () => {
    stubAlertBrowser();
    const user = userEvent.setup();
    const { onCalendar } = open();
    await user.click(way(/^Add the delivery window to my calendar/));
    expect(screen.queryByRole('group', { name: 'Tell me about' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(onCalendar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Calendar file ready');
    expect(mocks.track).toHaveBeenCalledWith('parcel-link-calendar', 'success');
    onCalendar.mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t make the calendar file. Try again.');
    expect(mocks.track).toHaveBeenCalledWith('parcel-link-calendar', 'error');
  });

  it('offers no calendar without an estimate', () => {
    stubAlertBrowser();
    open({ calendar: null });
    expect(screen.queryByRole('radio', { name: /calendar/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeVisible();
  });

  it('invites a visitor to sign in for what an account does, and promises no email', async () => {
    stubAlertBrowser();
    const user = userEvent.setup();
    const { onSignIn, onClose, unmount } = open();
    expect(screen.getByText('Alerts on all your devices')).toBeVisible();
    expect(screen.getByText('Sign in, and this parcel joins your deliveries, with alerts wherever you turn them on.')).toBeVisible();
    expect(document.body).not.toHaveTextContent(/e-?mail/i);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSignIn).toHaveBeenCalledTimes(1);
    unmount();
    // Someone signed in already has an account.
    open({ onSignIn: undefined });
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('says what signing in adds where the server emails accounts: an email when the parcel arrives', async () => {
    stubAlertBrowser();
    const user = userEvent.setup();
    const { onSignIn, onClose, unmount } = open({ alerts: { ...SERVER, email: true } });
    expect(screen.getByText('An email when it arrives')).toBeVisible();
    expect(screen.getByText('Sign in, and Peek writes to the address you sign in with.')).toBeVisible();
    expect(screen.queryByText('Alerts on all your devices')).toBeNull();
    // The browser's own alerts are offered as before.
    expect(way(/^Notifications in this browser/)).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSignIn).toHaveBeenCalledTimes(1);
    unmount();
    // Someone signed in is not asked to.
    open({ alerts: { ...SERVER, email: true }, onSignIn: undefined });
    expect(document.body).not.toHaveTextContent(/e-?mail/i);
  });

  it('keeps saying it once this browser’s alerts are on', () => {
    stubAlertBrowser({ permission: 'granted', existing: true });
    noteLink(LINK_ID, { alert: { preset: 'important', endpoint: TEST_PUSH_ENDPOINT } });
    open({ alerts: { ...SERVER, email: true } });
    expect(screen.getByText('Alerts are on in this browser')).toBeVisible();
    expect(screen.getByText('An email when it arrives')).toBeVisible();
  });

  it('shows an iPhone outside its Home Screen app the steps there instead of a button that cannot work', async () => {
    const { requestPermission } = stubAlertBrowser({ userAgent: IPHONE_SAFARI });
    const user = userEvent.setup();
    const { onCalendar, onSignIn } = open();
    const sheet = screen.getByRole('dialog', { name: 'Alerts on iPhone' });
    expect(within(sheet).getByText('Safari only sends notifications from sites on your Home Screen.')).toBeVisible();
    expect(within(sheet).getAllByRole('listitem').map((step) => step.textContent))
      .toEqual(['1Open your browser’s Share menu', '2Choose Add to Home Screen', '3Open Peek from your Home Screen and tap Ping me']);
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Or add to calendar' }));
    expect(onCalendar).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Sign in for alerts on all your devices' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('starts Safari 27 from the page menu of its address bar, drawn with the site’s address', () => {
    stubAlertBrowser({ userAgent: IPHONE_SAFARI_27 });
    open();
    const steps = within(screen.getByRole('dialog', { name: 'Alerts on iPhone' })).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      `1Tap Page Menu in Safari’s address bar${window.location.hostname}`,
      '2Tap Share',
      '3Tap View More, then Add to Home Screen',
      '4Open Peek from your Home Screen and tap Ping me',
    ]);
    // The drawing repeats what the sentence says, so it is kept from screen readers.
    expect(within(steps[0]).getByText(window.location.hostname).closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('in the demo says that nothing is sent, before and after turning on', async () => {
    const { pushManager } = stubAlertBrowser();
    const user = userEvent.setup();
    open({ alerts: { available: true, vapidPublicKey: null } });
    expect(screen.getByText('This is the demo: nothing is sent.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('Alerts are on in this browser')).toBeVisible();
    expect(screen.getByText('This is the demo: nothing is sent.')).toBeVisible();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(linkNote(LINK_ID).alert!.endpoint).toMatch(/^demo:/);
  });

  it('starts from the preset the page proposes, and closes on Escape', async () => {
    stubAlertBrowser();
    const user = userEvent.setup();
    const { onClose } = open({ initialPreset: 'all' });
    expect(preset('Every scan')).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
