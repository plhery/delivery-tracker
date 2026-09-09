import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Passport } from './Passport';
import type { ParcelWithEvents } from '../types';

describe('Passport journal', () => {
  it('keeps stamps available without inventing timing or country records for a new passport', () => {
    const { container } = render(<Passport parcels={[]} loading={false} />);
    expect(container.querySelector('.passport-cover__count')).toHaveTextContent('0');
    expect(container.querySelectorAll('.stamp-card')).toHaveLength(4);
    expect(container.querySelectorAll('.time-card, .country-row')).toHaveLength(0);
    expect(container.querySelector('.passport-note')).toBeVisible();
    expect(container.textContent).not.toContain('—');
    expect(screen.getByRole('button', { name: 'Double digits, 0 / 10' })).toHaveAttribute('aria-haspopup', 'dialog');
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
