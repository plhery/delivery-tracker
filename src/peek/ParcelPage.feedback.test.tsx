import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_ID, OWNER_KEY, testView } from '../test/parcelLinks';
import type { ParcelWithEvents, Stage, TrackingEvent } from '../types';
import { forgetAllLinkNotes, linkNote } from './deviceNotes';
import type { ParcelLinkView } from './links';
import { ParcelPage } from './ParcelPage';
import { forgetAllRecents, rememberParcel } from './recents';
import { SAMPLE_LINK_ID } from './sample';

const mocks = vi.hoisted(() => ({ read: vi.fn(), feedback: vi.fn() }));
vi.mock('./links', async (original) => ({ ...await original<typeof import('./links')>(), readParcelLink: mocks.read, sendLinkFeedback: mocks.feedback }));

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const scan = (stage: Stage, hoursAgo: number): TrackingEvent =>
  ({ id: `${stage}-${hoursAgo}`, parcelId: 'parcel-1', stage, description: `Scan at ${stage}`, occurredAt: ago(hoursAgo) });
const journey = [scan('registered', 50), scan('accepted', 30), scan('in_transit', 6)];
const arrived = [...journey, scan('out_for_delivery', 3), scan('delivered', 1)];

function view({ events = journey, parcel = {}, owner = true, link = {} }: {
  events?: TrackingEvent[];
  parcel?: Partial<ParcelWithEvents>;
  owner?: boolean;
  link?: Partial<ParcelLinkView['link']>;
} = {}): ParcelLinkView {
  const shown = testView({ owner, parcel: { lastSyncedAt: ago(2 / 60), createdAt: ago(100), ...parcel } });
  return { ...shown, link: { ...shown.link, gift: false, shared: true, ...link }, parcel: { ...shown.parcel, events } };
}

/** Opens the page; as the owner, this device holds the link's key. */
async function open(shown: ParcelLinkView, linkId = LINK_ID) {
  history.replaceState(null, '', `/p/${linkId}`);
  if (shown.link.role === 'owner' && linkId === LINK_ID) rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: shown });
  mocks.read.mockResolvedValue(shown);
  const page = render(<ParcelPage linkId={linkId} />);
  await screen.findByRole('heading', { level: 1 });
  return page;
}
const bubble = () => document.querySelector<HTMLElement>('.peekfb-bubble');
const row = () => document.querySelector<HTMLElement>('.peekfb-ask');

beforeEach(() => {
  mocks.read.mockReset();
  mocks.feedback.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  forgetAllRecents();
  forgetAllLinkNotes();
  history.replaceState(null, '', '/');
});

describe('the question on a parcel’s page', () => {
  it('is Pip’s where the history ends, and sends the owner’s answer with the key this device holds', async () => {
    const user = userEvent.setup();
    await open(view());
    // After the journal and the line that says when the carrier was last asked.
    const fresh = document.querySelector('.peekp-fresh')!;
    expect(fresh.compareDocumentPosition(bubble()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(within(bubble()!).getByRole('button', { name: 'Yes' }));
    expect(mocks.feedback).toHaveBeenCalledExactlyOnceWith(LINK_ID, expect.objectContaining({ answer: 'right', asked: 'page', app: 'web', locale: 'en' }), OWNER_KEY);
    await waitFor(() => expect(linkNote(LINK_ID).feedback).toMatchObject({ scan: `3:${journey[2].occurredAt}` }));
  });

  it('asks whoever opened a shared link, without a key, and names the carrier in what the sheet promises', async () => {
    const user = userEvent.setup();
    await open(view({ owner: false }));
    await user.click(within(bubble()!).getByRole('button', { name: 'Not quite' }));
    await user.click(within(bubble()!).getByRole('button', { name: 'Wrong status' }));
    expect(mocks.feedback).toHaveBeenCalledExactlyOnceWith(LINK_ID, expect.objectContaining({ answer: 'wrong', reasons: ['status'] }), null);
    await user.click(await within(bubble()!).findByRole('button', { name: 'Add a note' }));
    expect(within(screen.getByRole('dialog', { name: 'What’s off?' })).getByText('Sent with this parcel’s number and what DHL answered. Nothing about you.')).toBeVisible();
  });

  it('asks on the way back from the carrier’s own site, by the name its link carries', async () => {
    const user = userEvent.setup();
    await open(view());
    const link = screen.getByRole('link', { name: 'Open the DHL website' });
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const clock = vi.spyOn(Date, 'now');
    const left = Date.now();
    clock.mockReturnValue(left);
    document.dispatchEvent(new Event('visibilitychange'));
    hidden.mockReturnValue(false);
    clock.mockReturnValue(left + 5_000);
    document.dispatchEvent(new Event('visibilitychange'));
    clock.mockRestore();
    hidden.mockRestore();
    expect(await screen.findByText('Does DHL say the same?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'No' }));
    const sheet = screen.getByRole('dialog', { name: 'What’s off?' });
    await user.click(within(sheet).getByRole('button', { name: 'Missing steps' }));
    await user.click(within(sheet).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.feedback).toHaveBeenCalledExactlyOnceWith(LINK_ID, expect.objectContaining({ answer: 'wrong', reasons: ['steps'], asked: 'back' }), OWNER_KEY));
  });

  it('asks in a row who carries a parcel no carrier was found for', async () => {
    const user = userEvent.setup();
    await open(view({ events: [scan('pending', 60)], parcel: { carrier: 'unknown', syncStatus: 'waiting' } }));
    expect(bubble()).toBeNull();
    expect(within(row()!).getByText('Does the carrier’s own site show it?')).toBeVisible();
    await user.click(within(row()!).getByRole('button', { name: 'Yes' }));
    const sheet = screen.getByRole('dialog', { name: 'Who’s carrying it?' });
    await user.type(within(sheet).getByLabelText('Carrier or shop'), 'Zephyr Express');
    await user.click(within(sheet).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.feedback).toHaveBeenCalledExactlyOnceWith(LINK_ID, expect.objectContaining({ answer: 'found_elsewhere', carrierName: 'Zephyr Express' }), OWNER_KEY));
  });

  it('is not asked of a gift’s recipient, wrapped or opened, and is asked of who gave it', async () => {
    const wrapped = await open(view({ owner: false, link: { gift: true } }));
    expect(bubble()).toBeNull();
    expect(row()).toBeNull();
    wrapped.unmount();
    const opened = await open(view({ owner: false, link: { gift: true }, events: arrived }));
    expect(bubble()).toBeNull();
    opened.unmount();
    await open(view({ link: { gift: true } }));
    expect(within(bubble()!).getByText('Did I get this one right?')).toBeVisible();
  });

  it('is not asked about the sample, nor before the carrier was first asked', async () => {
    const shown = view({ parcel: { label: 'Moon lamp' } });
    const sample = await open({ ...shown, link: { ...shown.link, id: SAMPLE_LINK_ID, forgetAt: null, canKeep: false } }, SAMPLE_LINK_ID);
    expect(bubble()).toBeNull();
    sample.unmount();
    await open(view({ events: [scan('pending', 0)], parcel: { syncStatus: 'pending', lastSyncedAt: undefined } }));
    expect(bubble()).toBeNull();
    expect(row()).toBeNull();
  });
});
