import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddParcelSheet } from './AddParcelSheet';
import { lookupCarrier } from '../lib/carrierDetection';

vi.mock('../lib/carrierDetection', () => ({ lookupCarrier: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const apiAuth = { userId: 'test-user', getAccessToken: async () => 'test-token' };

describe('automatic unknown-carrier lookup', () => {
  it.each(['12345678901234'])('saves %s without requiring a guessed carrier', async (number) => {
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

  it('detects the YunExpress YT family directly instead of leaving it unknown', async () => {
    // REPORTED REAL cross-border shipment; YunExpress is now a universal-fallback carrier.
    // Source: https://www.reddit.com/r/AirReps/comments/1vfhh53/please_help_yunexpress_alibaba_tracking_stuck_on/
    const number = 'YT2621200705470145';
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddParcelSheet onAdd={onAdd} onClose={vi.fn()} initialTrackingInput={number} />);
    const button = screen.getByRole('button', { name: /^add parcel$/i });
    expect(button).toBeEnabled();
    expect(screen.getByText('YunExpress')).toBeInTheDocument();
    await user.click(button);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ trackingNumber: number, carrier: 'yunexpress' }));
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

describe('Amazon Logistics account-only tracking', () => {
  it.each(['FR3000000001', 'fr 3000-000001', 'Your parcel: FR3000000001', 'https://track.amazon.fr/tracking/FR3000000001'])(
    'explains account tracking and refuses %s', async (number) => {
      const onAdd = vi.fn();
      const user = userEvent.setup();
      render(<AddParcelSheet onAdd={onAdd} onClose={vi.fn()} initialTrackingInput={number} />);
      expect(screen.getByText('Amazon Logistics')).toBeInTheDocument();
      expect(screen.getByText(/Amazon Logistics deliveries are usually tracked in Your Orders on Amazon/)).toBeInTheDocument();
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

describe('public Amazon Shipping discovery', () => {
  it.each(['available', 'expired'] as const)('enables addition only after a matching %s result', async (amazonShippingStatus) => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    vi.mocked(lookupCarrier).mockResolvedValue({ trackingNumber: 'UK0000000001', carrier: 'amazon-shipping', amazonShippingStatus });
    const user = userEvent.setup();
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={onAdd} onClose={vi.fn()} initialTrackingInput="uk 0000-000001" />);
    const button = screen.getByRole('button', { name: /^add parcel$/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Amazon Logistics deliveries are usually tracked/)).toBeInTheDocument();
    expect(screen.getByText(/Checking for public Amazon Shipping tracking/)).toBeInTheDocument();
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByText('Amazon Shipping')).toBeInTheDocument();
    expect(screen.queryByText(/Amazon Logistics deliveries are usually tracked/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open my Amazon orders' })).not.toBeInTheDocument();
    expect(screen.getByText(amazonShippingStatus === 'available' ? /Public tracking is available/ : /Amazon no longer provides its tracking history/)).toBeInTheDocument();
    await user.click(button);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'amazon-shipping' }));
  });

  it('keeps retail parcels blocked after a negative response', async () => {
    vi.mocked(lookupCarrier).mockResolvedValue({ trackingNumber: 'DE0000000001', carrier: 'amazon-logistics', amazonShippingStatus: 'not-found' });
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={vi.fn()} onClose={vi.fn()} initialTrackingInput="DE0000000001" />);
    await waitFor(() => expect(lookupCarrier).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByText(/Checking for public/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^add parcel$/i })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Open my Amazon orders' })).toHaveAttribute('href', 'https://www.amazon.de/gp/your-account/order-history');
  });

  it('lets the user retry an unavailable check without enabling addition', async () => {
    vi.mocked(lookupCarrier).mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({
      trackingNumber: 'TBA000000000001', carrier: 'amazon-shipping', amazonShippingStatus: 'available',
    });
    const user = userEvent.setup();
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={vi.fn()} onClose={vi.fn()} initialTrackingInput="TBA000000000001" />);
    await user.click(await screen.findByRole('button', { name: 'Check again' }));
    expect(screen.getByRole('button', { name: /^add parcel$/i })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: /^add parcel$/i })).toBeEnabled());
  });

  it('ignores stale confirmation when the user changes the number', async () => {
    let finish!: (value: Awaited<ReturnType<typeof lookupCarrier>>) => void;
    vi.mocked(lookupCarrier).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue({
      trackingNumber: 'BE0000000001', carrier: 'amazon-logistics', amazonShippingStatus: 'not-found',
    });
    const user = userEvent.setup();
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={vi.fn()} onClose={vi.fn()} initialTrackingInput="FR0000000001" />);
    await waitFor(() => expect(lookupCarrier).toHaveBeenCalledOnce());
    const input = screen.getByRole('textbox', { name: /tracking number/i });
    await user.clear(input); await user.type(input, 'BE0000000001');
    finish({ trackingNumber: 'FR0000000001', carrier: 'amazon-shipping', amazonShippingStatus: 'available' });
    await waitFor(() => expect(lookupCarrier).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: /^add parcel$/i })).toBeDisabled();
    expect(screen.getByText('Amazon Logistics')).toBeInTheDocument();
  });
});
