import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEEDBACK_STORAGE_KEY } from '../peek/parcel/feedbackNotes';
import { testParcel } from '../test/parcelLinks';
import type { ParcelWithEvents } from '../types';
import { ParcelDetail } from './ParcelDetail';

const auth = { userId: 'user-1', getAccessToken: async () => 'token' };
const parcel = testParcel({ id: 'package-1', label: 'New sneakers', lastSyncedAt: '2026-10-01T12:00:00.000Z' });

function open(values: Partial<ParcelWithEvents> = {}, signedIn = true) {
  return render(<ParcelDetail parcel={{ ...parcel, ...values }} apiAuth={signedIn ? auth : undefined} onBack={vi.fn()} onRename={vi.fn()} onChangeCarrier={vi.fn()}
    onSetNotificationsMuted={vi.fn()} onRefresh={vi.fn()} onRestore={vi.fn()} onArchive={vi.fn()} onDelete={vi.fn()} />);
}
const requests = (fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>) => fetch.mock.calls.filter(([path]) => String(path).endsWith('/feedback'));
const bubble = () => document.querySelector<HTMLElement>('.peekfb-bubble');
const row = () => document.querySelector<HTMLElement>('.peekfb-ask');

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem(FEEDBACK_STORAGE_KEY);
});

describe('the question in the detail of an account’s parcel', () => {
  it('is Pip’s below the page, sends the answer as the account, and stands again on the next visit', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    const first = open();
    const sync = document.querySelector('.detail__sync')!;
    expect(sync.compareDocumentPosition(bubble()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // On the ground the page lies on, as on the iPhone.
    expect(bubble()!.closest('.peekfb')!.parentElement).toBe(sync.parentElement);
    await user.click(within(bubble()!).getByRole('button', { name: 'Not quite' }));
    await user.click(within(bubble()!).getByRole('button', { name: 'Wrong time or place' }));
    await waitFor(() => expect(requests(fetch)).toHaveLength(1));
    const [path, init] = requests(fetch)[0];
    expect(path).toBe('/api/packages/package-1/feedback');
    expect(init).toMatchObject({ method: 'POST' });
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer token');
    expect(JSON.parse(String(init!.body))).toEqual({ id: expect.any(String), answer: 'wrong', reasons: ['time_place'], asked: 'page', app: 'web', locale: 'en' });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(FEEDBACK_STORAGE_KEY)!)).toEqual({
      'package-1': { at: expect.any(String), scan: '2:2026-10-01T10:00:00.000Z' },
    }));
    first.unmount();
    // Something may happen that its reader tells only later.
    open();
    expect(within(bubble()!).getByText('Did I get this one right?')).toBeVisible();
  });

  it('asks who carries a parcel no carrier was found for', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    open({ carrier: 'unknown', events: [] });
    expect(bubble()).toBeNull();
    await user.click(within(row()!).getByRole('button', { name: 'Yes' }));
    const sheet = screen.getByRole('dialog', { name: 'Who’s carrying it?' });
    await user.type(within(sheet).getByLabelText('Carrier or shop'), 'Zephyr Express');
    await user.click(within(sheet).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(requests(fetch)).toHaveLength(1));
    expect(JSON.parse(String(requests(fetch)[0][1]!.body))).toMatchObject({ answer: 'found_elsewhere', carrierName: 'Zephyr Express' });
    await waitFor(() => expect(within(row()!).getByRole('status')).toHaveTextContent('Thanks, that helps Peek learn this carrier.'));
  });

  it('is not asked about an archived parcel, about one the carrier was never asked for, nor in the demo', () => {
    const archived = open({ archivedAt: '2026-10-02T08:00:00.000Z' });
    expect(bubble()).toBeNull();
    archived.unmount();
    const unchecked = open({ lastSyncedAt: undefined });
    expect(bubble()).toBeNull();
    unchecked.unmount();
    // The demo's parcels are stories: its reader is asked nothing, found or not.
    const demo = open({}, false);
    expect(bubble()).toBeNull();
    demo.unmount();
    open({ carrier: 'unknown', events: [] }, false);
    expect(row()).toBeNull();
  });
});
