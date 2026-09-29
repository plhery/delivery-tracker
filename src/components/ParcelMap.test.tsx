import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { trackAction } from '../lib/analytics';
import type { EventPlace, ParcelWithEvents, Stage, TrackingEvent } from '../types';
import { buildRoute, countryPlace, formatKm, type Place, type Scan } from './map/route';
import { ParcelDetail } from './ParcelDetail';
import { ParcelMapSheet } from './ParcelMap';

vi.mock('../lib/analytics', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/analytics')>(),
  trackAction: vi.fn(),
}));

const kyoto: EventPlace = { latitude: 35.01, longitude: 135.77, precision: 'city', country: 'JP', name: 'Kyoto' };
const leipzig: EventPlace = { latitude: 51.34, longitude: 12.37, precision: 'city', country: 'DE', name: 'Leipzig' };
const harkingen: EventPlace = { latitude: 47.305, longitude: 7.821, precision: 'city', country: 'CH', name: 'Härkingen' };
const event = (day: number, stage: Stage, place?: EventPlace): TrackingEvent => ({
  id: `event-${day}`, parcelId: 'parcel', stage, description: 'Scan', occurredAt: `2026-09-${String(day).padStart(2, '0')}T08:00:00Z`, place,
});
const parcel: ParcelWithEvents = {
  id: 'parcel', carrier: 'dhl', trackingNumber: '12345678', label: 'Tea', createdAt: '2026-09-10T12:00:00Z', syncStatus: 'ok',
  destinationCountry: 'CH',
  events: [event(20, 'out_for_delivery', harkingen), event(14, 'in_transit', leipzig), event(11, 'in_transit', kyoto)],
};

function show(values: Partial<ParcelWithEvents> = {}) {
  return render(<ParcelDetail parcel={{ ...parcel, ...values }} onBack={vi.fn()} onRename={vi.fn()} onChangeCarrier={vi.fn()} onSetNotificationsMuted={vi.fn()} onRefresh={vi.fn()} onRestore={vi.fn()} onArchive={vi.fn()} onDelete={vi.fn()} />);
}

describe('parcel map', () => {
  it('opens the whole journey from the card and closes it again', async () => {
    const user = userEvent.setup();
    show();
    // The parcel page renders into the document body.
    expect(document.querySelector('.detail__hero--map .detail__engraving')).not.toBeNull();
    const open = screen.getByRole('button', { name: 'Open the map' });
    // The map data loads on demand; until then the button waits.
    await waitFor(() => expect(open).toBeEnabled());
    await user.click(open);
    expect(trackAction).toHaveBeenCalledWith('parcel-map-open');
    const map = screen.getByRole('dialog', { name: 'Map of the journey from Kyoto to Härkingen' });
    expect(within(map).getByText('From').nextElementSibling).toHaveTextContent('Kyoto');
    expect(within(map).getByText('Now').nextElementSibling).toHaveTextContent('Härkingen');
    expect(within(map).getByText('3 countries')).toBeInTheDocument();
    expect(within(map).getByText(/ so far$/)).toBeInTheDocument();
    // Out for delivery, the camera follows the parcel to its last mile.
    const nearby = within(map).getByRole('button', { name: 'Nearby' });
    const journey = within(map).getByRole('button', { name: 'Journey' });
    expect(nearby).toHaveAttribute('aria-pressed', 'true');
    await user.click(journey);
    expect(journey).toHaveAttribute('aria-pressed', 'true');
    await user.click(journey);
    expect(journey).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /Map of the journey/ })).not.toBeInTheDocument();

    await user.click(open);
    await user.click(screen.getByRole('button', { name: 'Close the map' }));
    expect(screen.queryByRole('dialog', { name: /Map of the journey/ })).not.toBeInTheDocument();
  });

  it('opens from the engraving too', async () => {
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open the map' })).toBeEnabled());
    await user.click(document.querySelector('.detail__engraving')!);
    expect(screen.getByRole('dialog', { name: /Map of the journey/ })).toBeInTheDocument();
  });

  it('leaves the card as it was when no scan has a place', () => {
    show({ events: [event(11, 'in_transit')] });
    expect(document.querySelector('.detail__engraving')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open the map' })).not.toBeInTheDocument();
  });
});

describe('map summary', () => {
  const city = (name: string, country: string, longitude: number, latitude: number): Place => ({
    id: name, name, country, coordinate: [longitude, latitude], precision: 'city',
  });
  const scan = (place?: Place): Scan => ({ at: '2026-09-28T10:00:00Z', description: 'Scan', stage: 'in_transit', place });
  const tokyo = city('Tokyo', 'JP', 139.69, 35.69);
  const bern = city('Bern', 'CH', 7.45, 46.95);
  const sheet = (route: ReturnType<typeof buildRoute>, stage?: Stage) =>
    render(<ParcelMapSheet route={route} stage={stage} brand={{}} onClose={vi.fn()} />);

  it('tells how far is left to the destination country', () => {
    const route = buildRoute([scan(tokyo)], countryPlace('CH', 'Switzerland', [7.46, 46.72]));
    sheet(route, 'in_transit');
    expect(screen.getByRole('dialog', { name: 'Map of the journey from Tokyo to Switzerland' })).toBeInTheDocument();
    expect(screen.getByText('To').nextElementSibling).toHaveTextContent('Switzerland');
    expect(screen.getByText(`${formatKm(route.remainingKm!, 'en-CH')} to go`)).toBeInTheDocument();
    // One stop and no close-up: nothing to switch between.
    expect(screen.queryByRole('group', { name: 'Map view' })).not.toBeInTheDocument();
  });

  it('says delivered, or last seen when the newest scan has no place', () => {
    const route = buildRoute([scan(tokyo), scan(bern)]);
    const view = sheet(route, 'delivered');
    expect(screen.getByText('Delivered').nextElementSibling).toHaveTextContent('Bern');
    // A finished journey states its length, not a distance so far.
    expect(screen.getByText(formatKm(route.km, 'en-CH'))).toBeInTheDocument();
    expect(screen.queryByText(/so far/)).not.toBeInTheDocument();
    view.unmount();
    const returned = sheet(buildRoute([scan(tokyo)], countryPlace('CH', 'Switzerland', [7.46, 46.72])), 'returned');
    expect(screen.queryByText(/to go/)).not.toBeInTheDocument();
    returned.unmount();
    sheet(buildRoute([scan(tokyo), scan(bern), scan()]));
    expect(screen.getByText('Last seen').nextElementSibling).toHaveTextContent('Bern');
  });

  it('shows a single place on its own', () => {
    sheet(buildRoute([scan(bern)]));
    expect(screen.getByRole('dialog', { name: 'Map showing Bern' })).toBeInTheDocument();
    expect(screen.queryByText('From')).not.toBeInTheDocument();
    expect(screen.getByText('Now').nextElementSibling).toHaveTextContent('Bern');
  });

  it('shows nothing to summarise before any scan has a place', () => {
    sheet(buildRoute([]));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('Now')).not.toBeInTheDocument();
  });
});
