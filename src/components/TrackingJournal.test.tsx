import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrackingJournal } from './TrackingJournal';
import type { TrackingEvent } from '../types';

function event(id: string, occurredAt: string, description: string, location?: string): TrackingEvent {
  return { id, parcelId: 'parcel', stage: 'in_transit', occurredAt, description, location };
}

describe('TrackingJournal', () => {
  it('keeps all scans in newest-first calendar-day groups, including older years', () => {
    const { container } = render(<TrackingJournal events={[
      event('first', '2024-09-07T10:00:00', 'Collected', 'Germany'),
      event('third', '2024-09-08T22:15:00', 'Departed sorting center'),
      event('second', '2024-09-08T06:20:00', 'Arrived at sorting center'),
      event('fourth', '2024-09-09T08:42:00', 'With courier'),
    ]} />);
    expect(container.querySelector('details')).toHaveAttribute('open');
    expect(screen.getByText('4 updates')).toBeInTheDocument();
    const groups = within(screen.getByRole('list', { name: 'Tracking history' })).getAllByRole('heading');
    expect(groups.map(group => group.textContent)).toEqual(['Mon 9 sep 2024', 'Sun 8 sep 2024', 'Sat 7 sep 2024']);
    expect([...container.querySelectorAll('.tracking-journal__events p')].map(el => el.textContent))
      .toEqual(['With courier', 'Departed sorting center', 'Arrived at sorting center', 'Collected']);
    expect(screen.getByLabelText('Germany')).toHaveTextContent('🇩🇪');
    expect(screen.getByText('08:42')).toHaveAttribute('dateTime', '2024-09-09T08:42:00');
  });

  it('handles missing descriptions, invalid scan times and empty syncing history', () => {
    const { rerender } = render(<TrackingJournal events={[event('invalid', 'Unknown date', '')]} />);
    expect(screen.getByText('Unknown date')).toBeInTheDocument();
    expect(screen.getByText('In transit')).toBeInTheDocument();
    expect(screen.getByText('1 update')).toBeInTheDocument();
    rerender(<TrackingJournal events={[]} syncing />);
    expect(screen.getByText('0 updates')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText(/checking|first update|first tracking/i)).toBeInTheDocument();
  });
});
