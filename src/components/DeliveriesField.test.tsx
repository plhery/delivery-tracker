import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupCarrier } from '../lib/carrierDetection';
import { ASK_PATIENCE_MS } from '../peek/lookup/useLookup';
import { ParcelAlreadyExistsError, type NewParcelInput, type ParcelWithEvents } from '../types';
import { DeliveriesField } from './DeliveriesField';

vi.mock('../lib/carrierDetection', () => ({ lookupCarrier: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

const apiAuth = { userId: 'test-user', getAccessToken: async () => 'test-token' };
const parcel = (id: string, trackingNumber: string, carrier: ParcelWithEvents['carrier'] = 'ups'): ParcelWithEvents => ({
  id, trackingNumber, carrier, label: '', createdAt: '2026-10-01T08:00:00.000Z', syncStatus: 'ok', events: [],
});
const followed = [parcel('vinyl', '1ZDEMO202600000001')];

/** Where the field says what it is doing, and what went wrong. */
const said = () => document.querySelector<HTMLElement>('.deliveries-field__feedback')!;

function renderField(props: Partial<Parameters<typeof DeliveriesField>[0]> = {}) {
  const calls = {
    onAdd: vi.fn(async (input: NewParcelInput) => parcel('new', input.trackingNumber, input.carrier)),
    onAdded: vi.fn(),
    onFinishInSheet: vi.fn(),
    onOpenExisting: vi.fn(),
  };
  render(<DeliveriesField parcels={followed} {...calls} {...props} />);
  return { ...calls, ...props, field: screen.getByRole('textbox', { name: 'Track a parcel' }) as HTMLInputElement };
}

/** Stands in for the browser's clipboard; set after user-event has put its own in place. */
function clipboard(read: () => Promise<string>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: vi.fn(read) } });
}

describe('the field on top of the deliveries', () => {
  it('waits for Enter while typing, then adds the parcel and stays ready for the next', async () => {
    const user = userEvent.setup();
    const { field, onAdd, onAdded } = renderField();
    expect(field).toHaveAttribute('placeholder', 'Paste a number, link, or message');
    await user.type(field, '1ZDEMO202600000009');
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Track' })).toBeEnabled();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ id: 'new' })));
    expect(onAdd).toHaveBeenCalledWith({ trackingNumber: '1ZDEMO202600000009', label: '', carrier: 'ups' });
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
  });

  it('adds at once what is pasted into it, read as it was copied', async () => {
    const user = userEvent.setup();
    const { field, onAdd } = renderField();
    await user.click(field);
    await user.paste('Your order shipped.\nTrack 99.34.111111.22222222\nThanks!');
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ trackingNumber: '99.34.111111.22222222', label: '', carrier: 'swiss-post' }));
    await waitFor(() => expect(field).toHaveValue(''));
  });

  it('adds from the clipboard with the Paste button', async () => {
    const user = userEvent.setup();
    clipboard(async () => '1ZDEMO202600000009');
    const { field, onAdd, onAdded } = renderField();
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ trackingNumber: '1ZDEMO202600000009', carrier: 'ups' }));
    expect(field).toHaveFocus();
  });

  it('asks the carriers that share the number’s shape, says so, and adds with the one that has it', async () => {
    let answer: (value: Awaited<ReturnType<typeof lookupCarrier>>) => void = () => undefined;
    vi.mocked(lookupCarrier).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const user = userEvent.setup();
    const { field, onAdd } = renderField({ apiAuth });
    await user.type(field, '01234567890123{Enter}');
    expect(lookupCarrier).toHaveBeenCalledWith('01234567890123', apiAuth, expect.any(AbortSignal));
    const status = said();
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(/Finding the carrier asking DPD/);
    expect(field).toHaveAttribute('readonly');
    expect(onAdd).not.toHaveBeenCalled();

    await act(async () => { answer({ trackingNumber: '01234567890123', carrier: 'dpd', asked: ['dpd', 'seur'] }); });
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ trackingNumber: '01234567890123', label: '', carrier: 'dpd' }));
    await waitFor(() => expect(status).toBeEmptyDOMElement());
  });

  it('opens the Add sheet with the text when the carriers do not settle on one', async () => {
    vi.mocked(lookupCarrier).mockResolvedValue({ trackingNumber: '01234567890123', carrier: 'unknown', recognized: ['dpd', 'seur'], asked: ['dpd', 'seur'] });
    const user = userEvent.setup();
    const { field, onAdd, onFinishInSheet } = renderField({ apiAuth });
    await user.type(field, '01234567890123{Enter}');
    await waitFor(() => expect(onFinishInSheet).toHaveBeenCalledWith('01234567890123'));
    expect(onAdd).not.toHaveBeenCalled();
    expect(field).toHaveValue('');
  });

  it('stops waiting for carriers that do not answer and lets the Add sheet take over', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(lookupCarrier).mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { field, onFinishInSheet } = renderField({ apiAuth });
    await user.type(field, '01234567890123{Enter}');
    expect(onFinishInSheet).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(ASK_PATIENCE_MS); });
    expect(onFinishInSheet).toHaveBeenCalledWith('01234567890123');
  });

  it('asks nobody without an account: a shared shape goes straight to the Add sheet', async () => {
    const user = userEvent.setup();
    const { field, onFinishInSheet } = renderField();
    await user.type(field, '01234567890123{Enter}');
    expect(onFinishInSheet).toHaveBeenCalledWith('01234567890123');
    expect(lookupCarrier).not.toHaveBeenCalled();
  });

  it('hands what it cannot settle to the Add sheet, with what was pasted', async () => {
    const user = userEvent.setup();
    const { field, onAdd, onFinishInSheet } = renderField();
    await user.click(field);
    const several = 'First: 1ZDEMO202600000008\nSecond: 1ZDEMO202600000009';
    await user.paste(several);
    expect(onFinishInSheet).toHaveBeenLastCalledWith(several);
    await user.paste('hello there');
    expect(onFinishInSheet).toHaveBeenLastCalledWith('hello there');
    await user.paste('TBA123456789012');
    expect(onFinishInSheet).toHaveBeenLastCalledWith('TBA123456789012');
    // Enter on the empty field opens the empty sheet.
    await user.keyboard('{Enter}');
    expect(onFinishInSheet).toHaveBeenLastCalledWith('');
    expect(onAdd).not.toHaveBeenCalled();
    expect(field).toHaveValue('');
  });

  it('opens a parcel the deliveries already hold instead of adding it twice', async () => {
    const user = userEvent.setup();
    const { field, onAdd, onOpenExisting } = renderField();
    await user.type(field, '1ZDEMO202600000001{Enter}');
    expect(onOpenExisting).toHaveBeenCalledWith('vinyl');
    expect(onAdd).not.toHaveBeenCalled();
    expect(field).toHaveValue('');
  });

  it('opens the parcel the service says it already has', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn().mockRejectedValue(new ParcelAlreadyExistsError('Already tracked', 'archived-one'));
    const { field, onOpenExisting, onAdded } = renderField({ onAdd });
    await user.type(field, '1ZDEMO202600000009{Enter}');
    await waitFor(() => expect(onOpenExisting).toHaveBeenCalledWith('archived-one'));
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('keeps the text when adding fails, says why, and tries again on Enter', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async (input: NewParcelInput) => parcel('new', input.trackingNumber, input.carrier));
    const { field, onAdded } = renderField({ onAdd });
    await user.type(field, '1ZDEMO202600000009{Enter}');
    const note = await screen.findByText('Check your internet connection and try again.');
    expect(said()).toContainElement(note);
    expect(field).toHaveValue('1ZDEMO202600000009');
    expect(field).toHaveAccessibleDescription('Check your internet connection and try again.');
    expect(field).toHaveFocus();
    expect(onAdded).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(said()).toBeEmptyDOMElement();
    expect(field).toHaveValue('');
  });

  it('explains a clipboard it may not read, and drops the note once the person types', async () => {
    const user = userEvent.setup();
    clipboard(async () => { throw new DOMException('Read permission denied', 'NotAllowedError'); });
    const { field, onFinishInSheet } = renderField();
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(await screen.findByText(/didn’t let Peek read the clipboard\. Click the field and paste there\./)).toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(onFinishInSheet).not.toHaveBeenCalled();
    await user.type(field, '1');
    expect(said()).toBeEmptyDOMElement();
  });

  it('says when the clipboard is empty', async () => {
    const user = userEvent.setup();
    clipboard(async () => '  ');
    const { onFinishInSheet } = renderField();
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(await screen.findByText(/The clipboard is empty/)).toBeInTheDocument();
    expect(onFinishInSheet).not.toHaveBeenCalled();
  });
});
