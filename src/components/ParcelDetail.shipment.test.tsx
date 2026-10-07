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

  it('shows available facts and omits unknown or invalid measurements', () => {
    const view = show({ pickupPoint: 'Corner shop\n12 Main Street', receiverName: 'Alex', weightKg: 1.25, dimensionsText: '20 × 30 × 10 cm' });
    expect(screen.getByText('Pickup location')).toBeInTheDocument();
    expect(screen.getByText(/Corner shop/)).toHaveTextContent('12 Main Street');
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('1.25 kg')).toBeInTheDocument();
    expect(screen.getByText('20 × 30 × 10 cm')).toBeInTheDocument();
    view.unmount();
    show({ weightKg: -1 });
    expect(screen.queryByText('Weight')).not.toBeInTheDocument();
    expect(screen.queryByText('Pickup location')).not.toBeInTheDocument();
  });

  it('shows a waiting parcel\'s pickup point as a card and a collected one as a fact', async () => {
    const at = (stage: 'ready_for_pickup' | 'delivered') => [{ id: stage, parcelId: 'parcel', stage, description: 'Scan', occurredAt: '2026-09-11T12:00:00Z' }];
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const view = show({ pickupPoint: 'Corner shop\n12 Main Street', events: at('ready_for_pickup') });
    const card = screen.getByRole('region', { name: 'Pickup location' });
    expect(card).toHaveTextContent('Corner shop12 Main Street');
    expect(screen.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', expect.stringContaining('Corner%20shop%2C%2012%20Main%20Street'));
    expect(screen.getByRole('link', { name: 'Directions' })).toHaveAttribute('rel', 'noopener noreferrer');
    await userEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    expect(writeText).toHaveBeenCalledWith('Corner shop, 12 Main Street');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.getAllByText('Pickup location')).toHaveLength(1);
    view.unmount();

    const office = show({ pickupPoint: 'Post office 42', events: at('ready_for_pickup') });
    expect(screen.getByRole('link', { name: 'Show on map' })).toHaveAttribute('href', expect.stringContaining('Post%20office%2042'));
    expect(screen.queryByRole('button', { name: 'Copy address' })).not.toBeInTheDocument();
    office.unmount();

    show({ pickupPoint: 'Corner shop\n12 Main Street', events: at('delivered') });
    expect(screen.queryByRole('region', { name: 'Pickup location' })).not.toBeInTheDocument();
    expect(screen.getByText('Collected at')).toBeInTheDocument();
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
    expect(screen.getByText(/DPD didn't accept postcode 8000, so it shows fewer details\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit postcode' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    view.unmount();
    show({ carrier: 'dpd', trackingNumber: '06080000000002', dpdPostcode: '8000', dpdPostcodeVerified: true });
    expect(screen.queryByText(/didn't accept postcode/)).not.toBeInTheDocument();
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
