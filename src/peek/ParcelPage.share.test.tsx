import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreAlertBrowser, stubAlertBrowser } from '../test/alertBrowser';
import { LINK_ID, OWNER_KEY, testView } from '../test/parcelLinks';
import type { ParcelWithEvents, Stage, TrackingEvent } from '../types';
import { forgetAllLinkNotes, linkNote, noteLink } from './deviceNotes';
import { ParcelLinkError, type ParcelLinkView } from './links';
import { ParcelPage } from './ParcelPage';
import { NoticeToast } from './parcel/Toast';
import { forgetAllRecents, recentFor, rememberParcel } from './recents';
import { PeekSessionProvider, type PeekSession } from './session';

const mocks = vi.hoisted(() => ({ read: vi.fn(), forget: vi.fn(), update: vi.fn(), set: vi.fn(), remove: vi.fn(), download: vi.fn() }));
vi.mock('./links', async (original) => ({
  ...await original<typeof import('./links')>(),
  readParcelLink: mocks.read, forgetParcelLink: mocks.forget, updateParcelLink: mocks.update, setParcelAlert: mocks.set, removeParcelAlert: mocks.remove,
}));
vi.mock('./parcel/calendar', async (original) => ({ ...await original<typeof import('./parcel/calendar')>(), downloadCalendar: mocks.download }));

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
const scan = (stage: Stage, hoursAgo: number, description = `Scan at ${stage}`, extra: Partial<TrackingEvent> = {}): TrackingEvent =>
  ({ id: `${stage}-${hoursAgo}`, parcelId: 'parcel-1', stage, description, occurredAt: ago(hoursAgo), ...extra });
const journey = [scan('registered', 50), scan('accepted', 30), scan('in_transit', 6)];
const arrived = [...journey, scan('out_for_delivery', 3), scan('delivered', 0)];

function view({ events = journey, parcel = {}, owner = true, link = {} }: {
  events?: TrackingEvent[];
  parcel?: Partial<ParcelWithEvents>;
  owner?: boolean;
  link?: Partial<ParcelLinkView['link']>;
} = {}): ParcelLinkView {
  const shown = testView({ owner, parcel: { lastSyncedAt: ago(2 / 60), createdAt: ago(100), expectedDelivery: '2099-01-05', ...parcel } });
  return {
    ...shown,
    link: { ...shown.link, gift: false, shared: true, alerts: { available: true, vapidPublicKey: null }, ...link },
    parcel: { ...shown.parcel, events },
  };
}

/** Opens the page; as the owner, this device holds the link's key. */
function open(shown: ParcelLinkView, { session, hash = '' }: { session?: PeekSession; hash?: string } = {}) {
  history.replaceState(null, '', `/p/${LINK_ID}${hash}`);
  if (shown.link.role === 'owner') rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: shown });
  mocks.read.mockResolvedValue(shown);
  const page = <><ParcelPage linkId={LINK_ID} /><NoticeToast /></>;
  return render(session ? <PeekSessionProvider value={session}>{page}</PeekSessionProvider> : page);
}
const actions = () => within(document.querySelector<HTMLElement>('.peekp-actions')!);
const signedIn: PeekSession = { account: 'signed-in', signIn: () => undefined, deliveries: [], openDeliveries: () => undefined, keep: async () => ({ id: LINK_ID, outcome: 'kept', name: null }) };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.forget.mockResolvedValue(undefined);
  mocks.set.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.download.mockReturnValue(true);
  document.title = 'Peek — Universal Parcel Tracker';
});
afterEach(() => {
  restoreAlertBrowser();
  forgetAllRecents();
  forgetAllLinkNotes();
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'clipboard');
  history.replaceState(null, '', '/');
});

describe('the parcel page of a recipient', () => {
  it('says it was shared and needs no account, masks the number without a way to copy it, and offers alerts and the calendar', async () => {
    const user = userEvent.setup();
    open(view({ owner: false }), { hash: `#n=${encodeURIComponent('For Mum')}` });
    expect(await screen.findByText('Shared with you · no account needed')).toBeVisible();
    expect(screen.getByText('For Mum')).toBeVisible();
    expect(screen.getByText('Tracking number').parentElement).toHaveTextContent('••• 99');
    expect(screen.queryByRole('button', { name: 'Copy tracking number' })).toBeNull();
    expect(actions().getAllByRole('button').map((button) => button.textContent)).toEqual(['Ping me', 'Add to calendar', 'Edit parcel name']);
    // The alerts are among the actions: the card's corner stays empty.
    expect(document.querySelector('.peekp-bell')).toBeNull();
    // Forgetting is the owner's, and so is choosing what the link shows.
    expect(screen.queryByRole('button', { name: 'Forget it now' })).toBeNull();
    expect(actions().queryByRole('button', { name: 'Share' })).toBeNull();
    // A masked number cannot be kept.
    expect(screen.queryByRole('button', { name: /Create an account/ })).toBeNull();

    await user.click(actions().getByRole('button', { name: 'Add to calendar' }));
    expect(mocks.download).toHaveBeenCalledTimes(1);
    const file = String(mocks.download.mock.calls[0][0]);
    expect(file).toContain('DTSTART;VALUE=DATE:20990105');
    expect(file).toContain('SUMMARY:For Mum');
    expect(file).toContain(`URL:http://localhost/p/${LINK_ID}\r\n`);
    expect(await screen.findByText('Calendar file ready')).toBeVisible();
    mocks.download.mockReturnValueOnce(false);
    await user.click(actions().getByRole('button', { name: 'Add to calendar' }));
    expect(await screen.findByText('Couldn’t make the calendar file. Try again.')).toBeVisible();
  });

  it('offers keeping only when the link shows its number, and no calendar without an estimate', async () => {
    open(view({ owner: false, link: { numberShown: true, canKeep: true }, parcel: { trackingNumber: '1234567899', expectedDelivery: undefined } }));
    expect(await screen.findByRole('button', { name: /Create an account/ })).toBeVisible();
    expect(actions().queryByRole('button', { name: 'Add to calendar' })).toBeNull();
    expect(actions().getByRole('button', { name: 'Ping me' })).toBeVisible();
  });

  it('tells a recipient how long the link works once the parcel is delivered, in place of the footer’s line', async () => {
    const moving = open(view({ owner: false }));
    expect(await screen.findByText('Shared with you · no account needed')).toBeVisible();
    expect(screen.getByText('Peek forgets this parcel 30 days after delivery.')).toBeVisible();
    moving.unmount();
    const delivered = open(view({ owner: false, events: arrived }));
    expect(await screen.findByText('Shared with you · the link works until 30 dec')).toBeVisible();
    expect(screen.queryByText(/Peek forgets this parcel/)).toBeNull();
    delivered.unmount();
    // Someone signed in reads the same day; a link from an account has none.
    const account = open(view({ owner: false, events: arrived }), { session: signedIn });
    expect(await screen.findByText('Shared with you · the link works until 30 dec')).toBeVisible();
    account.unmount();
    open(view({ owner: false, events: arrived, link: { kind: 'shared', forgetAt: null } }));
    expect(await screen.findByText('Shared with you · no account needed')).toBeVisible();
    expect(screen.queryByText(/Peek forgets this parcel/)).toBeNull();
  });

  it('shares the plain link from the header: the owner’s sheet is not a recipient’s', async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    const user = userEvent.setup();
    open(view({ owner: false }), { hash: '#n=For%20Mum' });
    await user.click(await screen.findByRole('button', { name: 'Share this parcel' }));
    expect(share).toHaveBeenCalledWith({ url: `http://localhost/p/${LINK_ID}` });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tells someone signed in that it was shared, and tells the owner nothing of the kind', async () => {
    const { unmount } = open(view({ owner: false }), { session: signedIn });
    expect(await screen.findByText('Shared with you')).toBeVisible();
    expect(screen.queryByText(/no account needed/)).toBeNull();
    unmount();
    open(view());
    expect(await screen.findByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    expect(screen.queryByText(/Shared with you/)).toBeNull();
  });
});

describe('the parcel page of a link’s owner', () => {
  it('opens the share sheet from the actions and from the header, and takes its changes', async () => {
    const user = userEvent.setup();
    mocks.update.mockImplementation(async (_id: string, _key: string, changes: object) => view({ link: changes }));
    open(view());
    await user.click(await screen.findByRole('button', { name: 'Share' }));
    const sheet = screen.getByRole('dialog', { name: 'Share this parcel' });
    await user.click(within(sheet).getByRole('switch', { name: 'Wrap as a gift' }));
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(LINK_ID, OWNER_KEY, { gift: true });
    // The owner keeps the usual page, marked as a gift, and the device keeps the answer.
    expect(await screen.findByText('Gift')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    await waitFor(() => expect(recentFor(LINK_ID)!.snapshot.link.gift).toBe(true));
    expect(within(sheet).getByRole('textbox', { name: 'From' })).toBeVisible();

    await user.click(within(sheet).getByRole('button', { name: 'Stop sharing' }));
    expect(await within(sheet).findByText('Sharing is stopped. The link shows nothing to anyone else.')).toBeVisible();
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // The page says so too.
    expect(screen.getByText('Sharing is stopped. The link shows nothing to anyone else.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Share this parcel' }));
    expect(screen.getByRole('dialog', { name: 'Share this parcel' })).toBeVisible();
  });

  it('says in the share sheet until when the link works once the parcel is delivered, and takes a visitor from there to the sign-in', async () => {
    const signIn = vi.fn();
    const user = userEvent.setup();
    const moving = open(view(), { session: { account: 'visitor', signIn } });
    await user.click(await actions().findByRole('button', { name: 'Share' }));
    // On its way there is no day to name yet, and the card shows the parcel as a recipient gets it.
    expect(within(screen.getByRole('dialog')).queryByText(/Works until/)).toBeNull();
    expect(within(screen.getByRole('group', { name: 'What they’ll see' })).getByText('In transit')).toBeVisible();
    moving.unmount();
    const delivered = open(view({ events: arrived }), { session: { account: 'visitor', signIn } });
    await user.click(await actions().findByRole('button', { name: 'Share' }));
    const sheet = within(screen.getByRole('dialog', { name: 'Share this parcel' }));
    expect(sheet.getByText(/^Works until 30 dec/)).toBeVisible();
    await user.click(sheet.getByRole('button', { name: 'Keep it longer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(signIn).toHaveBeenCalledExactlyOnceWith(LINK_ID);
    delivered.unmount();
    // Someone signed in adds the parcel from the page: the sheet only says the day.
    open(view({ events: arrived }), { session: signedIn });
    await user.click(await actions().findByRole('button', { name: 'Share' }));
    expect(within(screen.getByRole('dialog')).getByText('Works until 30 dec')).toBeVisible();
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Keep it longer' })).toBeNull();
  });

  it('hands the keyboard back to the button that opened a sheet, in a browser that leaves a clicked button unfocused', async () => {
    const user = userEvent.setup();
    open(view());
    const share = await actions().findByRole('button', { name: 'Share' });
    // Safari's click: the button is pressed without taking the focus.
    fireEvent.click(share);
    expect(screen.getByRole('dialog', { name: 'Share this parcel' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(share).toHaveFocus();

    const ping = actions().getByRole('button', { name: /^Ping me/ });
    fireEvent.click(ping);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Ping me when it arrives' })).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ping).toHaveFocus();
  });

  it('offers to show the name in the share sheet once the parcel has one', async () => {
    const user = userEvent.setup();
    open(view());
    await user.click(await screen.findByRole('button', { name: 'Share' }));
    // Without a name there is nothing to show: the sheet has two switches.
    expect(within(screen.getByRole('dialog')).getAllByRole('switch')).toHaveLength(2);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await user.click(actions().getByRole('button', { name: 'Name it' }));
    await user.type(screen.getByRole('textbox', { name: 'Parcel name' }), 'New sneakers{Enter}');
    expect(recentFor(LINK_ID)!.name).toBe('New sneakers');
    await user.click(actions().getByRole('button', { name: 'Share' }));
    const name = screen.getByRole('switch', { name: 'Show its name' });
    expect(name).toHaveAccessibleDescription('New sneakers');
    await user.click(name);
    expect(within(screen.getByRole('group', { name: 'What they’ll see' })).getByText('New sneakers')).toBeVisible();
  });

  it('words the way to the alerts by where the parcel is, and drops it once the journey is over', async () => {
    const moving = open(view());
    // Short on a phone, and with what it promises where there is room.
    expect((await screen.findByRole('button', { name: /^Ping me/ })).textContent).toBe('Ping mePing me when it arrives');
    expect(document.querySelector('.peekp-actions--led')).toBeNull();
    moving.unmount();

    // Not scanned yet: being told is the one next step.
    const announced = open(view({ events: [scan('registered', 50)] }));
    const lead = await screen.findByRole('button', { name: 'Ping me when it moves' });
    expect(lead).toHaveClass('button--primary');
    expect(actions().getAllByRole('button').map((button) => button.textContent)).toEqual(['Ping me when it moves', 'Share', 'Name it']);
    announced.unmount();

    const unknown = open(view({ events: [scan('pending', 50, 'Tracking added')], parcel: { carrier: 'unknown', syncStatus: 'waiting' } }));
    expect(await screen.findByRole('button', { name: 'Ping me when it’s found' })).toBeVisible();
    unknown.unmount();

    const delivered = open(view({ events: arrived, parcel: { expectedDelivery: undefined } }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Delivered' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Ping me/ })).toBeNull();
    delivered.unmount();
    open(view({ events: [...journey, scan('returned', 1)] }));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: /Ping me/ })).toBeNull();
  });

  it('turns alerts on from the sheet, proposing every scan for a parcel that has not moved yet, and says they are on', async () => {
    stubAlertBrowser();
    const user = userEvent.setup();
    open(view({ events: [scan('registered', 50)] }));
    await user.click(await screen.findByRole('button', { name: 'Ping me when it moves' }));
    const sheet = screen.getByRole('dialog', { name: 'Ping me when it arrives' });
    expect(within(sheet).getByRole('button', { name: 'Every scan' })).toHaveAttribute('aria-pressed', 'true');
    // The calendar is the sheet's other way, with the estimate in words.
    expect(within(sheet).getByRole('radio', { name: /^Add the delivery window to my calendar/ })).toBeVisible();
    await user.click(within(sheet).getByRole('button', { name: 'Turn on' }));
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith(LINK_ID, expect.objectContaining({ preset: 'all', locale: 'en' }), OWNER_KEY);
    expect(await within(sheet).findByText('Alerts are on in this browser')).toBeVisible();
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    // The alerts are no longer the next step: the row says they are on.
    expect(actions().getAllByRole('button').map((button) => button.textContent)).toEqual(['Alerts on', 'Share', 'Name it']);
    expect(document.querySelector('.peekp-actions--led')).toBeNull();
  });

  it('believes the browser about an alert it noted: one the browser dropped is no longer on', async () => {
    stubAlertBrowser({ permission: 'denied' });
    noteLink(LINK_ID, { alert: { preset: 'all', endpoint: 'demo:1' } });
    open(view());
    expect(await screen.findByRole('button', { name: /^Ping me/ })).toBeVisible();
    await waitFor(() => expect(linkNote(LINK_ID).alert).toBeUndefined());
    expect(actions().queryByRole('button', { name: 'Alerts on' })).toBeNull();
  });

  it('offers a visitor the sign-in from the alerts, and not someone signed in', async () => {
    stubAlertBrowser();
    const signIn = vi.fn();
    const user = userEvent.setup();
    const visitor = open(view(), { session: { account: 'visitor', signIn } });
    await user.click(await screen.findByRole('button', { name: /^Ping me/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign in' }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith(LINK_ID);
    expect(screen.queryByRole('dialog')).toBeNull();
    visitor.unmount();
    open(view(), { session: signedIn });
    await user.click(await screen.findByRole('button', { name: /^Ping me/ }));
    expect(screen.getByRole('dialog', { name: 'Ping me when it arrives' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('once delivered offers “I have it”: keep the parcel until Peek forgets it, or forget it now', async () => {
    noteLink(LINK_ID, { alert: { preset: 'all', endpoint: 'demo:1' } });
    const user = userEvent.setup();
    open(view({ events: arrived, parcel: { expectedDelivery: undefined } }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Delivered' })).toBeVisible();
    expect(actions().getAllByRole('button').map((button) => button.textContent)).toEqual(['I have it', 'Share', 'Name it']);
    // The alerts ended with the delivery.
    await waitFor(() => expect(linkNote(LINK_ID).alert).toBeUndefined());

    await user.click(actions().getByRole('button', { name: 'I have it' }));
    const dialog = screen.getByRole('dialog', { name: 'Glad it arrived' });
    expect(dialog).toHaveTextContent(/^Glad it arrivedPeek forgets this parcel on \d+ \p{L}+\. Forget this parcel now, or keep it until Peek forgets it by itself\./u);
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.forget).not.toHaveBeenCalled();
    expect(recentFor(LINK_ID)).not.toBeNull();

    await user.click(actions().getByRole('button', { name: 'I have it' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Forget it now' }));
    await waitFor(() => expect(mocks.forget).toHaveBeenCalledExactlyOnceWith(LINK_ID, OWNER_KEY));
    await waitFor(() => expect(recentFor(LINK_ID)).toBeNull());
    expect(await screen.findByText('Parcel forgotten')).toBeVisible();
  });

  it('does not offer “I have it” to a recipient, or for a parcel shared from an account', async () => {
    const recipient = open(view({ owner: false, events: arrived }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Delivered' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'I have it' })).toBeNull();
    recipient.unmount();
    open(view({ events: arrived, link: { kind: 'shared', forgetAt: null } }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Delivered' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'I have it' })).toBeNull();
  });
});

describe('a gift', () => {
  const words = `#n=${encodeURIComponent('trail running shoes')}&g=${encodeURIComponent('Happy birthday, Alex!')}&f=Sam`;
  const origin = (id: string, hoursAgo: number): TrackingEvent => ({ id, parcelId: 'parcel-1', stage: 'in_transit', description: 'Left the sender', location: 'DE', occurredAt: ago(hoursAgo) });
  const wrapped = (events: TrackingEvent[] = [origin('a', 30), origin('b', 28), origin('c', 26), scan('customs', 10, 'Cleared customs', { location: 'Basel, Switzerland' }), scan('out_for_delivery', 2, 'With the courier')]) =>
    view({ owner: false, link: { gift: true }, events, parcel: { expectedDelivery: '2099-01-05', senderName: undefined } });

  it('on its way is wrapped: something is coming, when, and nothing the link carries about what or from whom', async () => {
    open(wrapped(), { hash: words });
    expect(await screen.findByRole('heading', { level: 1, name: 'Something’s on its way to you' })).toBeVisible();
    const card = screen.getByRole('region', { name: 'Something’s on its way to you' });
    expect(card).toHaveClass('peekp-card--gift', 'peekp-card--wrapped', 'peekp-card--hero');
    expect(within(card).getByText(/^Arrives /)).toBeVisible();
    expect(within(card).getByLabelText('DHL')).toBeVisible();
    // Pip wears the ribbon instead of a label, and stays a drawing.
    expect(card.querySelector('.parcel-illustration__ribbon')).not.toBeNull();
    expect(card.querySelector('.parcel-illustration__label')).toBeNull();
    expect(card.querySelector('svg.parcel-illustration')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('What’s inside and who sent it stay a surprise until it’s delivered.')).toBeVisible();

    // The browser has the name, the note and the signature; the page shows none of them, anywhere.
    expect(location.hash).toBe(words);
    expect(document.body).not.toHaveTextContent(/trail running|Happy birthday|Sam\b|Inside:/);
    expect(document.title).toBe('Something’s on its way to you · Peek');
    expect(recentFor(LINK_ID)).toMatchObject({ name: null });
    // No number, no carrier page, no header controls, no sharing on.
    expect(screen.queryByText('Tracking number')).toBeNull();
    expect(screen.queryByRole('link', { name: /website/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share this parcel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Track another parcel' })).toBeNull();
    expect(screen.queryByText(/Shared with you/)).toBeNull();
    // The way into the alerts is in the card's corner; the row keeps the calendar.
    expect(actions().getAllByRole('button').map((button) => button.textContent)).toEqual(['Add to calendar']);
    const bell = within(card).getByRole('button', { name: 'Ping me' });
    fireEvent.click(bell);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Ping me when it arrives' })).getByRole('button', { name: 'Close' }));
    expect(bell).toHaveFocus();
  });

  it('turns alerts on from the card, which then says they are on, and has no row of actions without a delivery window', async () => {
    stubAlertBrowser();
    const user = userEvent.setup();
    const shown = wrapped();
    open({ ...shown, parcel: { ...shown.parcel, expectedDelivery: undefined } }, { hash: words });
    const card = await screen.findByRole('region', { name: 'Something’s on its way to you' });
    await user.click(within(card).getByRole('button', { name: 'Ping me' }));
    const sheet = screen.getByRole('dialog', { name: 'Ping me when it arrives' });
    await user.click(within(sheet).getByRole('button', { name: 'Turn on' }));
    expect(await within(sheet).findByText('Alerts are on in this browser')).toBeVisible();
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(within(card).getByRole('button', { name: 'Alerts on' })).toHaveAttribute('data-on', 'true');
    expect(document.querySelector('.peekp-actions')).toBeNull();
  });

  it('tells where it comes from once: the scans the server blurred alike are one row', async () => {
    const newest = origin('c', 26);
    open(wrapped([origin('a', 30), origin('b', 28), newest, scan('customs', 10, 'Cleared customs', { location: 'Basel, Switzerland' }), scan('out_for_delivery', 2, 'With the courier')]), { hash: words });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getAllByText('Left the sender')).toHaveLength(1);
    expect(screen.getByText('3 updates')).toBeVisible();
    // The row keeps the newest of the blurred scans, and names no more than the country.
    const row = screen.getByText('Left the sender').closest('li')!;
    expect(row).toHaveTextContent('Germany');
    expect(row.querySelector('time')).toHaveAttribute('datetime', newest.occurredAt);
  });

  it('adds a wrapped gift to the calendar without its name', async () => {
    const user = userEvent.setup();
    open(wrapped(), { hash: words });
    await user.click(await screen.findByRole('button', { name: 'Add to calendar' }));
    const file = String(mocks.download.mock.calls[0][0]);
    expect(file).toContain('SUMMARY:Something’s on its way to you');
    expect(file).not.toMatch(/trail|birthday|Sam/);
  });

  it('once delivered is unwrapped: it is here, with the note, who it is from and what is inside', async () => {
    open(view({ owner: false, link: { gift: true }, events: arrived, parcel: { expectedDelivery: undefined } }), { hash: words });
    expect(await screen.findByRole('heading', { level: 1, name: 'It’s here' })).toBeVisible();
    const card = screen.getByRole('region', { name: 'It’s here' });
    expect(card).toHaveClass('peekp-card--gift', 'peekp-card--opened');
    expect(within(card).getByText(/^Delivered today at \d\d:\d\d$/)).toBeVisible();
    expect(within(card).queryByRole('img', { name: /Step/ })).toBeNull();
    expect(screen.getByText('Happy birthday, Alex!')).toBeVisible();
    expect(screen.getByText('— Sam')).toBeVisible();
    expect(screen.getByText('Inside:').parentElement).toHaveTextContent('Inside: trail running shoes');
    expect(document.title).toBe('It’s here · Peek');
    // The surprise is over: the journey is told in full.
    expect(screen.queryByText(/stay a surprise/)).toBeNull();
    expect(screen.getByText('Scan at accepted')).toBeVisible();
    expect(screen.getByText('Tracking number')).toBeVisible();
  });

  it('delivered without any words is simply here', async () => {
    open(view({ owner: false, link: { gift: true }, events: arrived }));
    expect(await screen.findByRole('heading', { level: 1, name: 'It’s here' })).toBeVisible();
    expect(document.querySelector('.peekp-giftnote')).toBeNull();
  });

  it('shows its sender the usual page with a small marker, before and after delivery', async () => {
    const sent = open(view({ link: { gift: true } }), { hash: words });
    expect(await screen.findByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    expect(screen.getByText('Gift')).toBeVisible();
    expect(document.querySelector('.peekp-card--gift')).toBeNull();
    expect(screen.getByText('Tracking number').parentElement).toHaveTextContent('1234567899');
    expect(screen.queryByText(/stay a surprise/)).toBeNull();
    sent.unmount();
    open(view({ link: { gift: true }, events: arrived }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Delivered' })).toBeVisible();
    expect(screen.getByText('Gift')).toBeVisible();
  });
});

describe('a link that is not shared anymore', () => {
  it('says so, apart from a forgotten link, with the way to follow the parcel again', async () => {
    rememberParcel({ id: LINK_ID, view: view({ owner: false }) });
    history.replaceState(null, '', `/p/${LINK_ID}`);
    mocks.read.mockRejectedValue(new ParcelLinkError('stopped'));
    const openDeliveries = vi.fn();
    const user = userEvent.setup();
    render(<PeekSessionProvider value={{ ...signedIn, openDeliveries }}><ParcelPage linkId={LINK_ID} /></PeekSessionProvider>);
    expect(await screen.findByRole('heading', { level: 1, name: 'This parcel isn’t shared anymore' })).toBeVisible();
    expect(screen.getByText('The person who shared it stopped sharing. If it’s yours, paste its tracking number to follow it again.')).toBeVisible();
    expect(document.title).toBe('This parcel isn’t shared anymore · Peek');
    expect(screen.queryByText(/forgotten|never existed/)).toBeNull();
    // Nothing of the parcel is left on the page or the device.
    expect(screen.queryByText('In transit')).toBeNull();
    expect(recentFor(LINK_ID)).toBeNull();
    expect(mocks.read).toHaveBeenCalledWith(LINK_ID, expect.objectContaining({ tellStopped: true }));
    await user.click(screen.getByRole('button', { name: 'Where’s my parcel?' }));
    expect(openDeliveries).toHaveBeenCalledTimes(1);
  });

  it('keeps showing its owner the parcel, with a word that sharing is stopped', async () => {
    open(view({ link: { shared: false } }));
    expect(await screen.findByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    expect(screen.getByText('Sharing is stopped. The link shows nothing to anyone else.')).toBeVisible();
  });
});
