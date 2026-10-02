import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_ID, OTHER_LINK_ID, OWNER_KEY, testView } from '../test/parcelLinks';
import { FrontDoor } from './FrontDoor';
import { ParcelLinkError, type ParcelLookup } from './links';
import { forgetAllRecents, rememberParcel, renameParcel } from './recents';

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('./links', async (original) => ({
  ...await original<typeof import('./links')>(),
  lookupParcel: mocks.lookup,
}));

const lookup: ParcelLookup = { id: LINK_ID, key: OWNER_KEY, view: testView() };
const onTracked = vi.fn();
const onSignIn = vi.fn();

function door() {
  const view = render(<FrontDoor onTracked={onTracked} onSignIn={onSignIn} />);
  return {
    view,
    user: userEvent.setup(),
    field: screen.getByRole('textbox', { name: 'Tracking number or link' }),
    track: screen.getByRole('button', { name: 'Track' }),
  };
}

beforeEach(() => { vi.clearAllMocks(); mocks.lookup.mockResolvedValue(lookup); });
afterEach(() => { forgetAllRecents(); history.replaceState(null, '', '/'); });

describe('FrontDoor', () => {
  it('shows the name, the question, a closed Pip, the field and the way to sign in', async () => {
    const { user, track } = door();
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    expect(screen.getByText('Universal Parcel Tracker')).toBeVisible();
    expect(document.querySelectorAll('.door-pip .parcel-illustration__eye')).toHaveLength(2);
    expect(document.querySelector<HTMLElement>('.door-pip')!.style.viewTransitionName).toBe('peek-pip');
    expect(track).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'On this device' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('finds the number in what was pasted, looks it up and hands the answer over', async () => {
    const { user, field, track } = door();
    await user.type(field, 'Your parcel 99.34.111111.22222222 is on its way');
    await user.click(track);
    await waitFor(() => expect(onTracked).toHaveBeenCalledWith({ id: LINK_ID, key: OWNER_KEY, carrier: 'dhl', response: lookup.view }));
    expect(mocks.lookup).toHaveBeenCalledWith({ trackingNumber: '993411111122222222', carrier: 'swiss-post' }, expect.any(AbortSignal));
    // The name never travels with a lookup.
    expect(Object.keys(mocks.lookup.mock.calls[0][0])).not.toContain('label');
  });

  it('says so when the text holds no tracking number, without asking anyone', async () => {
    const { user, field, track } = door();
    await user.click(track);
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t find a tracking number.');
    await user.type(field, 'hello there{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t find a tracking number.');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.lookup).not.toHaveBeenCalled();
    await user.type(field, '!');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute('aria-invalid');
  });

  it.each([
    [new ParcelLinkError('daily', { retryAfterSeconds: 3_600 }), 'No lookups are left for today. Sign in to keep going.'],
    [new ParcelLinkError('burst', { retryAfterSeconds: 42 }), 'Please wait a moment before trying again.'],
    [new ParcelLinkError('offline'), 'Check your internet connection and try again.'],
    [new ParcelLinkError('validation', { guidance: 'error.postcode' }), 'Enter the delivery postcode shown on your order.'],
    [new ParcelLinkError('server'), 'Something went wrong. Please try again.'],
  ])('explains a failed lookup: %s', async (error, message) => {
    mocks.lookup.mockRejectedValueOnce(error);
    const { user, field, track } = door();
    await user.type(field, '1234567899');
    await user.click(track);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(onTracked).not.toHaveBeenCalled();
    expect(track).toBeEnabled();
  });

  it('asks once while a lookup is on its way, and drops it when the door closes', async () => {
    let answer: (value: ParcelLookup) => void = () => undefined;
    mocks.lookup.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const { user, field, track, view } = door();
    await user.type(field, '1234567899{Enter}');
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

  it('lists the parcels of this device as links that open in place', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView(), now: 2 });
    renameParcel(LINK_ID, 'New sneakers');
    rememberParcel({ id: OTHER_LINK_ID, view: testView({ id: OTHER_LINK_ID, owner: false, stages: ['registered', 'delivered'] }), now: 1 });
    const { user } = door();
    expect(screen.getByRole('heading', { name: 'On this device' })).toBeVisible();
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([`/p/${LINK_ID}`, `/p/${OTHER_LINK_ID}`]);
    expect(links[0]).toHaveTextContent('New sneakers');
    expect(links[0]).toHaveTextContent('DHL · In transit');
    expect(links[1]).toHaveTextContent('123 ••• 99');
    expect(links[1]).toHaveTextContent('Delivered');
    // A modified click is the browser's: a new tab opens the address itself.
    let takenByPage = true;
    window.addEventListener('click', (event) => { takenByPage = event.defaultPrevented; event.preventDefault(); }, { once: true });
    fireEvent.click(links[0], { metaKey: true });
    expect(takenByPage).toBe(false);
    expect(location.pathname).toBe('/');
    await user.click(links[1]);
    expect(location.pathname).toBe(`/p/${OTHER_LINK_ID}`);
  });
});
