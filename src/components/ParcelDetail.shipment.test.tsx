import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ParcelDetail } from './ParcelDetail';
import { parcelTrackingLinks } from '../lib/carriers';
import type { ParcelWithEvents } from '../types';

const parcel: ParcelWithEvents = { id: 'parcel', carrier: 'heppner', trackingNumber: '12345678', label: 'Books', createdAt: '2026-09-10T12:00:00Z', syncStatus: 'ok', events: [] };
function show(values: Partial<ParcelWithEvents> = {}) {
  return render(<ParcelDetail parcel={{ ...parcel, ...values }} onBack={vi.fn()} onRename={vi.fn()} onChangeCarrier={vi.fn()} onSetNotificationsMuted={vi.fn()} onRefresh={vi.fn()} onRestore={vi.fn()} onArchive={vi.fn()} onDelete={vi.fn()} />);
}

describe('shipment details', () => {
  it('shows the PostLogistics dash after the stored number has been normalized', () => {
    show({ carrier: 'postlogistics', trackingNumber: '12345678001' });
    expect(screen.getByText('12345678-001')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /PostLogistics/ })).toHaveAttribute(
      'href', parcelTrackingLinks({ carrier: 'postlogistics', trackingNumber: '12345678001' })[0].url,
    );
  });

  it('shows a parcel handed to a second carrier with both marks, who delivers, and each website under its number', () => {
    const handed = { carrier: 'gls-de', trackingNumber: '12345678901', originalCarrier: 'gls-de', originalTrackingNumber: '12345678901',
      trackingSource: 'swiss-post', activeTrackingNumber: '993412345612345678' } as const;
    const view = show(handed);
    const change = screen.getByRole('button', { name: 'Change carrier from GLS Germany. Delivery with Swiss Post' });
    expect([...change.querySelectorAll('.carrier-mark')].map(mark => mark.getAttribute('title'))).toEqual(['GLS Germany', 'Swiss Post']);
    expect(change.querySelector('.detail__delivery-mark')).toHaveTextContent('Swiss Post');
    expect(screen.getByText('Delivery with Swiss Post')).toHaveClass('detail__delivery');
    const links = screen.getAllByRole('link', { name: /^Open the .+ website$/ });
    // Delivery first, each link right after the ticket of its own number.
    expect(links.map(link => link.closest('.detail__carrier-links')!.previousElementSibling!.querySelector('.detail__tracking-label')!.textContent))
      .toEqual(['Swiss Post', 'GLS Germany']);
    expect(links.map(link => link.getAttribute('href'))).toEqual(parcelTrackingLinks(handed, 'en').map(link => link.url));
    expect(screen.queryByText('Earlier journey')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tracking sources')).not.toBeInTheDocument();
    view.unmount();

    show();
    expect(screen.getByRole('button', { name: 'Change carrier from Heppner' }).querySelectorAll('.carrier-mark')).toHaveLength(1);
    expect(screen.queryByText(/^Delivery with/)).not.toBeInTheDocument();
  });

  it('says who will deliver before that carrier is followed, under the followed number', () => {
    const named = { carrier: 'chronopost', trackingNumber: 'XY123456789FR', deliveryCarrier: 'dpd-de', deliveryTrackingNumber: '01234567890123' } as const;
    show(named);
    const change = screen.getByRole('button', { name: 'Change carrier from Chronopost. Delivery with DPD Germany' });
    expect([...change.querySelectorAll('.carrier-mark')].map(mark => mark.getAttribute('title'))).toEqual(['Chronopost', 'DPD Germany']);
    expect(screen.getByText('Delivery with DPD Germany')).toHaveClass('detail__delivery');
    // The followed number stays on top; the delivering carrier's follows, each with its own website.
    expect([...document.querySelectorAll('.detail__tracking-label')].map(label => label.textContent)).toEqual(['Chronopost', 'DPD Germany']);
    const links = screen.getAllByRole('link', { name: /^Open the .+ website$/ });
    expect(links.map(link => link.closest('.detail__carrier-links')!.previousElementSibling!.querySelector('.detail__tracking-label')!.textContent))
      .toEqual(['Chronopost', 'DPD Germany']);
    expect(links.map(link => link.getAttribute('href'))).toEqual(parcelTrackingLinks(named, 'en').map(link => link.url));
    expect(screen.queryByText('Not ready yet')).not.toBeInTheDocument();
  });

  it('shows available facts and omits unknown or invalid measurements', () => {
    const view = show({ pickupPoint: 'Corner shop\n12 Main Street', receiverName: 'Alex', weightKg: 1.25, dimensionsText: '20 × 30 × 10 cm' });
    expect(screen.getByText('Pickup point')).toBeInTheDocument();
    expect(screen.getByText(/Corner shop/)).toHaveTextContent('12 Main Street');
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('1.25 kg')).toBeInTheDocument();
    expect(screen.getByText('20 × 30 × 10 cm')).toBeInTheDocument();
    view.unmount();
    show({ weightKg: -1 });
    expect(screen.queryByText('Weight')).not.toBeInTheDocument();
    expect(screen.queryByText('Pickup point')).not.toBeInTheDocument();
  });

  it('shows a waiting parcel\'s pickup point as a card and a collected one as a fact', async () => {
    const at = (stage: 'ready_for_pickup' | 'delivered') => [{ id: stage, parcelId: 'parcel', stage, description: 'Scan', occurredAt: '2026-09-11T12:00:00Z' }];
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const view = show({ pickupPoint: 'Corner shop\n12 Main Street', events: at('ready_for_pickup') });
    const card = screen.getByRole('region', { name: 'Pickup point' });
    expect(card).toHaveTextContent('Corner shop12 Main Street');
    expect(screen.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', expect.stringContaining('Corner%20shop%2C%2012%20Main%20Street'));
    expect(screen.getByRole('link', { name: 'Directions' })).toHaveAttribute('rel', 'noopener noreferrer');
    await userEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    expect(writeText).toHaveBeenCalledWith('Corner shop, 12 Main Street');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.getAllByText('Pickup point')).toHaveLength(1);
    view.unmount();

    const office = show({ pickupPoint: 'Post office 42', events: at('ready_for_pickup') });
    expect(screen.getByRole('link', { name: 'Show on map' })).toHaveAttribute('href', expect.stringContaining('Post%20office%2042'));
    expect(screen.queryByRole('button', { name: 'Copy address' })).not.toBeInTheDocument();
    office.unmount();

    show({ pickupPoint: 'Corner shop\n12 Main Street', events: at('delivered') });
    expect(screen.queryByRole('region', { name: 'Pickup point' })).not.toBeInTheDocument();
    expect(screen.getByText('Picked up at')).toBeInTheDocument();
    expect(screen.getByText(/Corner shop/)).toHaveTextContent('12 Main Street');
  });

  it('opens the existing tracking editor for missing input', async () => {
    show({ syncStatus: 'error', syncError: 'carrier:input_required' });
    await userEvent.click(screen.getByRole('button', { name: 'Update tracking details' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('carrier:input_required')).not.toBeInTheDocument();
  });

  it('says when DPD rejected the postcode and opens the editor to change it', async () => {
    const view = show({ carrier: 'dpd', trackingNumber: '06080000000002', dpdPostcode: '8000', dpdPostcodeVerified: false });
    expect(screen.getByText(/DPD Switzerland didn’t accept postcode 8000, so it shows fewer details\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit postcode' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    view.unmount();
    show({ carrier: 'dpd', trackingNumber: '06080000000002', dpdPostcode: '8000', dpdPostcodeVerified: true });
    expect(screen.queryByText(/didn’t accept postcode/)).not.toBeInTheDocument();
  });

  it('offers the carrier that recognized the number and needs a postcode', async () => {
    const view = show({ carrier: 'unknown', trackingNumber: '12345678901', inputNeeded: { carrier: 'gls-ch', field: 'dpdPostcode' } });
    const prompt = screen.getByText('GLS Switzerland has this parcel. Add the delivery postcode to track it.');
    expect(prompt).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add postcode' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Carrier GLS Switzerland' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Delivery postcode/ })).toBeInTheDocument();
    view.unmount();
    // Nothing to ask once it is filed under that carrier, or when it is delivered.
    const filed = show({ carrier: 'gls-ch', trackingNumber: '12345678901', inputNeeded: { carrier: 'gls-ch', field: 'dpdPostcode' } });
    expect(screen.queryByText(/has this parcel/)).not.toBeInTheDocument();
    filed.unmount();
    show({ carrier: 'unknown', trackingNumber: '12345678901', inputNeeded: { carrier: 'gls-ch', field: 'dpdPostcode' },
      events: [{ id: 'event', parcelId: 'parcel', stage: 'delivered', description: 'Delivered', occurredAt: '2026-09-10T10:00:00Z' }] });
    expect(screen.queryByText(/has this parcel/)).not.toBeInTheDocument();
  });

  it('never displays legacy diagnostics', () => {
    show({ syncStatus: 'error', syncError: 'private upstream error details' });
    expect(screen.queryByText('private upstream error details')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update tracking details' })).not.toBeInTheDocument();
  });
});
