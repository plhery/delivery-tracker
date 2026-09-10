import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ParcelDetail } from './ParcelDetail';

describe('existing Amazon France parcels', () => {
  it.each(['amazon-logistics', 'unknown'] as const)('explains account tracking for a saved %s parcel', (carrier) => {
    render(<ParcelDetail
      parcel={{ id: 'amazon-parcel', carrier, trackingNumber: 'FR3000000001', label: 'Books',
        createdAt: '2026-09-10T12:00:00Z', syncStatus: 'error', syncError: 'Old provider failure',
        trackingProvider: 'ParcelsApp', events: [] }}
      onBack={vi.fn()} onRename={vi.fn()} onChangeCarrier={vi.fn()} onSetNotificationsMuted={vi.fn()}
      onRefresh={vi.fn()} onRestore={vi.fn()} onArchive={vi.fn()} onDelete={vi.fn()}
    />);
    expect(screen.getByRole('note')).toHaveTextContent('Amazon France keeps delivery updates in your Amazon account');
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://www.amazon.fr/gp/your-account/order-history');
    expect(screen.queryByText('ParcelsApp')).not.toBeInTheDocument();
  });
});
