import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINK_ID, testParcel } from '../../test/parcelLinks';
import { forgetAllLinkNotes, forgetLinkNote, linkNote, noteLink } from '../deviceNotes';
import { asksFeedback, asksOnReturn, feedbackMemory, scanIdentity } from './feedbackModel';
import { FEEDBACK_STORAGE_KEY, linkFeedbackNotes, parcelFeedbackNotes } from './feedbackNotes';

const NOW = Date.parse('2026-10-08T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

afterEach(() => { forgetAllLinkNotes(); localStorage.clear(); vi.restoreAllMocks(); });

describe('when a parcel’s question is asked', () => {
  it('names what the page ends on by its newest scan and how many it has', () => {
    const parcel = testParcel();
    expect(scanIdentity(parcel)).toBe('2:2026-10-01T10:00:00.000Z');
    expect(scanIdentity({ events: parcel.events.slice(0, 1) })).toBe('1:2026-10-01T09:00:00.000Z');
    expect(scanIdentity({ events: [] })).toBe('none');
  });

  it('asks a reader who never answered, never twice about one scan, and at most once a day', () => {
    expect(asksFeedback({}, 'a', NOW)).toBe(true);
    // The same scan stays answered for however long it stands.
    expect(asksFeedback({ at: hoursAgo(1), scan: 'a' }, 'a', NOW)).toBe(false);
    expect(asksFeedback({ at: hoursAgo(500), scan: 'a' }, 'a', NOW)).toBe(false);
    // A new scan is asked about a day after the answer, not before.
    expect(asksFeedback({ at: hoursAgo(23), scan: 'a' }, 'b', NOW)).toBe(false);
    expect(asksFeedback({ at: hoursAgo(25), scan: 'a' }, 'b', NOW)).toBe(true);
    // "Not yet" answers for no scan: it quiets the question for a day only.
    expect(asksFeedback({ at: hoursAgo(2), scan: '' }, 'none', NOW)).toBe(false);
    expect(asksFeedback({ at: hoursAgo(25), scan: '' }, 'none', NOW)).toBe(true);
  });

  it('asks on the way back once per scan, and only while the standing question is asked', () => {
    expect(asksOnReturn({}, 'a', NOW)).toBe(true);
    expect(asksOnReturn({ back: 'a' }, 'a', NOW)).toBe(false);
    expect(asksOnReturn({ back: 'a' }, 'b', NOW)).toBe(true);
    expect(asksOnReturn({ at: hoursAgo(1), scan: 'a' }, 'b', NOW)).toBe(false);
  });

  it('reads a stored memory back, and anything else as none', () => {
    expect(feedbackMemory({ at: hoursAgo(1), scan: 'a', back: 'b', more: 1 })).toEqual({ at: hoursAgo(1), scan: 'a', back: 'b' });
    expect(feedbackMemory({ at: hoursAgo(1) })).toEqual({ at: hoursAgo(1), scan: '' });
    expect(feedbackMemory({ back: 'b' })).toEqual({ back: 'b' });
    // A time that is none, or words too long to be this page's, are dropped.
    expect(feedbackMemory({ at: 'yesterday', scan: 'a' })).toBeNull();
    expect(feedbackMemory({ at: hoursAgo(1), scan: 'x'.repeat(81) })).toEqual({ at: hoursAgo(1), scan: '' });
    expect(feedbackMemory({ back: 7 })).toBeNull();
    expect(feedbackMemory('answered')).toBeNull();
    expect(feedbackMemory(null)).toBeNull();
  });
});

describe('where a browser remembers its answer', () => {
  it('keeps a link’s with the link’s other notes, so forgetting the link forgets it', () => {
    const notes = linkFeedbackNotes(LINK_ID);
    expect(notes.read()).toEqual({});
    noteLink(LINK_ID, { alert: { preset: 'important', endpoint: 'demo:1' } });
    notes.write({ at: hoursAgo(1), scan: 'a' });
    expect(notes.read()).toEqual({ at: hoursAgo(1), scan: 'a' });
    expect(linkNote(LINK_ID).alert).toEqual({ preset: 'important', endpoint: 'demo:1' });
    forgetLinkNote(LINK_ID);
    expect(notes.read()).toEqual({});
  });

  it('keeps an account parcel’s under its id, for the latest parcels only', () => {
    const one = parcelFeedbackNotes('package-1');
    expect(one.read()).toEqual({});
    one.write({ at: hoursAgo(1), scan: 'a' });
    parcelFeedbackNotes('package-2').write({ back: 'b' });
    expect(one.read()).toEqual({ at: hoursAgo(1), scan: 'a' });
    expect(parcelFeedbackNotes('package-2').read()).toEqual({ back: 'b' });
    expect(parcelFeedbackNotes('package-3').read()).toEqual({});
    for (let index = 0; index < 80; index += 1) parcelFeedbackNotes(`later-${index}`).write({ back: 'c' });
    expect(one.read()).toEqual({});
    expect(Object.keys(JSON.parse(localStorage.getItem(FEEDBACK_STORAGE_KEY)!) as object)).toHaveLength(80);
    // An answer given again moves the parcel back among the latest.
    parcelFeedbackNotes('later-0').write({ back: 'd' });
    expect(Object.keys(JSON.parse(localStorage.getItem(FEEDBACK_STORAGE_KEY)!) as object).at(-1)).toBe('later-0');
  });

  it('reads storage it cannot trust as no memory, and remembers for the page when it cannot write', () => {
    localStorage.setItem(FEEDBACK_STORAGE_KEY, '{not json');
    expect(parcelFeedbackNotes('package-1').read()).toEqual({});
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify([{ at: hoursAgo(1) }]));
    expect(parcelFeedbackNotes('0').read()).toEqual({});
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify({ 'package-1': 'yes', 'package-2': { back: 'b' } }));
    expect(parcelFeedbackNotes('package-1').read()).toEqual({});
    expect(parcelFeedbackNotes('package-2').read()).toEqual({ back: 'b' });

    const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    parcelFeedbackNotes('package-1').write({ at: hoursAgo(1), scan: 'a' });
    expect(parcelFeedbackNotes('package-1').read()).toEqual({ at: hoursAgo(1), scan: 'a' });
    full.mockRestore();
    // The next write that goes through is the memory again.
    parcelFeedbackNotes('package-1').write({ back: 'b' });
    expect(JSON.parse(localStorage.getItem(FEEDBACK_STORAGE_KEY)!)).toMatchObject({ 'package-1': { back: 'b' } });
  });
});
