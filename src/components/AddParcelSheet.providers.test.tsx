import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddParcelSheet } from './AddParcelSheet';
import { lookupCarrier } from '../lib/carrierDetection';

vi.mock('../lib/carrierDetection', () => ({ lookupCarrier: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const apiAuth = { userId: 'test-user', getAccessToken: async () => 'test-token' };

describe('automatic unknown-carrier lookup', () => {
  it.each(['12345678901234', 'YT2621200705470145'])('saves %s without requiring a guessed carrier', async (number) => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddParcelSheet onAdd={onAdd} onClose={vi.fn()} initialTrackingInput={number} />);
    const button = screen.getByRole('button', { name: /^add parcel$/i });
    expect(button).toBeEnabled();
    expect(screen.getByText('Unknown carrier')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '17TRACK' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'ParcelsApp' })).not.toBeInTheDocument();
    await user.click(button);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ trackingNumber: number, carrier: 'unknown' }));
  });
});

describe('GLS carrier lookup', () => {
  it('detects the carrier, requires a postcode, and saves a Swiss postcode unchanged', async () => {
    vi.mocked(lookupCarrier).mockResolvedValue({ trackingNumber: '123456789018', carrier: 'gls-de' });
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={onAdd} onClose={vi.fn()} initialTrackingInput="123456789018" />);
    const button = screen.getByRole('button', { name: /^add parcel$/i });
    expect(button).toBeDisabled();
    const postcode = await screen.findByRole('textbox', { name: /^Delivery postcode/ });
    expect(screen.getByText('GLS Germany')).toBeInTheDocument();
    expect(button).toBeDisabled();
    await user.type(postcode, '8004');
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'gls-de', dpdPostcode: '8004' }));
  });

  it('keeps the manual selection when an earlier lookup finishes', async () => {
    let finish!: (value: { trackingNumber: string; carrier: 'gls-de' }) => void;
    vi.mocked(lookupCarrier).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={onAdd} onClose={vi.fn()} initialTrackingInput="123456789018" />);
    await waitFor(() => expect(lookupCarrier).toHaveBeenCalledOnce());
    await user.selectOptions(screen.getByRole('combobox'), 'ups');
    finish({ trackingNumber: '123456789018', carrier: 'gls-de' });
    await user.click(screen.getByRole('button', { name: /^add parcel$/i }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'ups' }));
  });

  it('allows the usual unknown-carrier flow when the lookup is unavailable', async () => {
    vi.mocked(lookupCarrier).mockRejectedValue(new Error('Unavailable'));
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={vi.fn()} onClose={vi.fn()} initialTrackingInput="123456789018" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^add parcel$/i })).toBeEnabled());
    expect(screen.getByText('Unknown carrier')).toBeInTheDocument();
  });
});

describe('Amazon France account-only tracking', () => {
  it.each(['FR3000000001', 'fr 3000-000001', 'Your parcel: FR3000000001', 'https://track.amazon.fr/tracking/FR3000000001'])(
    'explains account tracking and refuses %s', async (number) => {
      const onAdd = vi.fn();
      const user = userEvent.setup();
      render(<AddParcelSheet apiAuth={apiAuth} onAdd={onAdd} onClose={vi.fn()} initialTrackingInput={number} />);
      expect(screen.getByText('Amazon France')).toBeInTheDocument();
      expect(screen.getByText(/Amazon France keeps delivery updates in your Amazon account/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open my Amazon orders' }))
        .toHaveAttribute('href', 'https://www.amazon.fr/gp/your-account/order-history');
      const button = screen.getByRole('button', { name: /^add parcel$/i });
      expect(button).toBeDisabled();
      await user.click(button);
      expect(onAdd).not.toHaveBeenCalled();
      expect(lookupCarrier).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /change carrier/i })).not.toBeInTheDocument();
      const input = screen.getByRole('textbox', { name: /tracking number/i });
      await user.clear(input);
      await user.type(input, '1Z999AA10123456784');
      expect(button).toBeEnabled();
      expect(screen.queryByRole('link', { name: 'Open my Amazon orders' })).not.toBeInTheDocument();
    },
  );
});
