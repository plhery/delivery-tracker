import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ParcelsProvider, useParcels } from './ParcelsContext';
import type { ParcelRepo, ParcelWithEvents } from '../types';

function Collection({ refreshId }: { refreshId: string }) {
  const { parcels, refreshParcel } = useParcels();
  return <><button onClick={() => void refreshParcel(refreshId)}>Refresh</button>
    <ul>{parcels.map((parcel) => <li key={parcel.id}>{parcel.label}</li>)}</ul></>;
}

describe('automatic parcel merge', () => {
  it.each(['origin', 'delivery'])('replaces both entries after refreshing %s', async (refreshId) => {
    const origin: ParcelWithEvents = {
      id: 'origin', label: 'GLS', carrier: 'gls-de', trackingNumber: '123456789011',
      createdAt: '2026-09-01', syncStatus: 'ok', events: [],
    };
    const delivery: ParcelWithEvents = { ...origin, id: 'delivery', label: 'Post', carrier: 'swiss-post' };
    const merged = { ...delivery, label: 'GLS / Post', originalParcelId: origin.id };
    const repo: ParcelRepo = {
      mode: 'api', list: vi.fn().mockResolvedValue([origin, delivery]), add: vi.fn(), rename: vi.fn(),
      remove: vi.fn(), refresh: vi.fn(), refreshParcel: vi.fn().mockResolvedValue(merged),
    };
    render(<ParcelsProvider repo={repo}><Collection refreshId={refreshId} /></ParcelsProvider>);
    await screen.findByText('GLS');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByText('GLS / Post')).toBeVisible();
  });
});
