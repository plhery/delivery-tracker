import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddParcelSheet } from './AddParcelSheet';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function renderSheet() {
  render(<AddParcelSheet onAdd={vi.fn()} onClose={vi.fn()} />);
  return screen.getByRole('textbox', { name: /^Tracking number or link/ });
}

const notFound = /couldn’t find a tracking number/i;

describe('Add parcel feedback while typing', () => {
  it('waits for a pause before saying that typed text has no tracking number', () => {
    const tracking = renderSheet();

    fireEvent.change(tracking, { target: { value: 'LP' } });
    expect(screen.queryByText(notFound)).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByText(notFound)).toBeInTheDocument();

    fireEvent.change(tracking, { target: { value: 'LP-' } });
    expect(screen.getByText(notFound)).toBeInTheDocument();

    fireEvent.change(tracking, { target: { value: 'LP12' } });
    expect(screen.queryByText(notFound)).not.toBeInTheDocument();
  });

  it('answers a paste at once', () => {
    const tracking = renderSheet();

    fireEvent.paste(tracking);
    fireEvent.change(tracking, { target: { value: 'Thanks for your order!' } });

    expect(screen.getByText(notFound)).toBeInTheDocument();
  });

  it('offers the carrier picker for an unrecognized number once typing pauses', () => {
    const tracking = renderSheet();

    fireEvent.change(tracking, { target: { value: 'ZZ1234' } });
    expect(screen.getByText('Unknown carrier')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Carrier' })).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByRole('combobox', { name: 'Carrier' })).toBeInTheDocument();
  });
});
