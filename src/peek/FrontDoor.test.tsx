import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_ID, OTHER_LINK_ID, OWNER_KEY, pendingView, testView } from '../test/parcelLinks';
import { FrontDoor } from './FrontDoor';
import { ParcelLinkError, type ParcelLookup } from './links';
import { forgetDeviceChecks } from './lookup/deviceList';
import { forgetAllRecents, recentFor, rememberParcel, renameParcel } from './recents';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), detect: vi.fn(), read: vi.fn(), forget: vi.fn() }));
vi.mock('./links', async (original) => ({
  ...await original<typeof import('./links')>(),
  lookupParcel: mocks.lookup,
  detectCarrierPublic: mocks.detect,
  readParcelLink: mocks.read,
  forgetParcelLink: mocks.forget,
}));

// Every number here is fictional.
const UPS = '1ZDEMO202600000001';
const SHARED = '01234567890123';
const lookup: ParcelLookup = { id: LINK_ID, key: OWNER_KEY, view: testView() };
const onTracked = vi.fn();
const onSignIn = vi.fn();
const notFound = 'We couldn’t find a tracking number. Paste the number or a tracking link.';

function door() {
  // The clipboard the Paste button reads exists from here on, as it does in a browser.
  const user = userEvent.setup();
  const view = render(<FrontDoor onTracked={onTracked} onSignIn={onSignIn} />);
  return {
    view,
    user,
    field: screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Tracking number or link' }),
    track: screen.getByRole('button', { name: 'Track' }),
  };
}
const type = (field: HTMLElement, text: string) => fireEvent.input(field, { target: { value: text } });
/** A reader who asked for less motion gets no recognise beat: the answer hands over at once. */
const stillMotion = (still: boolean) => vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
  matches: still && query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn(),
})));

beforeEach(() => {
  vi.clearAllMocks();
  stillMotion(true);
  mocks.lookup.mockResolvedValue(lookup);
  mocks.detect.mockImplementation(async (trackingNumber: string) => ({ trackingNumber, carrier: 'unknown' }));
  mocks.read.mockImplementation(async (id: string) => recentFor(id)?.snapshot ?? 'unavailable');
  mocks.forget.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  forgetAllRecents();
  forgetDeviceChecks();
  history.replaceState(null, '', '/');
});

describe('FrontDoor', () => {
  it('shows the name, the question, a closed Pip, the field with its Paste button and the way to sign in', async () => {
    const { user, track, field } = door();
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    expect(screen.getByText('Universal Parcel Tracker')).toBeVisible();
    expect(document.querySelectorAll('.door-pip .parcel-illustration__eye')).toHaveLength(2);
    expect(document.querySelector('.door-pip .parcel-illustration__label')).toBeNull();
    expect(document.querySelector<HTMLElement>('.door-pip')!.style.viewTransitionName).toBe('peek-pip');
    expect(field).toHaveAttribute('placeholder', 'Paste a number, link, or message');
    expect(screen.getByRole('button', { name: 'Paste' })).toBeEnabled();
    expect(track).toBeEnabled();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'On this device' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('waits for Track when a number is typed, then looks it up and hands the answer over', async () => {
    const { user, field, track } = door();
    await user.type(field, 'Your parcel 99.34.111111.22222222 is on its way');
    expect(screen.getByText('99.34.111111.22222222', { selector: 'strong' }).parentElement).toHaveTextContent('Found 99.34.111111.22222222 in the pasted text.');
    expect(screen.getByText('Swiss Post', { selector: 'strong' }).parentElement).toHaveTextContent('Swiss Post Detected carrier');
    expect(mocks.lookup).not.toHaveBeenCalled();
    await user.click(track);
    await waitFor(() => expect(onTracked).toHaveBeenCalledWith({ id: LINK_ID, key: OWNER_KEY, carrier: 'dhl', response: lookup.view }));
    expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: '993411111122222222', carrier: 'swiss-post' }, expect.any(AbortSignal));
    // The name never travels with a lookup, and a certain carrier is not asked about.
    expect(Object.keys(mocks.lookup.mock.calls[0][0])).not.toContain('label');
    expect(mocks.detect).not.toHaveBeenCalled();
  });

  it('tracks on Enter, and keeps Shift+Enter for a new line', async () => {
    const { user, field } = door();
    await user.type(field, `${UPS}{Shift>}{Enter}{/Shift}`);
    expect(mocks.lookup).not.toHaveBeenCalled();
    await user.type(field, '{Enter}');
    await waitFor(() => expect(onTracked).toHaveBeenCalledOnce());
    expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: UPS, carrier: 'ups' }, expect.any(AbortSignal));
  });

  it('goes straight on after a paste when the carrier is certain, with the label printed on Pip', async () => {
    let answer: (value: ParcelLookup) => void = () => undefined;
    mocks.lookup.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const { user, field, track } = door();
    await user.click(field);
    await user.paste(`Your order has shipped: ${UPS}`);
    expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: UPS, carrier: 'ups' }, expect.any(AbortSignal));
    // The recognise beat: the field shows the number alone, the label is on the box, the card is on its way.
    expect(document.querySelector('.door-field__number')).toHaveTextContent(UPS);
    expect(document.querySelector('.door-field__check')).toBeInTheDocument();
    expect(document.querySelector('.door-pip .parcel-illustration__label-name')).toHaveTextContent('ups');
    expect(document.querySelector('.door-wash')).toBeInTheDocument();
    expect(document.querySelector('.door-skeleton')).toBeInTheDocument();
    expect(screen.getByText('Opening your parcel…')).toHaveAttribute('role', 'status');
    expect(track).toBeDisabled();
    await act(async () => { answer(lookup); });
    await waitFor(() => expect(onTracked).toHaveBeenCalledOnce());
  });

  it('holds the recognise beat before handing over when motion is allowed', async () => {
    stillMotion(false);
    vi.useFakeTimers();
    const { field } = door();
    type(field, UPS);
    fireEvent.submit(field.closest('form')!);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(onTracked).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    expect(onTracked).toHaveBeenCalledOnce();
  });

  it('asks the carriers about a pasted number of a shared shape, and goes on when one has it', async () => {
    let answer: (value: unknown) => void = () => undefined;
    mocks.detect.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const { user, field } = door();
    await user.click(field);
    await user.paste(`Good news, your order has shipped!\nTracking number: ${SHARED}`);
    expect(mocks.detect).toHaveBeenCalledWith(SHARED, expect.any(AbortSignal));
    const line = document.querySelector('.door-line')!;
    expect(line).toHaveAttribute('aria-live', 'polite');
    expect(line).toHaveAttribute('aria-busy', 'true');
    expect(line).toHaveTextContent('Finding the carrier asking DPD, SEUR and BRT…');
    expect(screen.getByText(SHARED, { selector: 'strong' })).toBeVisible();
    expect(mocks.lookup).not.toHaveBeenCalled();
    await act(async () => { answer({ trackingNumber: SHARED, carrier: 'seur', asked: ['dpd', 'seur'] }); });
    expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: SHARED, carrier: 'seur' }, expect.any(AbortSignal));
    expect(document.querySelector('.door-line')).toHaveTextContent('SEUR has this parcel');
    await waitFor(() => expect(onTracked).toHaveBeenCalledOnce());
  });

  it('degrades quietly when the carriers cannot be asked: the number waits for Track and is looked up without a carrier', async () => {
    mocks.detect.mockRejectedValueOnce(new ParcelLinkError('burst', { retryAfterSeconds: 30 }));
    const { user, field, track } = door();
    await user.click(field);
    await user.paste(SHARED);
    await waitFor(() => expect(document.querySelector('.door-line')).toHaveTextContent('Carrier Peek looks it up when you track'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.lookup).not.toHaveBeenCalled();
    await user.click(track);
    await waitFor(() => expect(onTracked).toHaveBeenCalledOnce());
    expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: SHARED }, expect.any(AbortSignal));
    expect(mocks.detect).toHaveBeenCalledOnce();
  });

  it('stops waiting for carriers that take too long', async () => {
    vi.useFakeTimers();
    mocks.detect.mockReturnValueOnce(new Promise(() => undefined));
    const { field } = door();
    type(field, SHARED);
    fireEvent.submit(field.closest('form')!);
    expect(mocks.lookup).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: SHARED }, expect.any(AbortSignal));
    expect((mocks.detect.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
  });

  it('lets the visitor choose when several carriers know the number', async () => {
    mocks.detect.mockResolvedValueOnce({ trackingNumber: SHARED, carrier: 'unknown', recognized: ['dpd', 'seur'], asked: ['dpd', 'seur'] });
    const { user, field } = door();
    await user.type(field, `${SHARED}{Enter}`);
    const choices = await screen.findAllByRole('radio');
    expect(document.querySelector('.door-line')).toHaveTextContent('2 carriers know this number choose yours');
    expect(choices.map((choice) => choice.closest('label')!.textContent)).toEqual(['DPDKnows this number', 'SEURKnows this number']);
    // Going on stopped at the choice: the focus is there, and nothing was looked up.
    expect(choices[0]).toHaveFocus();
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(screen.getByText('Carriers reuse numbers after a while. Choose the one your shipping message names.')).toBeVisible();
    await user.click(choices[1]);
    await user.click(screen.getByRole('button', { name: 'Track the SEUR parcel' }));
    await waitFor(() => expect(onTracked).toHaveBeenCalledOnce());
    expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: SHARED, carrier: 'seur' }, expect.any(AbortSignal));
  });

  it('lists several numbers found in one text and tracks the chosen one', async () => {
    const { user, field } = door();
    await user.click(field);
    await user.paste(`Your order ships in 3 parcels:\nUPS ${UPS}\nUPS 1ZDEMO202600000002\nSwiss Post 99.34.123456.78901234`);
    const list = screen.getByRole('group', { name: '3 tracking numbers in this text' });
    const numbers = within(list).getAllByRole('radio');
    expect(numbers.map((number) => number.closest('label')!.textContent)).toEqual([`UPS${UPS}`, 'UPS1ZDEMO202600000002', 'Swiss Post99.34.123456.78901234']);
    expect(numbers[0]).toBeChecked();
    expect(numbers[0]).toHaveFocus();
    expect(mocks.lookup).not.toHaveBeenCalled();
    await user.click(within(list).getByRole('button', { name: 'Sign in and Peek keeps them together' }));
    expect(onSignIn).toHaveBeenCalledOnce();
    await user.click(numbers[2]);
    await user.click(screen.getByRole('button', { name: 'Track this one' }));
    await waitFor(() => expect(onTracked).toHaveBeenCalledOnce());
    expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: '993412345678901234', carrier: 'swiss-post' }, expect.any(AbortSignal));
  });

  it('asks about a check digit that does not add up once typing rests, and takes the suggested number', async () => {
    vi.useFakeTimers();
    const { field } = door();
    type(field, 'LX1234567B5DE');
    expect(screen.queryByText(/check digit/)).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(800); });
    // After a pause the question waits its turn to be read out; after Track it is said at once.
    expect(screen.getByText('This number’s check digit doesn’t add up. A letter may have been read as a digit.')).toHaveAttribute('role', 'status');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    const suggestion = screen.getByRole('button', { name: 'Did you mean LX123456785DE?' });
    expect([...suggestion.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['8']);
    fireEvent.click(suggestion);
    expect(field.value).toBe('LX123456785DE');
    expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: 'LX123456785DE', carrier: 'dhl' }, expect.any(AbortSignal));
  });

  it('tracks a doubtful number as typed when asked to', async () => {
    const { user, field, track } = door();
    await user.type(field, 'LX1234567B5DE');
    // The first Track shows the question instead of spending a lookup.
    await user.click(track);
    expect(screen.getByRole('alert')).toHaveTextContent('This number’s check digit doesn’t add up.');
    expect(mocks.lookup).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Track it as typed' }));
    await waitFor(() => expect(onTracked).toHaveBeenCalledOnce());
    expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: 'LX1234567B5DE' }, expect.any(AbortSignal));
  });

  it('says so when the text holds no tracking number, without asking anyone, and shows what numbers look like', async () => {
    const { user, field, track } = door();
    await user.click(track);
    expect(screen.queryByText(notFound)).not.toBeInTheDocument();
    await user.type(field, 'hello there{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(notFound);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(notFound);
    const shapes = screen.getByRole('region', { name: 'What tracking numbers look like' });
    expect(within(shapes).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'UPS1Z and 16 letters or digits', 'DHL10 digits, or JJD and 18 digits', 'Swiss Post2 letters, 9 digits, 2 letters', 'DPD14 digits',
    ]);
    expect(document.querySelector('.door-pip')).toBeNull();
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.detect).not.toHaveBeenCalled();
    await user.type(field, ` ${UPS}`);
    expect(screen.queryByText(notFound)).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute('aria-invalid');
  });

  it('waits for a pause before telling typed text it has no number, and answers a paste at once', async () => {
    vi.useFakeTimers();
    const { field } = door();
    type(field, 'LP');
    expect(screen.queryByText(notFound)).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(800); });
    expect(screen.getByText(notFound)).toHaveAttribute('role', 'status');
    type(field, '');
    fireEvent.paste(field);
    type(field, 'Thanks for your order! We’ll let you know as soon as it ships.');
    expect(screen.getByText(notFound)).toBeVisible();
  });

  it('recognises an Amazon order number and points to the orders page', async () => {
    const { user, field } = door();
    await user.click(field);
    await user.paste('302-4571983-2294617');
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('That looks like an Amazon order number');
    expect(within(note).getByRole('link', { name: 'Open my Amazon orders' })).toHaveAttribute('href', expect.stringContaining('amazon.'));
    expect(within(note).getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
    await user.type(field, '{Enter}');
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.detect).not.toHaveBeenCalled();
  });

  it('checks an Amazon number before looking it up, and sends account-only parcels to Amazon', async () => {
    mocks.detect.mockResolvedValueOnce({ trackingNumber: 'TBA123456789012', carrier: 'amazon-logistics', amazonShippingStatus: 'not-found' });
    const { user, field } = door();
    await user.type(field, 'TBA123456789012{Enter}');
    expect(await screen.findByText('Amazon Logistics deliveries are usually tracked in Your Orders on Amazon.')).toBeVisible();
    expect(mocks.lookup).not.toHaveBeenCalled();
    // Amazon Shipping tracks this one publicly.
    mocks.detect.mockResolvedValueOnce({ trackingNumber: 'TBA123456789013', carrier: 'amazon-shipping', amazonShippingStatus: 'available' });
    await user.clear(field);
    await user.type(field, 'TBA123456789013{Enter}');
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: 'TBA123456789013', carrier: 'amazon-shipping' }, expect.any(AbortSignal)));
  });

  it('asks for the postcode a carrier needs before looking the parcel up', async () => {
    mocks.detect.mockResolvedValueOnce({ trackingNumber: SHARED, carrier: 'gls-ch', asked: ['gls-ch'] });
    const { user, field, track } = door();
    await user.click(field);
    await user.paste(SHARED);
    const postcode = await screen.findByRole('textbox', { name: 'Delivery postcode' });
    expect(postcode).toHaveFocus();
    expect(postcode).toHaveAccessibleDescription('The carrier needs the delivery postcode to show your parcel’s updates.');
    expect(screen.getByText('Only sent to GLS Switzerland, never shown on shared links.')).toBeVisible();
    expect(mocks.lookup).not.toHaveBeenCalled();
    await user.click(track);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the delivery postcode shown on your order.');
    expect(postcode).toHaveAttribute('aria-invalid', 'true');
    expect(postcode).toHaveFocus();
    await user.type(postcode, '80a04');
    expect(postcode).toHaveValue('8004');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(postcode, '{Enter}');
    await waitFor(() => expect(onTracked).toHaveBeenCalledOnce());
    expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: SHARED, carrier: 'gls-ch', dpdPostcode: '8004' }, expect.any(AbortSignal));
  });

  it('offers the carrier picker beside the carrier line', async () => {
    const { user, field, track } = door();
    await user.type(field, 'DEMO4471203');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    const picker = await screen.findByRole('dialog', { name: 'Carrier' });
    await user.type(within(picker).getByRole('combobox', { name: 'Search carriers' }), 'GLS Switz');
    await user.click(within(picker).getByRole('option', { name: /GLS Switzerland/ }));
    expect(document.querySelector('.door-line')).toHaveTextContent('GLS Switzerland Chosen by you');
    // The chosen carrier asks for a postcode: its field takes the focus.
    expect(screen.getByRole('textbox', { name: 'Delivery postcode' })).toHaveFocus();
    await user.keyboard('8004');
    await user.click(track);
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: 'DEMO4471203', carrier: 'gls-ch', dpdPostcode: '8004' }, expect.any(AbortSignal)));
  });

  it('keeps the way to the picker in place while the carriers are asked', async () => {
    mocks.detect.mockReturnValueOnce(new Promise(() => undefined));
    const { user, field } = door();
    await user.type(field, SHARED);
    // Leaving the field for the button starts the asking; the button must still be there for the click.
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    expect(mocks.detect).toHaveBeenCalledOnce();
    const picker = await screen.findByRole('dialog', { name: 'Carrier' });
    expect(within(picker).getAllByText('Asking…').length).toBeGreaterThan(0);
    await user.type(within(picker).getByRole('combobox', { name: 'Search carriers' }), 'SEUR');
    await user.click(within(picker).getByRole('option', { name: /SEUR/ }));
    expect(document.querySelector('.door-line')).toHaveTextContent('SEUR Chosen by you');
  });

  it('counts a burst limit down on the button, without announcing every second', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    mocks.lookup.mockRejectedValueOnce(new ParcelLinkError('burst', { retryAfterSeconds: 42 }));
    const { field } = door();
    type(field, UPS);
    fireEvent.submit(field.closest('form')!);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const note = screen.getByRole('alert');
    expect(note).toHaveTextContent('Lots of lookups from your networkTo keep carriers happy, Peek slows down busy networks. Try again in a minute.');
    const waiting = screen.getByRole('button', { name: 'Try again in 0:42' });
    expect(waiting).toBeDisabled();
    expect(waiting.closest('[aria-live], [role="alert"], [role="status"]')).toBeNull();
    expect(field.value).toBe(UPS);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByRole('button', { name: 'Try again in 0:40' })).toBeDisabled();
    // A submit during the wait spends nothing.
    fireEvent.submit(field.closest('form')!);
    expect(mocks.lookup).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const track = screen.getByRole('button', { name: 'Track' });
    expect(track).toBeEnabled();
    fireEvent.click(track);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(onTracked).toHaveBeenCalledOnce();
  });

  it('says to sign in when the day’s lookups are used up', async () => {
    mocks.lookup.mockRejectedValueOnce(new ParcelLinkError('daily', { retryAfterSeconds: 3_600 }));
    const { user, field, track } = door();
    await user.type(field, `${UPS}{Enter}`);
    const note = await screen.findByRole('alert');
    expect(note).toHaveTextContent('No lookups left for today');
    expect(note).toHaveTextContent('Sign in to keep going.');
    expect(track).toBeEnabled();
    await user.click(within(note).getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledOnce();
    expect(field.value).toBe(UPS);
  });

  it('keeps the field and the device’s parcels when offline, and offers to try again', async () => {
    rememberParcel({ id: OTHER_LINK_ID, key: OWNER_KEY, view: testView({ id: OTHER_LINK_ID }), now: Date.now() });
    mocks.lookup.mockRejectedValueOnce(new ParcelLinkError('offline'));
    const { user, field } = door();
    await user.type(field, `${UPS}{Enter}`);
    const note = await screen.findByRole('alert');
    expect(note).toHaveTextContent('You’re offlineReconnect, then track again. Parcels already on this device stay listed.');
    expect(field.value).toBe(UPS);
    expect(screen.getByRole('region', { name: 'On this device' })).toBeVisible();
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Track' }));
    await waitFor(() => expect(onTracked).toHaveBeenCalledOnce());
  });

  it.each([
    [new ParcelLinkError('server'), 'Peek couldn’t look it up', 'Try again'],
    [new ParcelLinkError('validation', { guidance: 'error.trackingNumber' }), 'Check the tracking number and selected carrier, then try again.', 'Track'],
    [new Error('unexpected'), 'Peek couldn’t look it up', 'Try again'],
  ])('explains a failed lookup and loses nothing: %s', async (error, message, button) => {
    mocks.lookup.mockRejectedValueOnce(error);
    const { user, field } = door();
    await user.type(field, `${UPS}{Enter}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(onTracked).not.toHaveBeenCalled();
    expect(field.value).toBe(UPS);
    expect(field).toBeVisible();
    await user.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(onTracked).toHaveBeenCalledOnce());
  });

  it('asks once while a lookup is on its way, and drops it when the door closes', async () => {
    let answer: (value: ParcelLookup) => void = () => undefined;
    mocks.lookup.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const { user, field, track, view } = door();
    await user.type(field, '1234567899');
    await user.click(track);
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalledOnce());
    expect(track).toBeDisabled();
    fireEvent.submit(field.closest('form')!);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    const signal = mocks.lookup.mock.calls[0][1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    answer(lookup);
    await Promise.resolve();
    expect(onTracked).not.toHaveBeenCalled();
  });

  it('pastes from the clipboard with its own button', async () => {
    const { user } = door();
    await navigator.clipboard.writeText(`Your order has shipped: ${UPS}`);
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: UPS, carrier: 'ups' }, expect.any(AbortSignal)));
    expect(screen.queryByRole('button', { name: 'Paste' })).not.toBeInTheDocument();
  });

  it('explains how to paste by hand when the browser keeps the clipboard to itself, or when it is empty', async () => {
    const { user, field } = door();
    const read = vi.spyOn(navigator.clipboard, 'readText').mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t pasteThis browser didn’t let Peek read the clipboard. Click the field and paste there.');
    expect(field).toHaveFocus();
    expect(document.querySelector('.door-pip')).toBeNull();
    read.mockResolvedValueOnce('  ');
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(await screen.findByText('The clipboard is empty. Copy the tracking number or the shipping message first.')).toBeVisible();
    // The note goes once the field has something.
    await user.type(field, '1');
    expect(screen.queryByText('Couldn’t paste')).not.toBeInTheDocument();
  });

  it('tells a touch screen to long-press instead', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('coarse') || query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const { user } = door();
    vi.spyOn(navigator.clipboard, 'readText').mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Long-press the field and choose Paste.');
  });

  it('keeps what was typed before the page came alive', async () => {
    userEvent.setup();
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = renderToString(<FrontDoor onTracked={onTracked} onSignIn={onSignIn} />);
    // The page as the server sent it: the field takes text, the buttons wait.
    const field = container.querySelector('textarea')!;
    expect(within(container).getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(within(container).getByRole('button', { name: 'Track' })).toBeDisabled();
    expect(within(container).getByRole('button', { name: 'Paste' })).toBeDisabled();
    field.value = UPS;
    let root: Root;
    await act(async () => { root = hydrateRoot(container, <FrontDoor onTracked={onTracked} onSignIn={onSignIn} />); });
    expect(container.querySelector('textarea')).toBe(field);
    expect(field.value).toBe(UPS);
    expect(container.querySelector('.door-line')).toHaveTextContent('UPS Detected carrier');
    fireEvent.click(within(container).getByRole('button', { name: 'Track' }));
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: UPS, carrier: 'ups' }, expect.any(AbortSignal)));
    act(() => root.unmount());
    container.remove();
  });
});

describe('FrontDoor: on this device', () => {
  it('lists the parcels of this device as links in their carrier’s colours that open in place', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView(), now: Date.now() });
    renameParcel(LINK_ID, 'New sneakers');
    rememberParcel({ id: OTHER_LINK_ID, view: testView({ id: OTHER_LINK_ID, owner: false, stages: ['registered', 'delivered'] }), now: Date.now() - 60_000 });
    const { user } = door();
    const list = screen.getByRole('region', { name: 'On this device' });
    // The list takes Pip's place.
    expect(document.querySelector('.door-pip')).toBeNull();
    const links = within(list).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([`/p/${LINK_ID}`, `/p/${OTHER_LINK_ID}`]);
    expect(links[0]).toHaveAccessibleName(/DHL.*New sneakers.*In transit/);
    expect(links[0].style.getPropertyValue('--carrier-surface-light')).not.toBe('');
    expect(links[1]).toHaveTextContent('123 ••• 99');
    expect(links[1]).toHaveTextContent('Delivered');
    expect(within(list).getByText('Kept in this browser only.')).toBeVisible();
    await user.click(within(list).getByRole('button', { name: 'Sign in to keep them, with alerts' }));
    expect(onSignIn).toHaveBeenCalledOnce();
    // A modified click is the browser's: a new tab opens the address itself.
    let takenByPage = true;
    window.addEventListener('click', (event) => { takenByPage = event.defaultPrevented; event.preventDefault(); }, { once: true });
    fireEvent.click(links[0], { metaKey: true });
    expect(takenByPage).toBe(false);
    expect(location.pathname).toBe('/');
    await user.click(links[1]);
    expect(location.pathname).toBe(`/p/${OTHER_LINK_ID}`);
    // Fresh answers are not asked for again.
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('shortens a long number to its two ends', () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView({ parcel: { trackingNumber: 'DEMOGLS20260001', carrier: 'gls-ch' } }), now: Date.now() });
    door();
    expect(screen.getByRole('link')).toHaveTextContent('DEMOGLS…0001');
  });

  it('opens the link of a number the device already follows instead of spending a lookup', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView({ parcel: { trackingNumber: UPS, carrier: 'ups' } }), now: Date.now() });
    const { user, field } = door();
    await user.type(field, '1z demo 2026 0000 0001');
    expect(document.querySelector('.door-line')).toHaveTextContent('UPS already on this device');
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    expect(location.pathname).toBe(`/p/${LINK_ID}`);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(onTracked).not.toHaveBeenCalled();
  });

  it('brings stale parcels up to date quietly, keeps their order, and drops one the server no longer has', async () => {
    const hour = 3_600_000;
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView(), now: Date.now() - hour });
    rememberParcel({ id: OTHER_LINK_ID, view: testView({ id: OTHER_LINK_ID, owner: false }), now: Date.now() - 2 * hour });
    const seen = recentFor(LINK_ID)!.lastSeenAt;
    mocks.read.mockImplementation(async (id: string) => id === LINK_ID ? testView({ stages: ['registered', 'in_transit', 'out_for_delivery'] }) : 'unavailable');
    door();
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(1));
    expect(screen.getByRole('link')).toHaveTextContent('Out for delivery');
    expect(mocks.read).toHaveBeenCalledWith(LINK_ID, { key: OWNER_KEY, signal: expect.any(AbortSignal) });
    expect(mocks.read).toHaveBeenCalledWith(OTHER_LINK_ID, { key: null, signal: expect.any(AbortSignal) });
    expect(recentFor(LINK_ID)).toMatchObject({ key: OWNER_KEY, stage: 'out_for_delivery', lastSeenAt: seen });
    expect(recentFor(OTHER_LINK_ID)).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaves the list as it is when the parcels cannot be read', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView(), now: 1 });
    rememberParcel({ id: OTHER_LINK_ID, view: testView({ id: OTHER_LINK_ID }), now: 2 });
    mocks.read.mockRejectedValue(new ParcelLinkError('offline'));
    door();
    await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('forgets every parcel after asking once: on the server for the device’s own lookups, then on the device', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView(), now: Date.now() });
    rememberParcel({ id: OTHER_LINK_ID, view: testView({ id: OTHER_LINK_ID, owner: false }), now: Date.now() - 60_000 });
    const { user, field } = door();
    await user.click(screen.getByRole('button', { name: 'Forget all' }));
    const question = screen.getByRole('group', { name: 'Forget these 2 parcels?' });
    expect(question).toHaveFocus();
    expect(mocks.forget).not.toHaveBeenCalled();
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByRole('link')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Forget all' }));
    await user.click(screen.getByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'On this device' })).not.toBeInTheDocument());
    // Only the lookup this device made, with its key; a link shared with it just leaves the list.
    expect(mocks.forget.mock.calls).toEqual([[LINK_ID, OWNER_KEY]]);
    expect(recentFor(LINK_ID)).toBeNull();
    expect(recentFor(OTHER_LINK_ID)).toBeNull();
    expect(field).toHaveFocus();
    // With nothing on the device, Pip is back.
    expect(document.querySelector('.door-pip')).toBeInTheDocument();
  });

  it('keeps what could not be forgotten and says so; a parcel already gone from the server just leaves', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView(), now: Date.now() });
    rememberParcel({ id: OTHER_LINK_ID, key: 'B'.repeat(43), view: testView({ id: OTHER_LINK_ID }), now: Date.now() - 60_000 });
    mocks.forget.mockImplementation(async (id: string) => { throw new ParcelLinkError(id === LINK_ID ? 'offline' : 'unavailable'); });
    const { user } = door();
    await user.click(screen.getByRole('button', { name: 'Forget all' }));
    await user.click(screen.getByRole('button', { name: 'Forget' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t forget every parcel. Check your connection and try again.');
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([`/p/${LINK_ID}`]);
    expect(screen.getByRole('button', { name: 'Forget all' })).toBeVisible();
  });

  it('asks again, a few times, about a parcel whose carrier has not answered yet', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: pendingView(), now: Date.now() });
    mocks.read.mockResolvedValueOnce(pendingView()).mockResolvedValue(testView());
    const { view } = door();
    expect(screen.getByRole('link')).toHaveTextContent('Checking for updates');
    // Just looked up: not asked at once.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(screen.getByRole('link')).toHaveTextContent('Checking for updates');
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link')).toHaveTextContent('In transit');
    // Answered: the list rests.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('asks about one parcel in the singular', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView(), now: Date.now() });
    const { user } = door();
    await user.click(screen.getByRole('button', { name: 'Forget all' }));
    expect(screen.getByRole('group', { name: 'Forget this parcel?' })).toBeVisible();
  });
});
