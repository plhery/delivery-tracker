import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ParcelDetail } from './ParcelDetail';
import type { ParcelWithEvents } from '../types';

const parcel: ParcelWithEvents = { id: 'parcel', carrier: 'heppner', trackingNumber: '12345678', label: 'Books', createdAt: '2026-09-10T12:00:00Z', syncStatus: 'ok', events: [] };
function show(values: Partial<ParcelWithEvents> = {}) {
  return render(<ParcelDetail parcel={{ ...parcel, ...values }} onBack={vi.fn()} onRename={vi.fn()} onChangeCarrier={vi.fn()} onSetNotificationsMuted={vi.fn()} onRefresh={vi.fn()} onRestore={vi.fn()} onArchive={vi.fn()} onDelete={vi.fn()} />);
}

describe('shipment details', () => {
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

  it('opens the existing tracking editor for missing input', async () => {
    show({ syncStatus: 'error', syncError: 'carrier:input_required' });
    await userEvent.click(screen.getByRole('button', { name: 'Update tracking details' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('carrier:input_required')).not.toBeInTheDocument();
  });

  it('never displays legacy diagnostics', () => {
    show({ syncStatus: 'error', syncError: 'private upstream error details' });
    expect(screen.queryByText('private upstream error details')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update tracking details' })).not.toBeInTheDocument();
  });
});
