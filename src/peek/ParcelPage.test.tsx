import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_ID, OWNER_KEY, pendingView, testView } from '../test/parcelLinks';
import { ParcelLinkError } from './links';
import { ParcelPage } from './ParcelPage';
import { forgetAllRecents, recentFor, rememberParcel } from './recents';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./links', async (original) => ({
  ...await original<typeof import('./links')>(),
  readParcelLink: mocks.read,
}));

beforeEach(() => { mocks.read.mockReset(); history.replaceState(null, '', `/p/${LINK_ID}`); });
afterEach(() => { forgetAllRecents(); history.replaceState(null, '', '/'); });

describe('ParcelPage', () => {
  it('loads a link opened directly and shows the carrier, the status, the number and the journey', async () => {
    mocks.read.mockResolvedValue(testView({ parcel: { expectedDelivery: '2099-01-05' } }));
    render(<ParcelPage linkId={LINK_ID} />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking for updates');
    expect(await screen.findByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
    const page = document.querySelector('main')!;
    expect(page).toHaveAttribute('data-entrance', 'direct');
    expect(page).toHaveAttribute('data-live', 'true');
    expect(screen.getByLabelText('DHL')).toBeVisible();
    expect(screen.getByText('Tracking number').parentElement).toHaveTextContent('1234567899');
    expect(screen.getByText(/^Expected: /)).toBeVisible();
    expect(screen.getByText('Scan 2')).toBeVisible();
    // Pip wears the carrier's label, and keeps the name the browser moves it by.
    expect(document.querySelector('.peekp-pip .parcel-illustration__label-name')).toHaveTextContent('DHL');
    expect(document.querySelector('.peekp-pip .parcel-illustration__label-number')).toHaveTextContent('1234567899');
    expect(document.querySelector<HTMLElement>('.peekp-pip')!.style.viewTransitionName).toBe('peek-pip');
    expect(recentFor(LINK_ID)).toMatchObject({ carrier: 'dhl', stage: 'in_transit' });
  });

  it('opens revealed from the door with the lookup’s answer, before any read', () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: pendingView() });
    mocks.read.mockResolvedValue(pendingView());
    render(<ParcelPage linkId={LINK_ID} entrance="reveal" initial={pendingView()} />);
    expect(document.querySelector('main')).toHaveAttribute('data-entrance', 'reveal');
    expect(screen.getByRole('heading', { level: 1, name: 'Checking for updates' })).toBeVisible();
    expect(screen.getByText('Checking for updates…')).toBeVisible();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('shows a viewer the masked number and the name the link carries', async () => {
    history.replaceState(null, '', `/p/${LINK_ID}#n=${encodeURIComponent('For Mum')}`);
    mocks.read.mockResolvedValue(testView({ owner: false }));
    render(<ParcelPage linkId={LINK_ID} />);
    expect(await screen.findByText('For Mum')).toBeVisible();
    expect(screen.getByText('Tracking number').parentElement).toHaveTextContent('123 ••• 99');
    expect(document.querySelector('.parcel-illustration__label-number')).toHaveTextContent('123 ••• 99');
    expect(document.body).not.toHaveTextContent('1234567899');
  });

  it('says a forgotten link is gone, and leads back to the front door', async () => {
    mocks.read.mockResolvedValue('unavailable');
    render(<ParcelPage linkId={LINK_ID} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'This parcel has been forgotten' })).toBeVisible();
    expect(screen.getByText(/Peek forgets parcels 30 days after delivery/)).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Where’s my parcel?' }));
    expect(location.pathname).toBe('/');
  });

  it('keeps the last answer on screen when a read fails, with the reason', async () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
    mocks.read.mockRejectedValue(new ParcelLinkError('offline'));
    render(<ParcelPage linkId={LINK_ID} />);
    expect(await screen.findByText('Check your internet connection and try again.')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
  });

  it('explains why nothing can be shown when the first read fails', async () => {
    mocks.read.mockRejectedValue(new ParcelLinkError('server'));
    render(<ParcelPage linkId={LINK_ID} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
  });

  it('checks again on request, and returns home from the name', async () => {
    mocks.read.mockResolvedValueOnce(testView()).mockResolvedValue(testView({ stages: ['registered', 'in_transit', 'delivered'] }));
    const user = userEvent.setup();
    render(<ParcelPage linkId={LINK_ID} />);
    await user.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Delivered' })).toBeVisible();
    expect(mocks.read).toHaveBeenLastCalledWith(LINK_ID, expect.objectContaining({ advance: true }));
    await act(async () => { await user.click(screen.getByRole('button', { name: 'Peek' })); });
    expect(location.pathname).toBe('/');
  });
});
