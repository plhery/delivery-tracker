import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_ID, OTHER_LINK_ID, OWNER_KEY, testParcel, testView } from '../../test/parcelLinks';
import { forgetAllLinkNotes, linkNote, noteLink } from '../deviceNotes';
import { ParcelLinkError, type ParcelLinkChanges, type ParcelLinkView, type ParcelShare, type ParcelShareClient } from '../links';
import { AccountShareSheet, LinkShareSheet } from './ShareSheet';

const mocks = vi.hoisted(() => ({ update: vi.fn(), track: vi.fn() }));
vi.mock('../links', async (original) => ({ ...await original<typeof import('../links')>(), updateParcelLink: mocks.update }));
vi.mock('../../lib/analytics', async (original) => ({ ...await original<typeof import('../../lib/analytics')>(), trackAction: mocks.track }));

const ADDRESS = `http://localhost/p/${LINK_ID}`;
const owned = (link: Partial<ParcelLinkView['link']> = {}): ParcelLinkView => {
  const view = testView();
  return { ...view, link: { ...view.link, gift: false, shared: true, ...link } };
};
const toggle = (name: string) => screen.getByRole('switch', { name });
const clipboard = () => {
  const copied = vi.fn<(text: string) => Promise<void>>(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copied } });
  return copied;
};

/** The sheet over a page that takes its answers, as the parcel page does. */
function OwnerSheet({ initial = owned(), name = 'New sneakers' as string | null, worksUntil = null as string | null, onAccount = undefined as (() => void) | undefined,
  onClose = () => undefined, onChanged = (() => undefined) as (view: ParcelLinkView) => void }) {
  const [view, setView] = useState(initial);
  return <LinkShareSheet linkId={LINK_ID} ownerKey={OWNER_KEY} view={view} name={name} worksUntil={worksUntil} onAccount={onAccount}
    onChanged={(next) => { onChanged(next); setView(next); }} onClose={onClose} />;
}
/** The small card that shows what the link shows. Pip's label repeats the number, so the card's own line is asked for. */
const preview = (caption = 'What they’ll see') => within(screen.getByRole('group', { name: caption }));
const previewNumber = () => document.querySelector('.peeks-preview__number');

beforeEach(() => {
  mocks.track.mockReset();
  mocks.update.mockReset().mockImplementation(async (_id: string, _key: string, changes: ParcelLinkChanges) => owned({
    ...(typeof changes.showNumber === 'boolean' ? { showNumber: changes.showNumber } : {}),
    ...(typeof changes.gift === 'boolean' ? { gift: changes.gift } : {}),
    ...(typeof changes.shared === 'boolean' ? { shared: changes.shared } : {}),
  }));
});
afterEach(() => {
  forgetAllLinkNotes();
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('the share sheet of a looked-up parcel', () => {
  it('shows what the other person will see, three real switches of one line each, and the link with a way to copy it', async () => {
    const user = userEvent.setup();
    const copied = clipboard();
    render(<OwnerSheet />);
    const sheet = screen.getByRole('dialog', { name: 'Share this parcel' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    // The card the other person gets, small: the carrier, the status and the masked number, without the name.
    expect(preview().getByLabelText('DHL')).toBeVisible();
    expect(preview().getByText('In transit')).toBeVisible();
    expect(previewNumber()).toHaveTextContent(/^••• 99$/);
    expect(preview().queryByText('New sneakers')).toBeNull();
    expect(sheet.querySelector('.peeks-preview svg.parcel-illustration')).toHaveAttribute('aria-hidden', 'true');
    // The card says what the switches change: none of them carries a sentence, and no promise follows them.
    expect(screen.getAllByRole('switch').map((option) => document.getElementById(option.getAttribute('aria-labelledby')!)!.textContent))
      .toEqual(['Show the full number', 'Show its name', 'Wrap as a gift']);
    expect(toggle('Show the full number')).not.toBeChecked();
    expect(toggle('Show the full number')).not.toHaveAccessibleDescription();
    expect(toggle('Show its name')).toHaveAccessibleDescription('New sneakers');
    expect(toggle('Wrap as a gift')).not.toHaveAccessibleDescription();
    expect(sheet.querySelector('.peeks__promise')).toBeNull();
    // The link stands under the switches, above the way to share it.
    const link = within(sheet).getByLabelText('Parcel link');
    expect(link).toHaveTextContent(`localhost/p/${LINK_ID}`);
    expect(toggle('Wrap as a gift').compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(screen.getByRole('button', { name: 'Share…' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copied).toHaveBeenCalledWith(ADDRESS);
    expect(await screen.findByRole('status')).toHaveTextContent('Link copied');
    expect(mocks.track).toHaveBeenCalledWith('parcel-link-share', 'success');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('saves the number switch at once: on before the server answers, then as the server says, and told to the page', async () => {
    let answer: (view: ParcelLinkView) => void = () => undefined;
    mocks.update.mockReturnValueOnce(new Promise<ParcelLinkView>((resolve) => { answer = resolve; }));
    const changed = vi.fn();
    const user = userEvent.setup();
    render(<OwnerSheet onChanged={changed} />);
    await user.click(toggle('Show the full number'));
    // The switch moves before the answer, and waits for it before moving again.
    expect(toggle('Show the full number')).toBeChecked();
    expect(toggle('Show the full number')).toHaveAttribute('aria-busy', 'true');
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(LINK_ID, OWNER_KEY, { showNumber: true });
    await user.click(toggle('Show the full number'));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    answer(owned({ showNumber: true }));
    // The card shows the whole number at once.
    expect(previewNumber()).toHaveTextContent(/^1234567899$/);
    await waitFor(() => expect(toggle('Show the full number')).not.toHaveAttribute('aria-busy'));
    // The owner's answer says what viewers read: nothing is noted on the device.
    expect(toggle('Show the full number')).toBeChecked();
    expect(changed).toHaveBeenCalledWith(owned({ showNumber: true }));
    expect(linkNote(LINK_ID).share).toBeUndefined();
    expect(mocks.track).toHaveBeenCalledWith('parcel-link-share-change', 'success');

    await user.click(toggle('Show the full number'));
    expect(mocks.update).toHaveBeenLastCalledWith(LINK_ID, OWNER_KEY, { showNumber: false });
    await waitFor(() => expect(toggle('Show the full number')).not.toBeChecked());
  });

  it('opens with the number switch as the server last stored it', () => {
    render(<OwnerSheet initial={owned({ showNumber: true })} />);
    expect(toggle('Show the full number')).toBeChecked();
  });

  it('puts a switch back and says so when it cannot be saved', async () => {
    mocks.update.mockRejectedValueOnce(new ParcelLinkError('server')).mockRejectedValueOnce(new ParcelLinkError('offline'));
    const user = userEvent.setup();
    render(<OwnerSheet />);
    await user.click(toggle('Wrap as a gift'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that. Check your connection and try again.');
    expect(toggle('Wrap as a gift')).not.toBeChecked();
    expect(mocks.track).toHaveBeenCalledWith('parcel-link-share-change', 'error');
    await user.click(toggle('Show the full number'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/connection/i));
    expect(toggle('Show the full number')).not.toBeChecked();
    expect(linkNote(LINK_ID).share).toBeUndefined();
  });

  it('adds the name to the link only when asked, without telling the server', async () => {
    const user = userEvent.setup();
    const copied = clipboard();
    render(<OwnerSheet />);
    await user.click(toggle('Show its name'));
    expect(toggle('Show its name')).toBeChecked();
    expect(preview().getByText('New sneakers')).toBeVisible();
    expect(screen.getByLabelText('Parcel link')).toHaveTextContent(`localhost/p/${LINK_ID}#n=New%20sneakers`);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copied).toHaveBeenCalledWith(`${ADDRESS}#n=New%20sneakers`);
    expect(linkNote(LINK_ID).share).toMatchObject({ name: true });
    expect(mocks.update).not.toHaveBeenCalled();
    await user.click(toggle('Show its name'));
    expect(screen.getByLabelText('Parcel link')).toHaveTextContent(new RegExp(`${LINK_ID}$`));
  });

  it('offers no name to show for a parcel without one', () => {
    noteLink(LINK_ID, { share: { name: true, note: '', from: '' } });
    render(<OwnerSheet name={null} />);
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(screen.queryByRole('switch', { name: 'Show its name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Name it' })).toBeNull();
    expect(screen.getByLabelText('Parcel link')).toHaveTextContent(new RegExp(`${LINK_ID}$`));
  });

  it('wraps the parcel as a gift, with an optional note and who it is from in the link’s # part', async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    const user = userEvent.setup();
    render(<OwnerSheet />);
    await user.click(toggle('Wrap as a gift'));
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(LINK_ID, OWNER_KEY, { gift: true });
    const note = await screen.findByRole('textbox', { name: 'A note, shown once it’s delivered' });
    expect(note).toHaveAccessibleDescription('Kept in the link, never on Peek’s servers.');
    // The card is the wrapped parcel now: when it arrives, and nothing about what it is or its number.
    expect(preview('What they’ll see until it’s delivered').getByText('Something’s on its way to you')).toBeVisible();
    expect(previewNumber()).toBeNull();
    expect(document.querySelector('.peeks-preview')).toHaveAttribute('data-gift', 'true');
    await user.type(note, 'Happy birthday, Alex!');
    await user.type(screen.getByRole('textbox', { name: 'From' }), 'Sam');
    await user.click(toggle('Show its name'));
    expect(linkNote(LINK_ID).share).toEqual({ name: true, note: 'Happy birthday, Alex!', from: 'Sam' });
    await user.click(screen.getByRole('button', { name: 'Share…' }));
    expect(share).toHaveBeenCalledWith({ url: `${ADDRESS}#n=New%20sneakers&g=Happy%20birthday%2C%20Alex!&f=Sam` });
    // Nothing of it went to the server: only the switch did.
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.update.mock.calls)).not.toMatch(/birthday|Sam|sneakers/);
    // No longer a gift: the note stays on the device, and out of the link.
    await user.click(toggle('Wrap as a gift'));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(screen.getByLabelText('Parcel link')).toHaveTextContent(new RegExp(`${LINK_ID}#n=New%20sneakers$`));
    expect(preview().getByText('New sneakers')).toBeVisible();
    expect(previewNumber()).toHaveTextContent('••• 99');
  });

  it('shares through the system’s sheet, copies where there is none, and says when neither works', async () => {
    const user = userEvent.setup();
    const copied = clipboard();
    const { unmount } = render(<OwnerSheet />);
    await user.click(screen.getByRole('button', { name: 'Share…' }));
    expect(copied).toHaveBeenCalledWith(ADDRESS);
    expect(await screen.findByRole('status')).toHaveTextContent('Link copied');
    copied.mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Share…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t copy the link. Copy it from the address bar instead.');
    unmount();
    // A share sheet closed without a choice says nothing.
    const share = vi.fn(async () => { throw new DOMException('Cancelled', 'AbortError'); });
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    render(<OwnerSheet />);
    await user.click(screen.getByRole('button', { name: 'Share…' }));
    expect(share).toHaveBeenCalledWith({ url: ADDRESS });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('stops sharing, says so, and offers the way back', async () => {
    const changed = vi.fn();
    const user = userEvent.setup();
    render(<OwnerSheet onChanged={changed} />);
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(LINK_ID, OWNER_KEY, { shared: false });
    expect(await screen.findByText('Sharing is stopped. The link shows nothing to anyone else.')).toBeVisible();
    expect(mocks.track).toHaveBeenCalledWith('parcel-link-share-stop', 'success');
    expect(changed).toHaveBeenLastCalledWith(owned({ shared: false }));
    // What a stopped link showed is not offered anymore.
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Share again' }));
    expect(mocks.update).toHaveBeenLastCalledWith(LINK_ID, OWNER_KEY, { shared: true });
    expect(await screen.findByRole('button', { name: 'Stop sharing' })).toBeVisible();
    expect(screen.getAllByRole('switch')).toHaveLength(3);
  });

  it('keeps sharing and says so when stopping fails; opens stopped for a link that already is', async () => {
    mocks.update.mockRejectedValueOnce(new ParcelLinkError('server'));
    const user = userEvent.setup();
    const { unmount } = render(<OwnerSheet />);
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that.');
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeEnabled();
    expect(mocks.track).toHaveBeenCalledWith('parcel-link-share-stop', 'error');
    unmount();
    mocks.update.mockRejectedValueOnce(new ParcelLinkError('unavailable'));
    render(<OwnerSheet initial={owned({ shared: false })} />);
    await user.click(screen.getByRole('button', { name: 'Share again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This parcel has been forgotten');
  });

  it('says until when the link works once there is a day, and leads a visitor to the account that keeps it', async () => {
    const onAccount = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<OwnerSheet />);
    // On its way there is no day yet: the sheet's foot only stops the sharing.
    expect(screen.queryByText(/Works until/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeVisible();
    // Nobody signed in is offered an account.
    rerender(<OwnerSheet worksUntil="30 dec" />);
    expect(screen.getByText('Works until 30 dec')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Keep it longer' })).toBeNull();
    rerender(<OwnerSheet worksUntil="30 dec" onAccount={onAccount} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Keep it longer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAccount).toHaveBeenCalledTimes(1);
  });

  it('shows the open box and the whole number of a parcel that arrived, and a gift as it is once opened', () => {
    const arrived = testView({ stages: ['in_transit', 'delivered'] });
    const { unmount } = render(<OwnerSheet initial={{ ...arrived, link: { ...arrived.link, gift: false, shared: true, showNumber: true } }} />);
    expect(preview().getByText('Delivered')).toBeVisible();
    expect(previewNumber()).toHaveTextContent('1234567899');
    expect(document.querySelector('.peeks-preview__pip')).toHaveClass('peeks-preview__pip--open');
    // The open box keeps its carrier's label, as the page it previews does.
    expect(document.querySelector('.peeks-preview__pip .parcel-illustration__label-number')).toHaveTextContent('1234567899');
    unmount();
    // A gift that arrived is no longer wrapped: it says that it is here, and what is inside when the link carries the name.
    noteLink(LINK_ID, { share: { name: true, note: '', from: '' } });
    render(<OwnerSheet initial={{ ...arrived, link: { ...arrived.link, gift: true, shared: true } }} />);
    expect(preview().getByText('It’s here')).toBeVisible();
    expect(preview().getByText('Inside: New sneakers')).toBeVisible();
    expect(previewNumber()).toHaveTextContent('••• 99');
    // A gift's box has no label, wrapped or opened.
    expect(document.querySelector('.peeks-preview__pip .parcel-illustration__label')).toBeNull();
  });

  it('keeps the card neutral for a number no carrier knows yet', () => {
    const unknown = testView({ parcel: { carrier: 'unknown', syncStatus: 'waiting' }, stages: ['pending'] });
    const { unmount } = render(<OwnerSheet />);
    expect(document.querySelector('.peeks-preview')).toHaveAttribute('style');
    unmount();
    render(<OwnerSheet initial={{ ...unknown, link: { ...unknown.link, gift: false, shared: true } }} name={null} />);
    expect(document.querySelector('.peeks-preview')).not.toHaveAttribute('style');
    expect(preview().getByText('Carrier not found yet')).toBeVisible();
  });

  it('closes on Escape and with its close button', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<OwnerSheet onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('the share sheet of an account’s parcel', () => {
  const parcel = testParcel({ id: 'package-1', label: 'New sneakers' });
  const link = (changes: Partial<ParcelShare> = {}): ParcelShare => ({ id: LINK_ID, showNumber: false, gift: false, createdAt: '2026-10-02T08:00:00.000Z', ...changes });
  function account(current: ParcelShare | null | Error = null) {
    const client = {
      current: vi.fn<ParcelShareClient['current']>(async () => { if (current instanceof Error) throw current; return current; }),
      share: vi.fn<ParcelShareClient['share']>(async (_parcel, changes = {}) => link(changes)),
      stop: vi.fn<ParcelShareClient['stop']>(async () => undefined),
    };
    return client;
  }

  it('makes no link by opening: the switches are chosen first, and sharing or copying makes it', async () => {
    const client = account();
    const user = userEvent.setup();
    const copied = clipboard();
    render(<AccountShareSheet parcel={parcel} client={client} onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'Share “New sneakers”' })).toBeVisible();
    expect(await screen.findByText('The link is made when you share or copy it.')).toBeVisible();
    expect(client.current).toHaveBeenCalledExactlyOnceWith('package-1');
    expect(toggle('Show its name')).toHaveAccessibleDescription('New sneakers');
    // Before there is a link, the card shows what it will show.
    expect(preview().getByText('In transit')).toBeVisible();
    expect(previewNumber()).toHaveTextContent(/^••• 99$/);
    expect(screen.queryByRole('button', { name: 'Stop sharing' })).toBeNull();

    await user.click(toggle('Show the full number'));
    await user.click(toggle('Show its name'));
    expect(toggle('Show the full number')).toBeChecked();
    expect(previewNumber()).toHaveTextContent('1234567899');
    expect(preview().getByText('New sneakers')).toBeVisible();
    expect(client.share).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(client.share).toHaveBeenCalledExactlyOnceWith(parcel, { showNumber: true, gift: false });
    expect(copied).toHaveBeenCalledWith(`${ADDRESS}#n=New%20sneakers`);
    expect(await screen.findByLabelText('Parcel link')).toHaveTextContent(`${LINK_ID}#n=New%20sneakers`);
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeVisible();
    // What the link carries is noted for the next time the sheet opens.
    expect(linkNote(LINK_ID).share).toMatchObject({ name: true });
    // The label never went to the server.
    expect(JSON.stringify(client.share.mock.calls.map(([, changes]) => changes))).not.toContain('sneakers');
  });

  it('opens on the link the parcel already has, and saves its switches at once', async () => {
    noteLink(LINK_ID, { share: { name: true, note: 'Happy birthday!', from: 'Sam' } });
    const client = account(link({ showNumber: true, gift: true }));
    const user = userEvent.setup();
    render(<AccountShareSheet parcel={parcel} client={client} onClose={() => undefined} />);
    expect(await screen.findByLabelText('Parcel link')).toHaveTextContent(`${LINK_ID}#n=New%20sneakers&g=Happy%20birthday!&f=Sam`);
    expect(toggle('Show the full number')).toBeChecked();
    expect(toggle('Wrap as a gift')).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'From' })).toHaveValue('Sam');
    await user.click(toggle('Show the full number'));
    expect(client.share).toHaveBeenCalledExactlyOnceWith(parcel, { showNumber: false, gift: true });
    await waitFor(() => expect(toggle('Show the full number')).not.toBeChecked());
  });

  it('stops for good and says that sharing again makes a new link', async () => {
    const client = account(link());
    client.share.mockResolvedValueOnce(link({ id: OTHER_LINK_ID }));
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    const user = userEvent.setup();
    render(<AccountShareSheet parcel={parcel} client={client} onClose={() => undefined} />);
    await user.click(await screen.findByRole('button', { name: 'Stop sharing' }));
    expect(client.stop).toHaveBeenCalledExactlyOnceWith('package-1');
    expect(await screen.findByText('Sharing is stopped. Sharing again makes a new link.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Stop sharing' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Share…' }));
    expect(share).toHaveBeenCalledWith({ url: `http://localhost/p/${OTHER_LINK_ID}` });
    expect(await screen.findByLabelText('Parcel link')).toHaveTextContent(OTHER_LINK_ID);
  });

  it('says when the link cannot be made, changed or stopped, and still offers sharing when its state cannot be read', async () => {
    const client = account(new ParcelLinkError('offline'));
    client.share.mockRejectedValueOnce(new ParcelLinkError('server')).mockResolvedValueOnce(link());
    const user = userEvent.setup();
    clipboard();
    render(<AccountShareSheet parcel={parcel} client={client} onClose={() => undefined} />);
    const copy = await screen.findByRole('button', { name: 'Copy' });
    await waitFor(() => expect(copy).toBeEnabled());
    await user.click(copy);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that. Check your connection and try again.');
    expect(screen.queryByLabelText('Parcel link')).toBeNull();
    await user.click(copy);
    expect(await screen.findByLabelText('Parcel link')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    client.stop.mockRejectedValueOnce(new ParcelLinkError('offline'));
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/connection/i);
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeVisible();
    client.share.mockRejectedValueOnce(new ParcelLinkError('server'));
    await user.click(toggle('Wrap as a gift'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that.');
    expect(toggle('Wrap as a gift')).not.toBeChecked();
  });

  it('says nothing about how long the link works: a link from an account works for as long as it is shared', async () => {
    render(<AccountShareSheet parcel={parcel} client={account()} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share…' })).toBeEnabled());
    expect(screen.queryByText(/Works until/)).toBeNull();
  });

  it('offers no name to show for a parcel without one', async () => {
    render(<AccountShareSheet parcel={{ ...parcel, label: ' ' }} client={account()} onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'Share this parcel' })).toBeVisible();
    await screen.findByText('The link is made when you share or copy it.');
    expect(screen.queryByRole('switch', { name: 'Show its name' })).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });
});
