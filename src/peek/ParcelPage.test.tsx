import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_ID, OWNER_KEY, pendingView, testParcel, testView } from '../test/parcelLinks';
import type { ParcelWithEvents, Stage, TrackingEvent } from '../types';
import { ParcelLinkError, type ParcelLinkView } from './links';
import { ParcelPage } from './ParcelPage';
import { NoticeToast } from './parcel/Toast';
import { clearPendingKeep, onKeepOutcome, pendingKeep, rememberPendingKeep, announceKeepOutcome, type KeepOutcome } from './pending';
import { forgetAllRecents, recentFor, rememberParcel } from './recents';
import { PeekSessionProvider, type PeekSession } from './session';

const mocks = vi.hoisted(() => ({ read: vi.fn(), forget: vi.fn() }));
vi.mock('./links', async (original) => ({
  ...await original<typeof import('./links')>(),
  readParcelLink: mocks.read,
  forgetParcelLink: mocks.forget,
}));

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
const scan = (stage: Stage, hoursAgo: number, description = `Scan at ${stage}`, extra: Partial<TrackingEvent> = {}): TrackingEvent =>
  ({ id: `${stage}-${hoursAgo}`, parcelId: 'parcel-1', stage, description, occurredAt: ago(hoursAgo), ...extra });
/** A view of a parcel with its own scans, checked two minutes ago. */
function view(events: TrackingEvent[], parcel: Partial<ParcelWithEvents> = {}, owner = true): ParcelLinkView {
  const shown = testView({ owner, parcel: { lastSyncedAt: ago(2 / 60), createdAt: ago(100), ...parcel } });
  return { ...shown, parcel: { ...shown.parcel, events } };
}
const journey = [scan('registered', 50), scan('accepted', 30), scan('in_transit', 6)];

function open(session?: PeekSession, props: Partial<Parameters<typeof ParcelPage>[0]> = {}) {
  const page = <><ParcelPage linkId={LINK_ID} {...props} /><NoticeToast /></>;
  return render(session ? <PeekSessionProvider value={session}>{page}</PeekSessionProvider> : page);
}
const card = () => screen.getByRole('region', { name: screen.getByRole('heading', { level: 1 }).textContent! });
const clipboard = (writeText: (text: string) => Promise<void>) => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

beforeEach(() => {
  mocks.read.mockReset();
  mocks.forget.mockReset().mockResolvedValue(undefined);
  history.replaceState(null, '', `/p/${LINK_ID}`);
  document.title = 'Peek — Universal Parcel Tracker';
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  forgetAllRecents();
  clearPendingKeep();
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'clipboard');
  history.replaceState(null, '', '/');
});

describe('ParcelPage', () => {
  it('loads a link opened directly: the status is the headline, with the carrier, the estimate, the number and the journey', async () => {
    mocks.read.mockResolvedValue(testView({ parcel: { expectedDelivery: '2099-01-05', lastSyncedAt: ago(2 / 60) } }));
    open();
    expect(screen.getByRole('status')).toHaveTextContent('Checking for updates');
    expect(document.title).toBe('Checking for updates · Peek');
    expect(await screen.findByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    const page = document.querySelector('main')!;
    expect(page).toHaveAttribute('data-entrance', 'direct');
    expect(page).toHaveAttribute('data-live', 'true');
    expect(within(card()).getByLabelText('DHL')).toBeVisible();
    expect(within(card()).getByText(/^Expected: /)).toBeVisible();
    expect(within(card()).getByRole('img', { name: 'Step 4 of 6: In transit' })).toBeVisible();
    expect(within(card()).getByRole('button', { name: 'Updated: 2 min ago. Check now' })).toBeEnabled();
    expect(screen.getByText('Tracking number').parentElement).toHaveTextContent('1234567899');
    expect(screen.getByRole('link', { name: 'Open the DHL website' })).toHaveAttribute('href', expect.stringContaining('1234567899'));
    expect(screen.getByText('Scan 2')).toBeVisible();
    // Pip wears the carrier's label, is hidden from assistive tech, and keeps the name the browser moves it by.
    expect(document.querySelector('.peekp-pip .parcel-illustration__label-name')).toHaveTextContent('DHL');
    expect(document.querySelector('.peekp-pip .parcel-illustration__label-number')).toHaveTextContent('1234567899');
    expect(document.querySelector('.peekp-pip svg')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector<HTMLElement>('.peekp-pip')!.style.viewTransitionName).toBe('peek-pip');
    expect(recentFor(LINK_ID)).toMatchObject({ carrier: 'dhl', stage: 'in_transit' });
    expect(document.title).toMatch(/^In transit · .+/);
    // The owner is told when Peek forgets the parcel, and may keep it.
    expect(screen.getByText('Peek forgets this parcel 30 days after delivery.')).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Keep it with your other parcels' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy.html');
    expect(screen.getByRole('link', { name: 'Open source' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('opens revealed from the door with the lookup’s answer, settles when the first check lands, then offers the parcel’s own link', async () => {
    vi.useFakeTimers();
    const copied = vi.fn(async () => undefined);
    clipboard(copied);
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: pendingView() });
    mocks.read.mockResolvedValue(testView());
    open(undefined, { entrance: 'reveal', initial: pendingView() });
    expect(document.querySelector('main')).toHaveAttribute('data-entrance', 'reveal');
    expect(screen.getByRole('heading', { level: 1, name: 'Checking for updates' })).toBeVisible();
    expect(screen.getByText('Checking for updates…')).toBeVisible();
    expect(within(card()).getByRole('button', { name: 'Live. Check now' })).toBeVisible();
    expect(document.title).toBe('Finding the carrier… · Peek');
    expect(card()).not.toHaveAttribute('data-settled');
    expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_400); });
    const toast = screen.getByText('This parcel has its own link').closest('[role=status]') as HTMLElement;
    expect(toast).toHaveTextContent(`localhost/p/${LINK_ID}`);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    // The first check landed: the step fills, the sparks twinkle, and it is not called news.
    expect(screen.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    expect(card()).toHaveAttribute('data-settled', 'true');
    expect(card().querySelectorAll('.peekp-pip__sparks svg')).toHaveLength(4);
    expect(screen.queryByText('New update')).toBeNull();
    await act(async () => { within(toast).getByRole('button', { name: 'Copy' }).click(); });
    expect(copied).toHaveBeenCalledWith(`http://localhost/p/${LINK_ID}`);
    expect(screen.getByText('Link copied')).toBeVisible();
    expect(screen.queryByText('This parcel has its own link')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(screen.queryByText('Link copied')).toBeNull();
  });

  it('shows a viewer the masked number, the name the link carries and the carrier’s page without the number, and nothing an owner does', async () => {
    history.replaceState(null, '', `/p/${LINK_ID}#n=${encodeURIComponent('For Mum')}`);
    mocks.read.mockResolvedValue(testView({ owner: false }));
    open();
    expect(await screen.findByText('For Mum')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    expect(screen.getByText('Tracking number').parentElement).toHaveTextContent('123 ••• 99');
    expect(document.querySelector('.parcel-illustration__label-number')).toHaveTextContent('123 ••• 99');
    expect(document.body).not.toHaveTextContent('1234567899');
    expect(screen.queryByRole('button', { name: 'Copy tracking number' })).toBeNull();
    const site = screen.getByRole('link', { name: 'Open the DHL website' });
    expect(site.getAttribute('href')).not.toMatch(/[?#]|99/);
    expect(screen.queryByRole('button', { name: 'Forget it now' })).toBeNull();
    expect(screen.queryByText('Keep it with your other parcels')).toBeNull();
    expect(document.title).toMatch(/^For Mum · In transit/);
    // A name is the device's own: a viewer can give one too.
    expect(screen.getByRole('button', { name: 'Edit parcel name' })).toBeVisible();
    expect(mocks.read).toHaveBeenCalledWith(LINK_ID, expect.objectContaining({ key: undefined }));
  });

  it('says a forgotten link is gone the same way as one that never existed, and leads back to the front door', async () => {
    mocks.read.mockResolvedValue('unavailable');
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'This parcel has been forgotten' })).toBeVisible();
    expect(screen.getByText(/Peek forgets parcels 30 days after delivery/)).toBeVisible();
    expect(screen.getByText('A link that never existed shows the same page, so links can’t be guessed.')).toBeVisible();
    await waitFor(() => expect(document.title).toBe('This parcel has been forgotten · Peek'));
    expect(screen.queryByRole('button', { name: 'Share this parcel' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Where’s my parcel?' }));
    expect(location.pathname).toBe('/');
  });

  it('shows the device’s last answer while offline, and says from when', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: view(journey) });
    mocks.read.mockRejectedValue(new ParcelLinkError('offline'));
    open();
    const banner = await screen.findByText(/^You’re offline\. Showing the update from \d\d:\d\d\.$/);
    expect(banner).toHaveAttribute('role', 'status');
    expect(screen.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    const marker = within(card()).getByRole('button', { name: 'Offline. Check now' });
    expect(marker).toHaveAttribute('data-kind', 'offline');
    expect(marker).not.toHaveAttribute('data-pulse');
    // Being offline is not the carrier's trouble.
    expect(screen.queryByText('Couldn’t get the latest update')).toBeNull();
  });

  it('keeps the last answer on screen when a read fails, flags it and says why', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: view(journey) });
    mocks.read.mockRejectedValue(new ParcelLinkError('server'));
    open();
    expect(await within(card()).findByText('Couldn’t get the latest update')).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    expect(within(card()).getByRole('button', { name: /^As of \d\d:\d\d\. Check now$/ })).toBeVisible();
  });

  it('explains why nothing can be shown when the first read fails, and tries again on request', async () => {
    mocks.read.mockRejectedValueOnce(new ParcelLinkError('server')).mockResolvedValue(testView());
    const user = userEvent.setup();
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    expect(mocks.read).toHaveBeenLastCalledWith(LINK_ID, expect.objectContaining({ advance: true }));
  });

  it('checks again from the marker, announces what it found, and tells the new scan', async () => {
    const delivered = view([...journey, scan('delivered', 0, 'Left in the mailbox')]);
    mocks.read.mockResolvedValueOnce(view(journey)).mockResolvedValueOnce(delivered).mockResolvedValue(delivered);
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Updated: 2 min ago. Check now' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Delivered' })).toBeVisible();
    expect(mocks.read).toHaveBeenLastCalledWith(LINK_ID, expect.objectContaining({ advance: true }));
    expect(screen.getByText('Tracking updated')).toHaveAttribute('role', 'status');
    const news = screen.getByText('New update').closest('[role=status]')!;
    expect(news).toHaveTextContent('New update · Left in the mailbox');
    expect(document.querySelector('main')).toHaveAttribute('data-news', 'true');
    expect(document.title).toMatch(/^Delivered at \d\d:\d\d · Peek$/);
    // The journey is over: nothing is left to check, and the box opens.
    expect(screen.queryByRole('button', { name: /Check now/ })).toBeNull();
    expect(within(card()).getByText(/^Today, \d\d:\d\d$/)).toBeVisible();
    await waitFor(() => expect(document.querySelector('.peekp-pip')).toHaveClass('peekp-pip--hero', 'peekp-pip--open'));
    expect(document.querySelector('.parcel-illustration__label')).toBeNull();
    expect(screen.getByText('Peek forgets this parcel on 30 dec.')).toBeVisible();
  });

  it('says “No new updates” when a check finds nothing', async () => {
    mocks.read.mockResolvedValue(view(journey));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: /Check now/ }));
    expect(await screen.findByText('No new updates')).toHaveAttribute('role', 'status');
    expect(screen.queryByText('New update')).toBeNull();
  });

  it('returns home from the name and from “Track another parcel”', async () => {
    mocks.read.mockResolvedValue(testView());
    const user = userEvent.setup();
    const { unmount } = open();
    await screen.findByRole('heading', { level: 1 });
    await act(async () => { await user.click(screen.getByRole('button', { name: 'Peek' })); });
    expect(location.pathname).toBe('/');
    unmount();
    expect(document.title).toBe('Peek — Universal Parcel Tracker');
    history.replaceState(null, '', `/p/${LINK_ID}`);
    open();
    await act(async () => { await user.click(await screen.findByRole('button', { name: 'Track another parcel' })); });
    expect(location.pathname).toBe('/');
  });
});

describe('ParcelPage stages and troubles', () => {
  async function shown(parcelView: ParcelLinkView) {
    mocks.read.mockResolvedValue(parcelView);
    open();
    await screen.findByRole('heading', { level: 1 });
  }

  it('says a label was made but nothing was scanned yet', async () => {
    await shown(view([scan('registered', 20)]));
    expect(screen.getByRole('heading', { level: 1, name: 'Announced' })).toBeVisible();
    expect(within(card()).getByText('No delivery date yet')).toBeVisible();
    expect(within(card()).getByText('DHL hasn’t scanned the parcel yet. That usually happens within a day or two.')).toBeVisible();
    expect(within(card()).getByRole('button', { name: 'Last checked: 2 min ago. Check now' })).toHaveAttribute('data-pulse', 'true');
  });

  it('keeps a number no carrier knows on a neutral card, and says to keep the page', async () => {
    await shown(view([scan('pending', 60, 'Tracking added; the carrier has not announced it yet')], { carrier: 'unknown', syncStatus: 'waiting' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Waiting for the carrier' })).toBeVisible();
    expect(card()).toHaveClass('peekp-card--neutral');
    expect(within(card()).getByText('Carrier not found yet')).toBeVisible();
    expect(within(card()).getByText('No carrier knows 1234567899 yet. That’s normal for a day or two after ordering.')).toBeVisible();
    expect(screen.getByText(/^Keep this page: Peek keeps asking the carriers/)).toBeVisible();
    expect(document.querySelector('.parcel-illustration__label')).toBeNull();
    // The headline says it already: no flag, and no journal of one line.
    expect(card().querySelector('.peekp-card__flag')).toBeNull();
    expect(screen.queryByText('Tracking history')).toBeNull();
  });

  it('flags a parcel at customs', async () => {
    await shown(view([...journey, scan('customs', 2)], { expectedDelivery: '2099-01-05' }));
    expect(screen.getByRole('heading', { level: 1, name: 'At customs' })).toBeVisible();
    expect(within(card()).getByText('Customs clearance')).toBeVisible();
    expect(within(card()).getByText(/^Expected: /)).toBeVisible();
  });

  it.each(['exception', 'failed_attempt'] as const)('quotes what the carrier said for %s', async (stage) => {
    await shown(view([...journey, scan(stage, 2, 'Address incomplete. Kept at the depot.')]));
    const note = screen.getByRole('note');
    expect(within(note).getByText('What DHL says')).toBeVisible();
    expect(note.querySelector('blockquote')).toHaveTextContent('Address incomplete. Kept at the depot.');
    expect(within(card()).getByText(stage === 'exception' ? 'The carrier reported a problem' : 'Check the carrier’s next steps')).toBeVisible();
    // The estimate no longer helps.
    expect(card().querySelector('.peekp-card__detail')).toBeNull();
  });

  it('shows where a parcel waits for pickup, with a way to get there', async () => {
    await shown(view([...journey, scan('ready_for_pickup', 2)], { pickupPoint: 'Example Kiosk\nExample Street 1, 9999 Sampleville' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Ready for pickup' })).toBeVisible();
    const pickup = screen.getByRole('region', { name: 'Pickup location' });
    expect(within(pickup).getByText('Example Kiosk')).toBeVisible();
    expect(within(pickup).getByRole('link', { name: 'Directions' })).toBeVisible();
    expect(card().querySelector('.peekp-card__flag')).toBeNull();
  });

  it('says a returned parcel is on its way back, and what to do about it', async () => {
    await shown(view([...journey, scan('returned', 0)]));
    expect(screen.getByRole('heading', { level: 1, name: 'Returned to sender' })).toBeVisible();
    expect(within(card()).getByText('On its way back since today')).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent('DHL is taking it back to the sender. Contact the sender about a refund or a new delivery.');
    expect(screen.queryByRole('button', { name: /Check now/ })).toBeNull();
  });

  it('explains a parcel that went quiet', async () => {
    await shown(view([scan('accepted', 140), scan('in_transit', 120)]));
    expect(within(card()).getByText('No tracking update for four days')).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent(/^Parcels often go quiet on long flights.+Peek keeps asking DHL and shows the next scan here\.$/);
    expect(within(card()).getByRole('button', { name: 'Last checked: 2 min ago. Check now' })).toBeVisible();
  });

  it('says what the carrier’s check failed with, keeping the last thing known', async () => {
    await shown(view(journey, { syncStatus: 'error', syncError: 'carrier:not_found', expectedDelivery: '2099-01-05' }));
    expect(screen.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    expect(within(card()).getByText('Couldn’t get the latest update')).toBeVisible();
    expect(screen.getByRole('note').textContent).not.toMatch(/carrier:not_found/);
    expect(screen.getByRole('note').textContent!.length).toBeGreaterThan(20);
    expect(within(card()).getByRole('button', { name: /^As of \d\d:\d\d\. Check now$/ })).not.toHaveAttribute('data-pulse');
  });

  it('says so when the carrier cannot be followed automatically', async () => {
    await shown(view([scan('pending', 1, 'Tracking added')], { carrier: 'amazon-logistics', trackingNumber: 'TBA000000000009', syncStatus: 'unsupported' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Check tracking website' })).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent('Amazon Logistics deliveries are usually tracked in Your Orders on Amazon.');
  });

  it('names both carriers of a journey handed from one to another', async () => {
    await shown(view(journey, {
      carrier: 'swiss-post', trackingNumber: 'TESTDELIVERYLEG01', originalCarrier: 'aliexpress', originalTrackingNumber: 'TESTORIGINLEG0001',
      trackingSource: 'swiss-post', activeTrackingNumber: 'TESTDELIVERYLEG01',
    }));
    expect(within(card()).getByText('Delivery with Swiss Post')).toBeVisible();
    const sources = within(card()).getByRole('group', { name: 'Tracking sources' });
    expect(within(sources).getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual([
      'Open the Swiss Post website — Delivery tracking', 'Open the AliExpress / Cainiao website — Earlier journey',
    ]);
    expect(screen.getByRole('button', { name: 'Copy tracking number — Swiss Post' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy tracking number — AliExpress / Cainiao' })).toBeVisible();
  });

  it('tells the estimate the carrier gave before it changed it', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: view(journey, { expectedDelivery: '2099-01-05' }) });
    await shown(view(journey, { expectedDelivery: '2099-01-06' }));
    expect(await within(card()).findByText(/^Was: .*5 jan/)).toBeVisible();
  });

  it('shows what the carrier told about the shipment', async () => {
    await shown(view(journey, { senderName: 'Example Shop', weightKg: 1.2, dimensionsText: '30 × 20 × 10 cm', pickupPoint: 'Example Kiosk' }));
    expect(screen.getByText('From Example Shop')).toBeVisible();
    expect(screen.getByText('Weight').nextElementSibling).toHaveTextContent('1.2 kg');
    expect(screen.getByText('Dimensions').nextElementSibling).toHaveTextContent('30 × 20 × 10 cm');
    expect(screen.getByText('Pickup location').nextElementSibling).toHaveTextContent('Example Kiosk');
  });

  it('draws the route across the card once a scan has a place, behind a button that opens the map', async () => {
    const place = { latitude: 47.4, longitude: 8.5, precision: 'city' as const, country: 'CH', name: 'Sampleville' };
    await shown(view([...journey, scan('out_for_delivery', 1, 'With the courier', { place })]));
    expect(card()).toHaveClass('peekp-card--map');
    expect(card().querySelector('.peekp-map__drawing')).toHaveAttribute('aria-hidden', 'true');
    expect(within(card()).getByRole('button', { name: 'Open the map' })).toBeInTheDocument();
    // On the map Pip is the ink one: the kraft parcel stays out.
    expect(document.querySelector('.peekp-pip')).toBeNull();
  });

  it('puts the map beside the card on a wide screen, and keeps Pip in the card when the parcel has arrived', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('min-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const germany = { latitude: 53.5, longitude: 10, precision: 'city' as const, country: 'DE', name: 'Exampletown' };
    const switzerland = { latitude: 47.4, longitude: 8.5, precision: 'city' as const, country: 'CH', name: 'Sampleville' };
    await shown(view([scan('accepted', 30, 'Accepted', { place: germany }), scan('delivered', 1, 'Delivered', { place: switzerland })]));
    expect(document.querySelector('.peekp-columns')).toHaveAttribute('data-beside', 'true');
    expect(card()).toHaveClass('peekp-card--hero');
    expect(document.querySelector('.peekp-map--tile')).toBeInTheDocument();
    expect(card().querySelector('.peekp-map')).toBeNull();
    // A parcel that crossed a border invites to the passport.
    const teaser = screen.getByRole('region', { name: 'Across borders' });
    expect(teaser).toHaveTextContent('First scan: Germany. Sign in to collect stamps like this one.');
    expect(teaser.querySelector('.parcel-stamp')).toHaveAttribute('aria-hidden', 'true');
  });

  it('winds down a day after the journey ended: the forget date takes the stage', async () => {
    const signIn = vi.fn();
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
    mocks.read.mockResolvedValue(view([scan('accepted', 600), scan('delivered', 500)]));
    const user = userEvent.setup();
    open({ account: 'visitor', signIn });
    expect(await screen.findByRole('heading', { level: 2, name: 'Peek forgets this parcel on 30 dec' })).toBeVisible();
    const panel = screen.getByRole('region', { name: 'Peek forgets this parcel on 30 dec' });
    expect(within(panel).getByText('The link stops working and the number is deleted. Nothing to sign out of.')).toBeVisible();
    expect(within(panel).getByRole('button', { name: 'Forget it now' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Forget it now' })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Waiting for something else?' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Name it' })).toBeNull();
    await waitFor(() => expect(document.querySelector('.peekp-pip')).toHaveClass('peekp-pip--open'));
    expect(document.querySelector('.peekp-pip')).not.toHaveClass('peekp-pip--hero');
    await user.click(within(panel).getByRole('button', { name: 'Sign in to keep it' }));
    expect(signIn).toHaveBeenCalledWith(LINK_ID);
    await act(async () => { await user.click(screen.getAllByRole('button', { name: 'Track another parcel' })[1]); });
    expect(location.pathname).toBe('/');
  });
});

describe('ParcelPage actions', () => {
  it('names the parcel on this device, shows the name with the status, and takes it back', async () => {
    mocks.read.mockResolvedValue(testView());
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Name it' }));
    const field = screen.getByRole('textbox', { name: 'Parcel name' });
    expect(field).toHaveFocus();
    await user.type(field, '  New sneakers ');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(within(card()).getByText('New sneakers')).toBeVisible();
    // The keyboard is back on the button the form replaced.
    expect(screen.getByRole('button', { name: 'Edit parcel name' })).toHaveFocus();
    expect(screen.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    expect(recentFor(LINK_ID)).toMatchObject({ name: 'New sneakers' });
    expect(document.title).toMatch(/^New sneakers · In transit/);
    // Escape and Cancel leave the name alone; an empty name removes it.
    await user.click(screen.getByRole('button', { name: 'Edit parcel name' }));
    expect(screen.getByRole('textbox', { name: 'Parcel name' })).toHaveValue('New sneakers');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Edit parcel name' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(recentFor(LINK_ID)!.name).toBe('New sneakers');
    await user.click(screen.getByRole('button', { name: 'Edit parcel name' }));
    await user.clear(screen.getByRole('textbox', { name: 'Parcel name' }));
    await user.keyboard('{Enter}');
    expect(recentFor(LINK_ID)!.name).toBeNull();
    expect(screen.getByRole('button', { name: 'Name it' })).toBeVisible();
    // The name never left the device.
    expect(mocks.read.mock.calls.every(([, options]) => !JSON.stringify(options).includes('sneakers'))).toBe(true);
  });

  it('shares the link, and only the link, through the system’s share sheet', async () => {
    history.replaceState(null, '', `/p/${LINK_ID}#n=${encodeURIComponent('For Mum')}`);
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    mocks.read.mockResolvedValue(testView());
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Share' }));
    expect(share).toHaveBeenCalledWith({ url: `http://localhost/p/${LINK_ID}` });
    expect(screen.queryByText('Link copied')).toBeNull();
    // Closing the sheet without a choice says nothing.
    share.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
    await user.click(screen.getByRole('button', { name: 'Share this parcel' }));
    expect(share).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/copy the link/)).toBeNull();
  });

  it('copies the link where there is no share sheet, and says so; says when it cannot', async () => {
    const copied = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    const user = userEvent.setup();
    clipboard(copied);
    mocks.read.mockResolvedValue(testView());
    open();
    await user.click(await screen.findByRole('button', { name: 'Share' }));
    expect(copied).toHaveBeenCalledWith(`http://localhost/p/${LINK_ID}`);
    expect(await screen.findByText('Link copied')).toBeVisible();
    copied.mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Couldn’t copy the link. Copy it from the address bar instead.')).toBeVisible();
    expect(screen.queryByText('Link copied')).toBeNull();
  });

  it('copies the tracking number, and says when it cannot', async () => {
    const copied = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    const user = userEvent.setup();
    clipboard(copied);
    mocks.read.mockResolvedValue(testView());
    open();
    await user.click(await screen.findByRole('button', { name: 'Copy tracking number' }));
    expect(copied).toHaveBeenCalledWith('1234567899');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    copied.mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy tracking number' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Copying is unavailable. Press and hold the tracking number instead.');
  });

  it('forgets the parcel after asking once: on the server, on this device, then back to the front door with a quiet word', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
    mocks.read.mockResolvedValue(testView());
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Forget it now' }));
    const dialog = screen.getByRole('dialog', { name: 'Forget this parcel?' });
    expect(dialog).toHaveAccessibleDescription('The link stops working and the number is deleted. Nothing to sign out of.');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    // Cancelling forgets nothing.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.forget).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Forget it now' }));
    await act(async () => { await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Forget it now' })); });
    expect(mocks.forget).toHaveBeenCalledExactlyOnceWith(LINK_ID, OWNER_KEY);
    expect(recentFor(LINK_ID)).toBeNull();
    expect(location.pathname).toBe('/');
    expect(screen.getByText('Parcel forgotten')).toHaveAttribute('class', 'peekp-toast__text');
  });

  it('keeps the parcel and says why when forgetting fails, and treats a link already gone as forgotten', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
    mocks.read.mockResolvedValue(testView());
    mocks.forget.mockRejectedValueOnce(new ParcelLinkError('offline')).mockRejectedValueOnce(new ParcelLinkError('server'))
      .mockRejectedValueOnce(new ParcelLinkError('unavailable'));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Forget it now' }));
    const confirm = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Forget it now' });
    await user.click(confirm());
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your internet connection and try again.');
    expect(recentFor(LINK_ID)).not.toBeNull();
    await user.click(confirm());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t forget this parcel. Try again.'));
    expect(location.pathname).toBe(`/p/${LINK_ID}`);
    await act(async () => { await user.click(confirm()); });
    expect(recentFor(LINK_ID)).toBeNull();
    expect(location.pathname).toBe('/');
  });
});

describe('ParcelPage keeping', () => {
  const methods = () => ({
    configured: true, googleEnabled: true, appleEnabled: true, emailOtpEnabled: true,
    signInWithGoogle: vi.fn(async () => undefined), signInWithApple: vi.fn(async () => undefined),
    sendCode: vi.fn(async () => undefined), verifyCode: vi.fn(async () => undefined),
  });

  it('leads a visitor to the sign-in step where signing in is its own step, noting the parcel', async () => {
    const signIn = vi.fn();
    mocks.read.mockResolvedValue(testView());
    const user = userEvent.setup();
    open({ account: 'visitor', signIn });
    await user.click(await screen.findByRole('button', { name: 'Sign in to keep it' }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith(LINK_ID);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers the ways to sign in on the page itself, and notes the parcel only when one is taken', async () => {
    const signInWith = methods();
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: view(journey, { expectedDelivery: '2099-01-05' }), name: 'New sneakers' });
    mocks.read.mockResolvedValue(view(journey, { expectedDelivery: '2099-01-05' }));
    const user = userEvent.setup();
    open({ account: 'visitor', signIn: vi.fn(), signInWith });
    await user.click(await screen.findByRole('button', { name: 'Sign in to keep it' }));
    const sheet = screen.getByRole('dialog', { name: 'Sign in to keep it' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(within(sheet).getByText('New sneakers')).toBeVisible();
    expect(within(sheet).getByText(/^In transit · Expected: /)).toBeVisible();
    expect(within(sheet).getAllByText(/^It joins your deliveries with its name and history/).length).toBeGreaterThan(0);
    expect(pendingKeep()).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Continue with Google' }));
    expect(signInWith.signInWithGoogle).toHaveBeenCalledOnce();
    expect(pendingKeep()).toBe(LINK_ID);
    // Closing the sheet takes the wish back.
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pendingKeep()).toBeNull();
    // An emailed code notes the parcel when the code is confirmed.
    await user.click(screen.getByRole('button', { name: 'Sign in to keep it' }));
    await user.click(screen.getByRole('button', { name: 'Sign in with email' }));
    await user.type(screen.getByLabelText('Email address'), 'owner@example.test');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(signInWith.sendCode).toHaveBeenCalledWith('owner@example.test');
    expect(pendingKeep()).toBeNull();
    await user.type(await screen.findByLabelText('Sign-in code'), '123456');
    await user.click(screen.getByRole('button', { name: 'View my parcels' }));
    expect(signInWith.verifyCode).toHaveBeenCalledWith('owner@example.test', '123456');
    expect(pendingKeep()).toBe(LINK_ID);
  });

  it('offers nothing to keep while the account is still being checked', async () => {
    mocks.read.mockResolvedValue(testView());
    open({ account: 'checking', signIn: vi.fn() });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText('Keep it with your other parcels')).toBeNull();
  });

  function signedIn(keep: PeekSession['keep'], extra: Partial<PeekSession> = {}) {
    const openDeliveries = vi.fn();
    const session: PeekSession = { account: 'signed-in', signIn: vi.fn(), keep, deliveries: [], openDeliveries, ...extra };
    return { session, openDeliveries };
  }
  const heard = () => {
    const outcomes: KeepOutcome[] = [];
    const stop = onKeepOutcome((outcome) => outcomes.push(outcome));
    stop();
    return outcomes;
  };

  it('adds the parcel to the account of someone signed in with one tap, and lets the deliveries say so', async () => {
    const kept: KeepOutcome = { id: LINK_ID, outcome: 'kept', packageId: 'package-1', name: null };
    const keep = vi.fn(async () => kept);
    const { session, openDeliveries } = signedIn(keep);
    mocks.read.mockResolvedValue(testView());
    const user = userEvent.setup();
    open(session);
    const add = await screen.findByRole('button', { name: 'Add to my deliveries' });
    expect(screen.getByText('It gets alerts like your other parcels. The person who shared it sees nothing of yours.')).toBeVisible();
    expect(screen.queryByText('Keep it with your other parcels')).toBeNull();
    expect(screen.queryByText('Shared with you')).toBeNull();
    await act(async () => { await user.click(add); });
    expect(keep).toHaveBeenCalledExactlyOnceWith(LINK_ID);
    expect(openDeliveries).toHaveBeenCalledExactlyOnceWith(undefined);
    // The outcome waits for the deliveries to hear it.
    expect(heard()).toEqual([kept]);
  });

  it('opens the parcel the account already had', async () => {
    const already: KeepOutcome = { id: LINK_ID, outcome: 'already', packageId: 'package-7', name: null };
    const { session, openDeliveries } = signedIn(vi.fn(async () => already));
    mocks.read.mockResolvedValue(testView());
    const user = userEvent.setup();
    open(session);
    await act(async () => { await user.click(await screen.findByRole('button', { name: 'Add to my deliveries' })); });
    expect(openDeliveries).toHaveBeenCalledExactlyOnceWith('package-7');
    expect(heard()).toEqual([already]);
  });

  it.each([
    ['quota', 'Your deliveries are full. Archive or delete a few parcels, then add this one.'],
    ['unavailable', 'This parcel has been forgotten'],
    ['failed', 'Couldn’t add this parcel. Check the details and try again.'],
  ] as const)('stays on the page and says why when keeping ends with %s', async (outcome, message) => {
    const { session, openDeliveries } = signedIn(vi.fn(async () => ({ id: LINK_ID, outcome, name: null })));
    mocks.read.mockResolvedValue(testView());
    const user = userEvent.setup();
    open(session);
    await user.click(await screen.findByRole('button', { name: 'Add to my deliveries' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(openDeliveries).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add to my deliveries' })).toBeEnabled();
    expect(heard()).toEqual([]);
  });

  it('says the parcel could not be added when the request itself fails', async () => {
    const { session } = signedIn(vi.fn(async () => { throw new ParcelLinkError('offline'); }));
    mocks.read.mockResolvedValue(testView());
    const user = userEvent.setup();
    open(session);
    await user.click(await screen.findByRole('button', { name: 'Add to my deliveries' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t add this parcel.');
  });

  it('waits for a parcel that is being kept after signing in, then follows it to the deliveries', async () => {
    rememberPendingKeep(LINK_ID);
    const keep = vi.fn();
    const { session, openDeliveries } = signedIn(keep);
    mocks.read.mockResolvedValue(testView());
    open(session);
    const add = await screen.findByRole('button', { name: 'Add to my deliveries' });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('aria-busy', 'true');
    const kept: KeepOutcome = { id: LINK_ID, outcome: 'kept', packageId: 'package-1', name: 'New sneakers' };
    await act(async () => { clearPendingKeep(LINK_ID); announceKeepOutcome(kept); await Promise.resolve(); });
    expect(openDeliveries).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(keep).not.toHaveBeenCalled();
    expect(heard()).toEqual([kept]);
  });

  it('tells someone signed in that they already follow the parcel, and opens it', async () => {
    const own = testParcel({ id: 'package-9', label: 'New sneakers' });
    const { session, openDeliveries } = signedIn(vi.fn(), { deliveries: [own] });
    mocks.read.mockResolvedValue(testView());
    const user = userEvent.setup();
    open(session);
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('You already follow this parcel');
    expect(note).toHaveTextContent('It’s in your deliveries as “New sneakers”.');
    expect(screen.queryByRole('button', { name: 'Add to my deliveries' })).toBeNull();
    await user.click(within(note).getByRole('button', { name: 'Open it' }));
    expect(openDeliveries).toHaveBeenCalledExactlyOnceWith('package-9');
    // Home is the deliveries for someone signed in.
    await user.click(screen.getByRole('button', { name: 'Peek' }));
    expect(openDeliveries).toHaveBeenLastCalledWith();
  });

  it('marks a link someone else shared, and offers to add it only when the link lets it be kept', async () => {
    const shared = testView({ owner: false });
    const { session } = signedIn(vi.fn());
    mocks.read.mockResolvedValue({ ...shared, link: { ...shared.link, kind: 'shared', canKeep: true, forgetAt: null } });
    const { unmount } = open(session);
    expect(await screen.findByText('Shared with you')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add to my deliveries' })).toBeEnabled();
    // A link shared from an account is not Peek's to forget.
    expect(screen.queryByText(/Peek forgets this parcel/)).toBeNull();
    unmount();
    mocks.read.mockResolvedValue(shared);
    open(session);
    expect(await screen.findByText('Shared with you')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add to my deliveries' })).toBeNull();
  });

  it('invites a visitor who can add a shared parcel to sign in for it', async () => {
    const shared = testView({ owner: false });
    const signIn = vi.fn();
    mocks.read.mockResolvedValue({ ...shared, link: { ...shared.link, canKeep: true }, parcel: { ...shared.parcel, trackingNumber: '1234567899' }, numberHint: null });
    const user = userEvent.setup();
    open({ account: 'visitor', signIn });
    await user.click(await screen.findByRole('button', { name: 'Sign in to add it to your deliveries' }));
    expect(signIn).toHaveBeenCalledWith(LINK_ID);
    expect(screen.queryByRole('button', { name: 'Forget it now' })).toBeNull();
  });
});
