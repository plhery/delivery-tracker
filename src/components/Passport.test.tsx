import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Passport } from './Passport';
import type { ParcelWithEvents } from '../types';

describe('Passport journal', () => {
  it('keeps stamps available without inventing timing or country records for a new passport', () => {
    const { container } = render(<Passport parcels={[]} loading={false} />);
    expect(container.querySelector('.passport-cover__count')).toHaveTextContent('0');
    expect(container.querySelectorAll('.stamp-card')).toHaveLength(3);
    expect(container.querySelectorAll('.time-card, .country-row')).toHaveLength(0);
    expect(container.querySelector('.passport-note')).toBeVisible();
    expect(container.textContent).not.toContain('—');
    expect(screen.getByRole('button', { name: 'Double digits, 0 / 10' })).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('reveals all twelve stamps on request and keeps Century club out of the collection', () => {
    const { container } = render(<Passport parcels={[]} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'All stamps' }));
    expect(container.querySelectorAll('.stamp-card')).toHaveLength(12);
    for (const name of ['Across borders', 'Around the world', 'The regular', 'Right next door', 'Worth the wait', 'A busy doorstep', 'Picked up', 'Home for the holidays']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name},`) })).toBeVisible();
    }
    expect(container.textContent).not.toContain('Century club');
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(container.querySelectorAll('.stamp-card')).toHaveLength(3);
  });

  it('earns The regular at 25 deliveries, including archived arrivals', () => {
    const parcels: ParcelWithEvents[] = Array.from({ length: 25 }, (_, index) => ({
      id: String(index), label: 'Parcel', carrier: 'dhl', trackingNumber: String(index), syncStatus: 'ok',
      createdAt: '2026-09-01T00:00:00Z', archivedAt: '2026-09-04T00:00:00Z',
      events: [{ id: `event-${index}`, parcelId: String(index), stage: 'delivered', occurredAt: '2026-09-03T12:00:00Z', description: 'Delivered' }],
    }));
    const { rerender } = render(<Passport parcels={parcels.slice(0, 24)} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'All stamps' }));
    expect(screen.getByRole('button', { name: 'The regular, 24 / 25' })).not.toHaveClass('stamp-card--earned');
    rerender(<Passport parcels={parcels} loading={false} />);
    expect(screen.getByRole('button', { name: 'The regular' })).toHaveClass('stamp-card--earned');
  });

  it('counts an archived arrival with partial history without presenting a made-up duration', () => {
    const parcel: ParcelWithEvents = {
      id: 'archived', label: 'Books', carrier: 'dhl', trackingNumber: '1234567890', syncStatus: 'ok',
      createdAt: '2026-09-01T00:00:00Z', archivedAt: '2026-09-04T00:00:00Z',
      events: [{ id: 'arrival', parcelId: 'archived', stage: 'delivered', occurredAt: '2026-09-03T12:00:00Z', description: 'Delivered' }],
    };
    const { container } = render(<Passport parcels={[parcel]} loading={false} />);
    expect(container.querySelector('.passport-cover__count')).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'First arrival' })).toBeVisible();
    expect(container.querySelectorAll('.time-card, .country-row')).toHaveLength(0);
  });
});
