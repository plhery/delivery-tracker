import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiParcelFeedbackRequest } from '../../generated/apiContract';
import { FeedbackOverlays, FeedbackQuestion, useParcelFeedback, type FeedbackSubject } from './Feedback';
import type { FeedbackMemory, FeedbackNotes } from './feedbackModel';

const mocks = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../lib/analytics', async (original) => ({ ...await original<typeof import('../../lib/analytics')>(), trackAction: mocks.track }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SCAN = '3:2026-10-08T09:00:00.000Z';
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function memoryNotes(initial: FeedbackMemory = {}): FeedbackNotes & { memory: FeedbackMemory } {
  const notes = { memory: initial, read: () => notes.memory, write(next: FeedbackMemory) { notes.memory = next; } };
  return notes;
}

function Page(subject: FeedbackSubject) {
  const feedback = useParcelFeedback(subject);
  return <>
    <button type="button" onClick={() => feedback.visited('UPS')}>Open the UPS website</button>
    <FeedbackQuestion feedback={feedback} />
    <FeedbackOverlays feedback={feedback} />
  </>;
}

function open(values: Partial<FeedbackSubject> = {}) {
  const send = vi.fn<(feedback: ApiParcelFeedbackRequest) => Promise<void>>(async () => undefined);
  const notes = memoryNotes();
  const subject: FeedbackSubject = { kind: 'found', scan: SCAN, carrier: 'UPS', notes, send, ...values };
  const view = render(<Page {...subject} />);
  return { send: vi.mocked(subject.send), notes: subject.notes as ReturnType<typeof memoryNotes>, subject, ...view };
}

/** The reader, having opened the carrier's page, is away for `away` milliseconds and comes back. */
function awayAndBack(away = 2_000) {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  const clock = vi.spyOn(Date, 'now');
  const left = Date.now();
  clock.mockReturnValue(left);
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  hidden.mockReturnValue(false);
  clock.mockReturnValue(left + away);
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  clock.mockRestore();
  hidden.mockRestore();
}
async function leaveAndReturn(user: ReturnType<typeof userEvent.setup>, away?: number) {
  await user.click(screen.getByRole('button', { name: 'Open the UPS website' }));
  awayAndBack(away);
}

const bubble = () => document.querySelector<HTMLElement>('.peekfb-bubble')!;
const row = () => document.querySelector<HTMLElement>('.peekfb-ask')!;

beforeEach(() => { mocks.track.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Pip’s question about a parcel a carrier answers for', () => {
  it('takes a yes in place, sends it without a word, and remembers the scan it was about', async () => {
    const user = userEvent.setup();
    const { send, notes } = open();
    expect(within(bubble()).getByText('Did I get this one right?')).toBeVisible();
    await user.click(within(bubble()).getByRole('button', { name: 'Yes' }));
    expect(within(bubble()).getByRole('status')).toHaveTextContent('Good to know, thanks!');
    expect(within(bubble()).queryByRole('button')).toBeNull();
    // The answer replaced the buttons: the focus stays on the question.
    expect(bubble()).toHaveFocus();
    expect(send).toHaveBeenCalledExactlyOnceWith({ id: expect.stringMatching(UUID), answer: 'right', asked: 'page', app: 'web', locale: 'en' });
    await waitFor(() => expect(notes.memory).toEqual({ at: expect.any(String), scan: SCAN }));
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith('parcel-feedback-right', 'success');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks what is off, sends the reason picked, and lets a note follow it under the same id', async () => {
    const user = userEvent.setup();
    const { send } = open();
    await user.click(within(bubble()).getByRole('button', { name: 'Not quite' }));
    expect(within(bubble()).getByText('What’s off?')).toBeVisible();
    expect(within(bubble()).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['It has arrived', 'Wrong status', 'Missing steps', 'Wrong time or place', 'Wrong carrier', 'Something else']);
    expect(send).not.toHaveBeenCalled();

    await user.click(within(bubble()).getByRole('button', { name: 'Missing steps' }));
    expect(within(bubble()).getByRole('status')).toHaveTextContent('Thanks! I’ll look into it.');
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ answer: 'wrong', reasons: ['steps'], asked: 'page' }));
    const id = send.mock.calls[0][0].id;
    await waitFor(() => expect(mocks.track).toHaveBeenCalledExactlyOnceWith('parcel-feedback-wrong', 'success'));

    await user.click(within(bubble()).getByRole('button', { name: 'Add a note' }));
    const sheet = screen.getByRole('dialog', { name: 'What’s off?' });
    expect(within(sheet).getByRole('button', { name: 'Missing steps' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByText('Sent with this parcel’s number and what UPS answered. Nothing about you.')).toBeVisible();
    await user.click(within(sheet).getByRole('button', { name: 'Wrong status' }));
    await user.type(within(sheet).getByLabelText('Anything to add? Optional'), '  Delivered on Monday.  ');
    await user.click(within(sheet).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(send).toHaveBeenLastCalledWith({ id, answer: 'wrong', reasons: ['steps', 'status'], note: 'Delivered on Monday.', asked: 'page', app: 'web', locale: 'en' });
    // The note was offered once; the same answer is counted once.
    await waitFor(() => expect(within(bubble()).queryByRole('button', { name: 'Add a note' })).toBeNull());
    expect(within(bubble()).getByRole('status')).toHaveTextContent('Thanks! I’ll look into it.');
    expect(mocks.track).toHaveBeenCalledTimes(1);
  });

  it('puts the question back and says so when an answer given in place could not be sent', async () => {
    const user = userEvent.setup();
    const { send, notes } = open({ send: vi.fn(async () => { throw new Error('offline'); }) });
    await user.click(within(bubble()).getByRole('button', { name: 'Yes' }));
    expect(await screen.findByText('Couldn’t send that. Try again.')).toBeVisible();
    expect(within(bubble()).getByRole('button', { name: 'Yes' })).toBeVisible();
    expect(notes.memory).toEqual({});
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith('parcel-feedback-right', 'error');

    await user.click(within(bubble()).getByRole('button', { name: 'Not quite' }));
    await user.click(within(bubble()).getByRole('button', { name: 'Wrong carrier' }));
    await waitFor(() => expect(within(bubble()).getByRole('button', { name: 'Wrong carrier' })).toBeVisible());
    expect(send).toHaveBeenCalledTimes(2);
    expect(notes.memory).toEqual({});
  });

  it('keeps the sheet open with what was written when its words could not be sent', async () => {
    const user = userEvent.setup();
    const send = vi.fn<(feedback: ApiParcelFeedbackRequest) => Promise<void>>(async () => undefined);
    open({ send });
    await user.click(within(bubble()).getByRole('button', { name: 'Not quite' }));
    await user.click(within(bubble()).getByRole('button', { name: 'Something else' }));
    await user.click(await within(bubble()).findByRole('button', { name: 'Add a note' }));
    const sheet = screen.getByRole('dialog', { name: 'What’s off?' });
    send.mockRejectedValueOnce(new Error('offline'));
    await user.type(within(sheet).getByLabelText('Anything to add? Optional'), 'A note');
    await user.click(within(sheet).getByRole('button', { name: 'Send' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Couldn’t send that. Try again.');
    expect(within(sheet).getByLabelText('Anything to add? Optional')).toHaveValue('A note');
    await user.click(within(sheet).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('stands on every visit, for a reader who has more to say about a scan already answered for', () => {
    open({ notes: memoryNotes({ at: hoursAgo(1), scan: SCAN }) });
    expect(within(bubble()).getByText('Did I get this one right?')).toBeVisible();
  });

  it('smiles once an answer is taken', async () => {
    const user = userEvent.setup();
    open();
    const pip = document.querySelector<HTMLElement>('.peekfb-pip')!;
    expect(pip).not.toHaveAttribute('data-mood');
    await user.click(within(bubble()).getByRole('button', { name: 'Yes' }));
    expect(pip).toHaveAttribute('data-mood', 'happy');
  });

  it('asks nothing when the page has no question to ask', () => {
    open({ kind: null });
    expect(bubble()).toBeNull();
    expect(row()).toBeNull();
  });

  it('starts over for another parcel, and for a carrier found while the page was open', async () => {
    const user = userEvent.setup();
    const { subject, rerender } = open();
    await user.click(within(bubble()).getByRole('button', { name: 'Not quite' }));
    expect(within(bubble()).getByText('What’s off?')).toBeVisible();
    rerender(<Page {...subject} notes={memoryNotes()} />);
    expect(within(bubble()).getByText('Did I get this one right?')).toBeVisible();
    rerender(<Page {...subject} kind="unknown" />);
    expect(within(row()).getByText('Does the carrier’s own site show it?')).toBeVisible();
  });
});

describe('the question on the way back from the carrier’s site', () => {
  it('asks once per scan whether the carrier says the same, and takes a yes as an answer to the standing question too', async () => {
    const user = userEvent.setup();
    const { send, notes } = open();
    await leaveAndReturn(user);
    const toast = screen.getByText('Does UPS say the same?').closest<HTMLElement>('[role=status]')!;
    expect(notes.memory).toEqual({ back: SCAN });
    await user.click(within(toast).getByRole('button', { name: 'Yes' }));
    expect(screen.queryByText('Does UPS say the same?')).toBeNull();
    expect(screen.getByText('Thanks, good to know.')).toBeVisible();
    expect(within(bubble()).getByRole('status')).toHaveTextContent('Good to know, thanks!');
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ answer: 'right', asked: 'back' }));
    await waitFor(() => expect(notes.memory).toEqual({ back: SCAN, at: expect.any(String), scan: SCAN }));
    // Another visit to the carrier asks nothing more.
    await leaveAndReturn(user);
    expect(screen.queryByText('Does UPS say the same?')).toBeNull();
  });

  it('takes a no in a sheet, sends what was picked there, and thanks at the edge of the screen', async () => {
    const user = userEvent.setup();
    const { send } = open();
    await leaveAndReturn(user);
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(screen.queryByText('Does UPS say the same?')).toBeNull();
    const sheet = screen.getByRole('dialog', { name: 'What’s off?' });
    expect(within(sheet).getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(send).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole('button', { name: 'It has arrived' }));
    await user.click(within(sheet).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(send).toHaveBeenCalledExactlyOnceWith({ id: expect.stringMatching(UUID), answer: 'wrong', reasons: ['arrived'], asked: 'back', app: 'web', locale: 'en' });
    expect(screen.getByText('Thanks, noted. It helps Peek get this right.')).toBeVisible();
    await waitFor(() => expect(within(bubble()).getByRole('status')).toHaveTextContent('Thanks! I’ll look into it.'));
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith('parcel-feedback-wrong', 'success');
  });

  it('leaves the standing question as it was when the sheet is closed without an answer', async () => {
    const user = userEvent.setup();
    const { send } = open();
    await leaveAndReturn(user);
    await user.click(screen.getByRole('button', { name: 'No' }));
    await user.click(within(screen.getByRole('dialog', { name: 'What’s off?' })).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(bubble()).getByText('Did I get this one right?')).toBeVisible();
    expect(send).not.toHaveBeenCalled();
  });

  it('stays quiet after a glance away, without a visit to the carrier, while something else is over the page, and for a reader who answered', async () => {
    const user = userEvent.setup();
    const glance = open();
    await leaveAndReturn(user, 800);
    expect(screen.queryByText('Does UPS say the same?')).toBeNull();
    // The visit was spent: coming back again asks nothing either.
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.queryByText('Does UPS say the same?')).toBeNull();
    expect(glance.notes.memory).toEqual({});
    glance.unmount();

    const unvisited = open();
    awayAndBack();
    expect(screen.queryByText('Does UPS say the same?')).toBeNull();
    unvisited.unmount();

    const busy = open({ busy: true });
    await leaveAndReturn(user);
    expect(screen.queryByText('Does UPS say the same?')).toBeNull();
    busy.unmount();

    const answered = open({ notes: memoryNotes({ at: hoursAgo(2), scan: SCAN }) });
    await leaveAndReturn(user);
    expect(screen.queryByText('Does UPS say the same?')).toBeNull();
    answered.unmount();

    // A parcel no carrier was found for is never asked on the way back.
    open({ kind: 'unknown' });
    await leaveAndReturn(user);
    expect(screen.queryByText(/say the same/)).toBeNull();
  });

  it('leaves on its own after a while', () => {
    vi.useFakeTimers();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Open the UPS website' }));
    awayAndBack();
    expect(screen.getByText('Does UPS say the same?')).toBeVisible();
    act(() => { vi.advanceTimersByTime(11_000); });
    expect(screen.getByText('Does UPS say the same?')).toBeVisible();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.queryByText('Does UPS say the same?')).toBeNull();
  });
});

describe('the question about a parcel no carrier was found for', () => {
  it('asks in a row whether the carrier’s site shows it, and takes who carries it in a sheet', async () => {
    const user = userEvent.setup();
    const { send, notes } = open({ kind: 'unknown', scan: 'none', carrier: 'Unknown carrier' });
    expect(bubble()).toBeNull();
    expect(within(row()).getByText('Does the carrier’s own site show it?')).toBeVisible();
    await user.click(within(row()).getByRole('button', { name: 'Yes' }));
    const sheet = screen.getByRole('dialog', { name: 'Who’s carrying it?' });
    expect(within(sheet).getByText('Sent with this parcel’s number. Nothing about you.')).toBeVisible();
    expect(within(sheet).getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(within(sheet).getByLabelText('Carrier or shop'), ' Zephyr Express ');
    await user.type(within(sheet).getByLabelText('Its tracking page, if you have the link'), 'zephyr.example.test/track{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(send).toHaveBeenCalledExactlyOnceWith({
      id: expect.stringMatching(UUID), answer: 'found_elsewhere', carrierName: 'Zephyr Express', trackingPage: 'zephyr.example.test/track',
      asked: 'page', app: 'web', locale: 'en',
    });
    await waitFor(() => expect(within(row()).getByRole('status')).toHaveTextContent('Thanks, that helps Peek learn this carrier.'));
    expect(within(row()).queryByRole('button')).toBeNull();
    expect(notes.memory).toEqual({ at: expect.any(String), scan: 'none' });
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith('parcel-feedback-carrier', 'success');
  });

  it('sends a page alone, and keeps the sheet open when it could not be sent', async () => {
    const user = userEvent.setup();
    const send = vi.fn<(feedback: ApiParcelFeedbackRequest) => Promise<void>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    open({ kind: 'unknown', scan: 'none', send });
    await user.click(within(row()).getByRole('button', { name: 'Yes' }));
    const sheet = screen.getByRole('dialog', { name: 'Who’s carrying it?' });
    await user.type(within(sheet).getByLabelText('Its tracking page, if you have the link'), 'https://zephyr.example.test/t/1');
    await user.click(within(sheet).getByRole('button', { name: 'Send' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Couldn’t send that. Try again.');
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith('parcel-feedback-carrier', 'error');
    await user.click(within(sheet).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ answer: 'found_elsewhere', trackingPage: 'https://zephyr.example.test/t/1' }));
    expect(send.mock.calls[1][0]).not.toHaveProperty('carrierName');
  });

  it('takes “not yet” without sending or keeping anything, and asks again on the next visit', async () => {
    const user = userEvent.setup();
    const { send, notes, unmount } = open({ kind: 'unknown', scan: 'none' });
    await user.click(within(row()).getByRole('button', { name: 'Not yet' }));
    expect(within(row()).getByRole('status')).toHaveTextContent('Then it’s early days. Peek keeps asking.');
    expect(row()).toHaveFocus();
    expect(send).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
    expect(notes.memory).toEqual({});
    unmount();
    open({ kind: 'unknown', scan: 'none', notes });
    expect(within(row()).getByText('Does the carrier’s own site show it?')).toBeVisible();
  });
});
