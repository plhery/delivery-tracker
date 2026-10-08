import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    expect(container.querySelector('.tracking-journal__location')).toHaveTextContent(/^🇩🇪Germany$/u);
    expect(screen.getByText('08:42')).toHaveAttribute('dateTime', '2024-09-09T08:42:00');
  });

  it('leads each place with its flag and closes it with the country’s name', () => {
    const { container } = render(<TrackingJournal events={[
      event('city', '2024-09-09T10:00:00', 'With courier', 'ZUERICH, CH'),
      event('country', '2024-09-09T09:00:00', 'Departed', 'FR'),
      event('leading', '2024-09-09T08:00:00', 'Handed over', 'Germany Bielefeld'),
      event('origin', '2024-09-09T07:30:00', 'Collected', 'Shenzhen, China'),
      event('facility', '2024-09-09T07:00:00', 'Sorted', 'Zürich Briefzentrum'),
    ]} />);
    const places = [...container.querySelectorAll('.tracking-journal__location')];
    expect(places.map(place => place.textContent)).toEqual([
      '🇨🇭ZUERICH, Switzerland', '🇫🇷France', '🇩🇪Bielefeld, Germany', '🇨🇳Shenzhen, China', 'Zürich Briefzentrum',
    ]);
    const flag = places[0].firstElementChild!;
    expect(flag).toHaveClass('tracking-journal__flag');
    expect(flag).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows an earlier carrier\'s relay copy as a line under the scan it repeats, keeping its words', () => {
    const { container } = render(<TrackingJournal events={[
      event('arrived', '2024-09-09T14:16:51', 'Arrival in destination country'),
      { ...event('copy', '2024-09-09T14:16:00', 'The shipment has arrived in the destination country'), relayOf: 'arrived' },
      // A scan of its own taken for a copy is still there to read.
      event('sorted', '2024-09-09T15:40:38', 'Sorted'),
      { ...event('loaded', '2024-09-09T15:40:00', 'Loaded onto a vehicle'), relayOf: 'sorted' },
      // Told after the scan in the same words: nothing more to show, and the scan stays the current step.
      { ...event('delivered', '2024-09-09T18:00:00', 'Delivered'), stage: 'delivered' },
      { ...event('delivered-copy', '2024-09-09T18:00:30', 'Delivered'), stage: 'delivered', relayOf: 'delivered' },
      // Without the scan it repeats, a copy keeps its row.
      { ...event('orphan', '2024-09-09T10:00:00', 'Handed over'), relayOf: 'not-served' },
    ]} />);
    expect(screen.getByText('4 updates')).toBeInTheDocument();
    const rows = [...container.querySelectorAll('.tracking-journal__events li')];
    expect(rows.map(row => [...row.querySelectorAll('p')].map(line => line.textContent))).toEqual([
      ['Delivered'], ['Sorted', 'Loaded onto a vehicle'], ['Arrival in destination country', 'The shipment has arrived in the destination country'], ['Handed over'],
    ]);
    expect([...container.querySelectorAll('.tracking-journal__relay')].map(line => line.textContent))
      .toEqual(['Loaded onto a vehicle', 'The shipment has arrived in the destination country']);
    expect(rows[0]).toHaveAttribute('aria-current', 'step');
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

  it('folds a long journey: the two newest days open, three more as one line each, the oldest behind a button', async () => {
    const day = (number: number, count: number) => Array.from({ length: count }, (_, index) =>
      event(`d${number}-${index}`, `2024-09-${String(number).padStart(2, '0')}T${String(8 + index).padStart(2, '0')}:00:00`, `Scan ${number}.${index}`));
    const events = [...day(9, 1), ...day(8, 2), ...day(7, 3), ...day(6, 4), ...day(5, 2), ...day(4, 2), ...day(3, 1)];
    const { container, rerender } = render(<TrackingJournal events={events} fold />);
    expect(screen.getByText('15 updates')).toBeInTheDocument();
    const folded = [...container.querySelectorAll<HTMLDetailsElement>('.tracking-journal__day')];
    expect(folded.map((entry) => entry.querySelector('summary')!.textContent)).toEqual(['Sat 7 sep 20243 updates', 'Fri 6 sep 20244 updates', 'Thu 5 sep 20242 updates']);
    expect(folded.every((entry) => !entry.open)).toBe(true);
    // The open days show their scans; the oldest are not in the page yet.
    expect(screen.getByText('Scan 9.0')).toBeVisible();
    expect(screen.getByText('Scan 8.1')).toBeVisible();
    expect(screen.queryByText('Scan 4.0')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(folded[0].querySelector('summary')!);
    expect(folded[0].open).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Show the 3 oldest updates' }));
    expect(screen.getByText('Scan 4.0')).toBeVisible();
    expect(screen.getByText('Scan 3.0')).toBeVisible();
    expect(screen.queryByRole('button', { name: /oldest/ })).not.toBeInTheDocument();
    // A short journey, and a journal that is not asked to fold, show everything.
    rerender(<TrackingJournal events={events.slice(0, 12)} fold />);
    expect(container.querySelector('.tracking-journal__day')).toBeNull();
    rerender(<TrackingJournal events={events} />);
    expect(container.querySelector('.tracking-journal__day')).toBeNull();
    expect(screen.getByText('Scan 3.0')).toBeVisible();
  });
});
