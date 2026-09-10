import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ParcelDetail } from './ParcelDetail';

describe('existing Amazon Logistics parcels', () => {
  it('explains expired Shipping history without presenting a tracking failure', () => {
    render(<ParcelDetail
      parcel={{ id: 'amazon-shipping-parcel', carrier: 'amazon-shipping', trackingNumber: 'UK3000000001', label: 'Books',
        createdAt: '2026-09-10T12:00:00Z', syncStatus: 'unsupported', syncError: 'amazon_shipping_history_expired', events: [] }}
      onBack={vi.fn()} onRename={vi.fn()} onChangeCarrier={vi.fn()} onSetNotificationsMuted={vi.fn()}
      onRefresh={vi.fn()} onRestore={vi.fn()} onArchive={vi.fn()} onDelete={vi.fn()}
    />);
    expect(screen.getByRole('note')).toHaveTextContent('Amazon no longer provides its tracking history');
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://track.amazon.co.uk/tracking/UK3000000001');
    expect(screen.queryByText('amazon_shipping_history_expired')).not.toBeInTheDocument();
  });

  it.each(['amazon-logistics', 'unknown'] as const)('explains account tracking for a saved %s parcel', (carrier) => {
    render(<ParcelDetail
      parcel={{ id: 'amazon-parcel', carrier, trackingNumber: 'FR3000000001', label: 'Books',
        createdAt: '2026-09-10T12:00:00Z', syncStatus: 'error', syncError: 'Old provider failure',
        trackingProvider: 'ParcelsApp', events: [] }}
      onBack={vi.fn()} onRename={vi.fn()} onChangeCarrier={vi.fn()} onSetNotificationsMuted={vi.fn()}
      onRefresh={vi.fn()} onRestore={vi.fn()} onArchive={vi.fn()} onDelete={vi.fn()}
    />);
    expect(screen.getByRole('note')).toHaveTextContent('Amazon Logistics deliveries are usually tracked in Your Orders on Amazon');
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://www.amazon.fr/gp/your-account/order-history');
    expect(screen.queryByText('ParcelsApp')).not.toBeInTheDocument();
  });
});
