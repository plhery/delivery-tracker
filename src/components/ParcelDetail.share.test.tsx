import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetAllLinkNotes } from '../peek/deviceNotes';
import { LINK_ID, testParcel } from '../test/parcelLinks';
import type { ParcelWithEvents } from '../types';
import { ParcelDetail } from './ParcelDetail';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const auth = { userId: 'user-1', getAccessToken: async () => 'token' };
const parcel = testParcel({ id: 'package-1', label: 'New sneakers' });

function open(values: Partial<ParcelWithEvents> = {}, signedIn = true) {
  return render(<ParcelDetail parcel={{ ...parcel, ...values }} apiAuth={signedIn ? auth : undefined} onBack={vi.fn()} onRename={vi.fn()} onChangeCarrier={vi.fn()}
    onSetNotificationsMuted={vi.fn()} onRefresh={vi.fn()} onRestore={vi.fn()} onArchive={vi.fn()} onDelete={vi.fn()} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  forgetAllLinkNotes();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('sharing a parcel from the deliveries', () => {
  it('opens the share sheet from the card and from the actions menu, and makes the link only on share or copy', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_path, init) => init?.method === 'PUT'
      ? json({ link: { id: LINK_ID, showNumber: false, gift: false, createdAt: '2026-10-02T08:00:00.000Z' } }) : json({ link: null }));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    const copied = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copied } });
    open();
    await user.click(screen.getByRole('button', { name: 'Share this parcel' }));
    const sheet = screen.getByRole('dialog', { name: 'Share “New sneakers”' });
    expect(await within(sheet).findByText('The link is made when you share or copy it.')).toBeVisible();
    expect(within(sheet).getByText('The same page anyone gets from Peek’s front door. Your alerts, notes and account stay yours.')).toBeVisible();
    // Opening only asked whether the parcel is shared.
    expect(fetch.mock.calls.map(([path, init]) => [path, init?.method ?? 'GET'])).toEqual([['/api/packages/package-1/share', 'GET']]);

    await user.click(within(sheet).getByRole('button', { name: 'Copy' }));
    expect(fetch).toHaveBeenLastCalledWith('/api/packages/package-1/share', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ showNumber: false, gift: false }) }));
    expect(copied).toHaveBeenCalledWith(`http://localhost/p/${LINK_ID}`);
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Share “New sneakers”' })).toBeNull();

    // The same sheet from the menu.
    await user.click(screen.getByLabelText('Parcel actions'));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog', { name: 'Share “New sneakers”' })).toBeVisible();
  });

  it('is not offered for an archived parcel, nor without an account in a build that has an API', () => {
    const archived = open({ archivedAt: '2026-10-01T08:00:00.000Z' });
    expect(screen.queryByRole('button', { name: 'Share this parcel' })).toBeNull();
    archived.unmount();
    open({}, false);
    expect(screen.queryByRole('button', { name: 'Share this parcel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });
});
