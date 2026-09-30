import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddParcelSheet } from './AddParcelSheet';
import { lookupCarrier } from '../lib/carrierDetection';
import { carrierPicker, pickCarrier } from '../test/carrierPicker';

vi.mock('../lib/carrierDetection', () => ({ lookupCarrier: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const apiAuth = { userId: 'test-user', getAccessToken: async () => 'test-token' };
/** The quiet line under the number that names the carrier and opens the picker. */
const carrierLine = (name: RegExp) => screen.getByRole('button', { name });

describe('automatic unknown-carrier lookup', () => {
  it('files a printed PostLogistics reference under its carrier', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddParcelSheet onAdd={onAdd} onClose={vi.fn()} initialTrackingInput="12345678-001" />);

    expect(screen.getByText('PostLogistics')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^add parcel$/i }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      trackingNumber: '12345678-001', carrier: 'postlogistics',
    }));
  });

  it.each(['12345678901234'])('saves %s without requiring a guessed carrier', async (number) => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddParcelSheet onAdd={onAdd} onClose={vi.fn()} initialTrackingInput={number} />);
    const button = screen.getByRole('button', { name: /^add parcel$/i });
    expect(button).toBeEnabled();
    // Without an account nothing is asked: automatic detection is simply the default.
    expect(carrierLine(/^Detect automatically Change$/)).toBeInTheDocument();
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
    const postcode = await screen.findByRole('textbox', { name: /^Delivery postcode/ });
    expect(carrierLine(/^GLS Germany has this parcel/)).toBeInTheDocument();
    expect(button).toBeDisabled();
    await user.type(postcode, '8000');
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'gls-de', dpdPostcode: '8000' }));
  });

  it('keeps the manual selection when an earlier lookup finishes', async () => {
    let finish!: (value: { trackingNumber: string; carrier: 'gls-de' }) => void;
    vi.mocked(lookupCarrier).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={onAdd} onClose={vi.fn()} initialTrackingInput="123456789018" />);
    await waitFor(() => expect(lookupCarrier).toHaveBeenCalledOnce());
    await pickCarrier(user, carrierLine(/^Detect automatically/), 'UPS');
    finish({ trackingNumber: '123456789018', carrier: 'gls-de' });
    expect(await screen.findByText('GLS Germany knows this number.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^add parcel$/i }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'ups' }));
  });

  it('allows the usual unknown-carrier flow when the lookup is unavailable', async () => {
    vi.mocked(lookupCarrier).mockRejectedValue(new Error('Unavailable'));
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={vi.fn()} onClose={vi.fn()} initialTrackingInput="123456789018" />);
    expect(await screen.findByText('couldn’t check · we’ll retry after you add it')).toBeInTheDocument();
    expect(carrierLine(/^Detect automatically/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^add parcel$/i })).toBeEnabled();
  });
});

describe('DPD carrier lookup', () => {
  it('asks the server about a 14-digit number and keeps the DPD postcode optional', async () => {
    vi.mocked(lookupCarrier).mockResolvedValue({ trackingNumber: '06080000000002', carrier: 'dpd' });
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={onAdd} onClose={vi.fn()} initialTrackingInput="0608 0000 0000 02" />);
    await waitFor(() => expect(lookupCarrier).toHaveBeenCalledWith('06080000000002', apiAuth, expect.anything()));
    await screen.findByRole('textbox', { name: /^Delivery postcode/ });
    expect(screen.getByText('DPD')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /^add parcel$/i });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'dpd', dpdPostcode: '' }));
  });

  it('asks once the number is settled, never on each keystroke', async () => {
    vi.mocked(lookupCarrier).mockResolvedValue({ trackingNumber: '06080000000002', carrier: 'dpd' });
    const user = userEvent.setup();
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: /tracking number/i });
    await user.type(input, '06080000000002');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(lookupCarrier).not.toHaveBeenCalled();
    // Leaving the field settles the number.
    await user.tab();
    await waitFor(() => expect(lookupCarrier).toHaveBeenCalledOnce());
    expect(lookupCarrier).toHaveBeenCalledWith('06080000000002', apiAuth, expect.anything());
    expect(await screen.findByRole('button', { name: /^DPD has this parcel/ })).toBeInTheDocument();
  });

  it('saves instead of asking when the field is left for the Add button', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={onAdd} onClose={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: /tracking number/i }), '06080000000002');
    await user.click(screen.getByRole('button', { name: /^add parcel$/i }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'unknown' }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(lookupCarrier).not.toHaveBeenCalled();
  });

  it('never holds the Add button while carriers are asked', async () => {
    vi.mocked(lookupCarrier).mockReturnValue(new Promise(() => undefined));
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={onAdd} onClose={vi.fn()} initialTrackingInput="06080000000002" />);
    // The line names the carriers being asked while they answer.
    expect(await screen.findByText('asking DPD, SEUR, BRT and Ciblex…')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /^add parcel$/i });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'unknown' }));
  });

  it('asks the user to choose when several carriers know the number', async () => {
    vi.mocked(lookupCarrier).mockResolvedValue({ trackingNumber: '12345678901231', carrier: 'unknown', recognized: ['dpd', 'hermes-de'], asked: ['dpd', 'hermes-de'] });
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={onAdd} onClose={vi.fn()} initialTrackingInput="12345678901231" />);
    await user.click(await screen.findByRole('button', { name: 'Detect automatically DPD and Hermes Germany know it Choose' }));
    const known = within(carrierPicker()).getByRole('group', { name: 'Know this number' });
    expect(within(known).getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringMatching(/^DPD.*Knows this number$/),
      expect.stringMatching(/^Hermes Germany.*Knows this number$/),
    ]);
    // Automatic detection is still offered, but no longer recommended.
    expect(within(carrierPicker()).getByRole('option', { name: /^Detect automatically/ })).not.toHaveTextContent('Recommended');
    await user.click(within(known).getByRole('option', { name: 'Hermes Germany' }));
    await user.click(screen.getByRole('button', { name: /^add parcel$/i }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'hermes-de' }));
  });

  it('points out the carrier that knows a number filed under a forwarder, without blocking it', async () => {
    vi.mocked(lookupCarrier).mockResolvedValue({ trackingNumber: '06080000000002', carrier: 'dpd' });
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={onAdd} onClose={vi.fn()} initialTrackingInput="06080000000002" />);
    await pickCarrier(user, carrierLine(/^(Detect automatically|DPD)/), 'Asendia');
    expect(await screen.findByText('DPD knows this number.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^add parcel$/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Use DPD' }));
    await user.click(screen.getByRole('button', { name: /^add parcel$/i }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'dpd' }));
  });

  it('keeps a carrier picked while the check runs, and names the one that has the parcel', async () => {
    let finish!: (value: Awaited<ReturnType<typeof lookupCarrier>>) => void;
    vi.mocked(lookupCarrier).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={onAdd} onClose={vi.fn()} initialTrackingInput="06080000000002" />);
    await waitFor(() => expect(lookupCarrier).toHaveBeenCalledOnce());
    await pickCarrier(user, carrierLine(/^Detect automatically/), 'SEUR');
    finish({ trackingNumber: '06080000000002', carrier: 'dpd', asked: ['dpd', 'ciblex'] });
    expect(await screen.findByText('DPD knows this number.')).toBeInTheDocument();
    expect(carrierLine(/^SEUR Chosen by you/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^add parcel$/i }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'seur' }));
  });

  it('keeps automatic detection when no carrier knows the number yet', async () => {
    vi.mocked(lookupCarrier).mockResolvedValue({ trackingNumber: '06080000000002', carrier: 'unknown', asked: ['dpd', 'ciblex'] });
    const user = userEvent.setup();
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={vi.fn()} onClose={vi.fn()} initialTrackingInput="06080000000002" />);
    expect(await screen.findByText('not found yet · we’ll keep checking')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^add parcel$/i })).toBeEnabled();
    await user.click(carrierLine(/^Detect automatically/));
    const auto = within(carrierPicker()).getByRole('option', { name: /^Detect automatically/ });
    expect(auto).toHaveAttribute('aria-selected', 'true');
    expect(auto).toHaveTextContent('Recommended Not found at DPD and Ciblex yet. We’ll keep checking after you add it.');
  });

  it('tells a carrier that could not answer from one that said no', async () => {
    vi.mocked(lookupCarrier).mockResolvedValue({ trackingNumber: '06080000000002', carrier: 'unknown', asked: ['dpd', 'ciblex'], unanswered: ['dpd', 'ciblex'] });
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={vi.fn()} onClose={vi.fn()} initialTrackingInput="06080000000002" />);
    expect(await screen.findByText('couldn’t check · we’ll retry after you add it')).toBeInTheDocument();
  });

  it('says a number no carrier can be asked about is looked up after saving', () => {
    render(<AddParcelSheet apiAuth={apiAuth} onAdd={vi.fn()} onClose={vi.fn()} initialTrackingInput="12345678" />);
    expect(carrierLine(/^Detect automatically we’ll look it up after you add it/)).toBeInTheDocument();
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
    expect(screen.queryByText(/Checking for public Amazon Shipping tracking/)).not.toBeInTheDocument();
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
