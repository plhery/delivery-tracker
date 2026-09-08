import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddParcelSheet } from './AddParcelSheet';

describe('automatic unknown-carrier lookup', () => {
  it.each(['12345678901234', 'YT2621200705470145'])('saves %s without requiring a guessed carrier', async (number) => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddParcelSheet onAdd={onAdd} onClose={vi.fn()} initialTrackingInput={number} />);
    const button = screen.getByRole('button', { name: /^add parcel$/i });
    expect(button).toBeEnabled();
    expect(screen.queryByRole('option', { name: '17TRACK' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'ParcelsApp' })).not.toBeInTheDocument();
    await user.click(button);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ trackingNumber: number, carrier: 'unknown' }));
  });
});
