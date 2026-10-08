import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINK_ID, OTHER_LINK_ID, OWNER_KEY, testView } from '../test/parcelLinks';
import { forgetAllLinkNotes, forgetLinkNote, LINK_NOTES_STORAGE_KEY, linkNote, noteLink, useLinkNote } from './deviceNotes';
import { forgetAllRecents, forgetRecent, rememberParcel } from './recents';

const share = { name: true, note: 'Happy birthday!', from: 'Sam' };
const alert = { preset: 'important' as const, endpoint: 'https://push.example.test/send/abc' };

afterEach(() => { forgetAllLinkNotes(); forgetAllRecents(); vi.restoreAllMocks(); });

describe('what this browser notes about a link', () => {
  it('keeps the sharer’s words and the browser’s alert side by side, and follows changes', () => {
    const { result } = renderHook(() => useLinkNote(LINK_ID));
    expect(result.current).toEqual({});
    act(() => noteLink(LINK_ID, { share }));
    expect(result.current).toEqual({ share });
    act(() => noteLink(LINK_ID, { alert }));
    expect(result.current).toEqual({ share, alert });
    expect(linkNote(OTHER_LINK_ID)).toEqual({});
    // A part set to null goes; the other stays.
    act(() => noteLink(LINK_ID, { share: null }));
    expect(result.current).toEqual({ alert });
    act(() => noteLink(LINK_ID, { alert: null }));
    expect(result.current).toEqual({});
    expect(localStorage.getItem(LINK_NOTES_STORAGE_KEY)).toBeNull();
    expect(renderHook(() => useLinkNote(null)).result.current).toEqual({});
  });

  it('reads only what it can trust: a link’s id, clean words within their limits, a known preset', () => {
    localStorage.setItem(LINK_NOTES_STORAGE_KEY, JSON.stringify({
      [LINK_ID]: { share: { name: true, note: `  two\nlines ${'x'.repeat(400)}`, from: 7 }, alert: { preset: 'hourly', endpoint: 'x' } },
      [OTHER_LINK_ID]: { alert: { preset: 'delivery', endpoint: 'demo:1' }, share: 'nonsense' },
      'not-a-link': { alert },
    }));
    const note = linkNote(LINK_ID);
    expect(note.alert).toBeUndefined();
    expect(note.share).toEqual(expect.objectContaining({ name: true, from: '' }));
    expect(note.share!.note.startsWith('two lines xxx')).toBe(true);
    expect([...note.share!.note]).toHaveLength(280);
    expect(linkNote(OTHER_LINK_ID)).toEqual({ alert: { preset: 'delivery', endpoint: 'demo:1' } });
    expect(linkNote('not-a-link')).toEqual({});
    noteLink('not-a-link', { alert });
    expect(linkNote('not-a-link')).toEqual({});
    localStorage.setItem(LINK_NOTES_STORAGE_KEY, '[damaged');
    expect(linkNote(LINK_ID)).toEqual({});
  });

  it('keeps what the browser answered about the parcel beside the rest, and reads back only a memory it can trust', () => {
    const feedback = { at: '2026-10-08T09:00:00.000Z', scan: '3:2026-10-08T08:00:00.000Z' };
    noteLink(LINK_ID, { alert, feedback });
    noteLink(LINK_ID, { share });
    expect(linkNote(LINK_ID)).toEqual({ share, alert, feedback });
    noteLink(LINK_ID, { feedback: null });
    expect(linkNote(LINK_ID)).toEqual({ share, alert });
    localStorage.setItem(LINK_NOTES_STORAGE_KEY, JSON.stringify({ [LINK_ID]: { feedback: { at: 'someday', scan: 7 } }, [OTHER_LINK_ID]: { feedback: { back: 'a' } } }));
    expect(linkNote(LINK_ID)).toEqual({});
    expect(linkNote(OTHER_LINK_ID)).toEqual({ feedback: { back: 'a' } });
  });

  it('goes with the parcel when the device forgets it', () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView() });
    noteLink(LINK_ID, { share, alert });
    noteLink(OTHER_LINK_ID, { alert });
    forgetRecent(LINK_ID);
    expect(linkNote(LINK_ID)).toEqual({});
    expect(linkNote(OTHER_LINK_ID)).toEqual({ alert });
    forgetLinkNote(OTHER_LINK_ID);
    forgetLinkNote(OTHER_LINK_ID);
    expect(linkNote(OTHER_LINK_ID)).toEqual({});
    noteLink(LINK_ID, { share });
    forgetAllRecents();
    expect(localStorage.getItem(LINK_NOTES_STORAGE_KEY)).toBeNull();
  });

  it('keeps working for the life of the page when storage refuses, and follows another tab', () => {
    const { result } = renderHook(() => useLinkNote(LINK_ID));
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => noteLink(LINK_ID, { alert }));
    expect(result.current).toEqual({ alert });
    refuse.mockRestore();
    // Another tab wrote the notes: this page reads them again.
    localStorage.setItem(LINK_NOTES_STORAGE_KEY, JSON.stringify({ [LINK_ID]: { share } }));
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: LINK_NOTES_STORAGE_KEY })); });
    expect(result.current).toEqual({ share });
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' })); });
    expect(result.current).toEqual({ share });
  });
});
