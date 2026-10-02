import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n';
import de from '../../../shared/locales/de.json';
import type { Translate } from '../../lib/messages';
import { testParcel } from '../../test/parcelLinks';
import type { ParcelWithEvents, Stage } from '../../types';
import {
  capitalized,
  forgetDate,
  giftArrival,
  giftDelivered,
  giftPreviewText,
  journeyEndedBefore,
  momentLabel,
  parcelDetail,
  parcelFlag,
  parcelFreshness,
  parcelPreviewText,
  parcelTabTitle,
  previousEstimateLine,
} from './summary';

// Local time, so the day and the hour read the same wherever the tests run.
const NOW = new Date(2026, 9, 2, 12, 0).getTime();
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const t: Translate = (key, variables) => translate('en', key, variables);
const wording = { t, languageTag: 'en-CH', now: NOW };
const german = { t: ((key, variables) => translate('de', key, variables, de)) as Translate, languageTag: 'de-CH', now: NOW };

function parcel(stages: [Stage, string][], overrides: Partial<ParcelWithEvents> = {}): ParcelWithEvents {
  return {
    ...testParcel(overrides),
    events: stages.map(([stage, occurredAt], index) => ({ id: `e${index}`, parcelId: 'parcel-1', stage, description: `Scan ${index}`, occurredAt })),
  };
}
const moving = (overrides: Partial<ParcelWithEvents> = {}) => parcel([['registered', at(1, 8)], ['in_transit', at(2, 9)]], overrides);

describe('what the card says under the headline', () => {
  it('writes a nearby estimate as it is said, and a later one after “Expected”', () => {
    expect(parcelDetail(moving({ expectedDelivery: '2026-10-02 13:00-17:00' }), wording)).toBe('Today, 13:00–17:00');
    expect(parcelDetail(moving({ expectedDelivery: '2026-10-03' }), wording)).toBe('Tomorrow');
    expect(parcelDetail(moving({ expectedDelivery: '2026-10-06' }), wording)).toBe('Expected: Tue 6 oct');
    expect(parcelDetail(moving({ expectedDelivery: '2026-10-02 13:00-17:00' }), german)).toBe('Heute, 13:00–17:00');
    expect(parcelDetail(moving({ expectedDelivery: '2026-10-06' }), german)).toBe('Erwartet: Di 6 okt');
  });

  it('says there is no date yet while the parcel travels without one, and nothing once it waits or failed', () => {
    expect(parcelDetail(moving(), wording)).toBe('No delivery date yet');
    // An estimate that has passed no longer helps.
    expect(parcelDetail(moving({ expectedDelivery: '2026-09-30' }), wording)).toBe('No delivery date yet');
    expect(parcelDetail(parcel([['ready_for_pickup', at(2, 9)]], { expectedDelivery: '2026-10-06' }), wording)).toBeNull();
    expect(parcelDetail(parcel([['exception', at(2, 9)]]), wording)).toBeNull();
    expect(parcelDetail(parcel([['pending', at(2, 9)]], { syncStatus: 'pending' }), wording)).toBeNull();
    expect(parcelDetail(parcel([]), wording)).toBeNull();
  });

  it('says when a parcel arrived, with the hour only where the reader’s clock is known', () => {
    const delivered = parcel([['in_transit', at(1, 9)], ['delivered', at(2, 9, 12)]]);
    expect(parcelDetail(delivered, wording)).toBe('Today, 09:12');
    expect(parcelDetail(delivered, wording, false)).toBe('Today');
    expect(parcelDetail(parcel([['delivered', at(1, 14, 12)]]), { ...wording, now: NOW + 20 * 86_400_000 })).toBe('Thu 1 oct, 14:12');
    expect(parcelDetail(parcel([['returned', at(1, 9)]]), wording)).toBe('On its way back since yesterday');
    expect(parcelDetail({ ...delivered, events: [{ ...delivered.events[1], occurredAt: 'not a date' }] }, wording)).toBeNull();
  });

  it('tells the estimate from before a change, and only while the new one still stands', () => {
    const changed = moving({ expectedDelivery: '2026-10-03' });
    expect(previousEstimateLine('2026-10-02 13:00-17:00', changed, wording)).toBe('Was: today, 13:00–17:00');
    expect(previousEstimateLine('2026-10-03', changed, wording)).toBeNull();
    expect(previousEstimateLine(null, changed, wording)).toBeNull();
    expect(previousEstimateLine('2026-10-02', parcel([['delivered', at(2, 9)]], { expectedDelivery: '2026-10-03' }), wording)).toBeNull();
  });

  it('flags what the deliveries list would, except a parcel waiting to be collected', () => {
    expect(parcelFlag(parcel([['ready_for_pickup', at(2, 9)]]), NOW)).toBeNull();
    expect(parcelFlag(parcel([['customs', at(2, 9)]]), NOW)).toBe('customs');
    expect(parcelFlag(parcel([['in_transit', at(1, 9)]]), NOW + 5 * 86_400_000)).toBe('stalled');
    expect(parcelFlag(moving({ syncStatus: 'error' }), NOW)).toBe('sync_error');
    expect(parcelFlag(moving(), NOW)).toBeNull();
  });

  it('knows when the journey ended a day ago', () => {
    expect(journeyEndedBefore(parcel([['delivered', at(2, 9)]]), NOW)).toBe(false);
    expect(journeyEndedBefore(parcel([['delivered', at(1, 11, 59)]]), NOW)).toBe(true);
    expect(journeyEndedBefore(parcel([['returned', at(1, 9)]]), NOW)).toBe(true);
    expect(journeyEndedBefore(parcel([['in_transit', at(1, 9)]]), NOW)).toBe(false);
    expect(journeyEndedBefore(parcel([]), NOW)).toBe(false);
  });

  it('writes the forget date as the app writes its dates', () => {
    expect(forgetDate(new Date(2026, 9, 30, 12).toISOString(), 'en-CH')).toBe('30 oct');
    expect(forgetDate(new Date(2026, 9, 30, 12).toISOString(), 'de-CH')).toBe('30 okt');
    expect(forgetDate(null, 'en-CH')).toBeNull();
    expect(forgetDate('never', 'en-CH')).toBeNull();
  });

  it('places a moment for a reader, and capitalises in the reader’s language', () => {
    expect(momentLabel(at(2, 8, 12), wording)).toBe('08:12');
    expect(momentLabel(at(1, 8, 12), wording)).toBe('yesterday, 08:12');
    expect(momentLabel('', wording)).toBe('');
    expect(capitalized('état', 'fr-CH')).toBe('État');
    expect(capitalized('', 'en-CH')).toBe('');
  });
});

describe('the marker beside the carrier', () => {
  const base = { checking: false, live: true, offline: false, trouble: false, seenAt: null };

  it('says “updated” with a pulsing dot while the parcel moves and the page reads on its own', () => {
    expect(parcelFreshness({ ...base, parcel: moving({ lastSyncedAt: at(2, 11, 58) }) }, wording)).toEqual({
      kind: 'updated', label: 'Updated: 2 min ago', short: '2 min ago', dot: true, pulse: true,
    });
    expect(parcelFreshness({ ...base, live: false, parcel: moving({ lastSyncedAt: at(2, 11, 58) }) }, wording).pulse).toBe(false);
    // Without a check time of the parcel's own, the device's last answer dates it.
    expect(parcelFreshness({ ...base, seenAt: at(2, 11), parcel: moving() }, wording).label).toBe('Updated: 1 h ago');
  });

  it('says “last checked” while there is nothing new to tell', () => {
    const quiet = [
      parcel([['registered', at(2, 9)]], { lastSyncedAt: at(2, 11, 55) }),
      parcel([['pending', at(2, 9)]], { lastSyncedAt: at(2, 11, 55), syncStatus: 'waiting' }),
      parcel([['in_transit', new Date(2026, 8, 26, 9).toISOString()]], { lastSyncedAt: at(2, 11, 55) }),
    ];
    for (const waiting of quiet) expect(parcelFreshness({ ...base, parcel: waiting }, wording)).toMatchObject({ kind: 'checked', label: 'Last checked: 5 min ago', dot: true });
  });

  it('says “Live” until there is a check to date, “Offline” without a connection, and “As of” after a failure', () => {
    expect(parcelFreshness({ ...base, checking: true, parcel: moving({ lastSyncedAt: at(2, 11, 58) }) }, wording)).toMatchObject({ kind: 'live', label: 'Live', pulse: true });
    expect(parcelFreshness({ ...base, parcel: moving() }, wording)).toMatchObject({ kind: 'live' });
    expect(parcelFreshness({ ...base, parcel: moving({ lastSyncedAt: 'never' }) }, wording)).toMatchObject({ kind: 'live' });
    expect(parcelFreshness({ ...base, offline: true, parcel: moving({ lastSyncedAt: at(2, 11, 58) }) }, wording)).toEqual({
      kind: 'offline', label: 'Offline', short: 'Offline', dot: true, pulse: false,
    });
    expect(parcelFreshness({ ...base, trouble: true, parcel: moving({ lastSyncedAt: at(2, 9, 14) }) }, wording)).toEqual({
      kind: 'stale', label: 'As of 09:14', short: 'As of 09:14', dot: false, pulse: false,
    });
    expect(parcelFreshness({ ...base, parcel: moving({ lastSyncedAt: at(2, 9, 14), syncStatus: 'error' }) }, wording).kind).toBe('stale');
  });

  it('dates the end of the journey without a dot', () => {
    expect(parcelFreshness({ ...base, parcel: parcel([['delivered', at(2, 10)]], { lastSyncedAt: at(2, 11, 58) }) }, wording)).toEqual({
      kind: 'ended', label: '2 h ago', short: '2 h ago', dot: false, pulse: false,
    });
  });
});

describe('the tab’s title and the link preview', () => {
  it('follows the parcel: the hours when it comes today, the app’s name when there is no estimate', () => {
    expect(parcelTabTitle({ parcel: moving({ expectedDelivery: '2026-10-02 13:00-17:00' }) }, wording)).toBe('In transit · 13:00–17:00');
    expect(parcelTabTitle({ parcel: moving({ expectedDelivery: '2026-10-03' }) }, wording)).toBe('In transit · tomorrow');
    expect(parcelTabTitle({ parcel: moving() }, wording)).toBe('In transit · Peek');
    expect(parcelTabTitle({ parcel: moving(), name: 'New sneakers' }, wording)).toBe('New sneakers · In transit · Peek');
  });

  it('counts the scans that landed in a background tab, and says a lookup is still finding its carrier', () => {
    expect(parcelTabTitle({ parcel: moving(), unseen: 1 }, wording)).toBe('(1) In transit · Peek');
    expect(parcelTabTitle({ parcel: moving(), unseen: 0 }, wording)).toBe('In transit · Peek');
    expect(parcelTabTitle({ parcel: moving(), checking: true, unseen: 2 }, wording)).toBe('Finding the carrier… · Peek');
  });

  it('says when the parcel arrived today, and only that it arrived on a later day', () => {
    const delivered = parcel([['delivered', at(2, 9, 12)]]);
    expect(parcelTabTitle({ parcel: delivered }, wording)).toBe('Delivered at 09:12 · Peek');
    expect(parcelTabTitle({ parcel: delivered }, { ...wording, now: NOW + 86_400_000 })).toBe('Delivered · Peek');
    expect(parcelTabTitle({ parcel: delivered }, german)).toBe('Zugestellt um 09:12 · Peek');
  });

  it('writes the preview’s two lines without a number, a name or a place', () => {
    const shown = moving({ expectedDelivery: '2026-10-02 13:00-17:00', label: 'A private name' });
    expect(parcelPreviewText(shown, 'DHL', wording)).toEqual({
      headline: 'In transit', detail: 'Today, 13:00–17:00', title: 'In transit · DHL', description: 'Today, 13:00–17:00. Follow it on Peek.',
    });
    expect(parcelPreviewText(parcel([['ready_for_pickup', at(2, 9)]]), 'DHL', wording).description).toBe('Follow it on Peek.');
    expect(JSON.stringify(parcelPreviewText(shown, 'DHL', wording))).not.toMatch(/1234567899|private name/);
  });

  it('says of a gift when it arrives and when it arrived, in the reader’s language', () => {
    expect(giftArrival(moving({ expectedDelivery: '2026-10-02 13:00-17:00' }), wording)).toBe('Arrives today, 13:00–17:00');
    expect(giftArrival(moving({ expectedDelivery: '2026-10-06' }), wording)).toBe('Arrives Tue 6 oct');
    expect(giftArrival(moving({ expectedDelivery: '2026-10-03' }), german)).toBe('Kommt morgen');
    expect(giftArrival(moving(), wording)).toBeNull();
    const delivered = parcel([['in_transit', at(1, 8)], ['delivered', at(2, 9, 12)]]);
    expect(giftDelivered(delivered, wording)).toBe('Delivered today at 09:12');
    expect(giftDelivered(delivered, { ...wording, now: NOW + 86_400_000 })).toBe('Delivered yesterday at 09:12');
    expect(giftDelivered(delivered, german)).toBe('Zugestellt heute um 09:12');
    expect(giftDelivered(moving(), wording)).toBeNull();
  });

  it('previews a gift on its way with no carrier, name, number or place', () => {
    const gift = moving({ expectedDelivery: '2026-10-02 13:00-17:00', label: 'A private name', senderName: 'Example Shop' });
    expect(giftPreviewText(gift, wording)).toEqual({
      headline: 'Something’s on its way to you', detail: 'Arrives today, 13:00–17:00',
      title: 'Something’s on its way to you', description: 'Arrives today, 13:00–17:00. Follow it on Peek.',
    });
    expect(giftPreviewText(moving(), wording)).toMatchObject({ detail: null, description: 'Follow it on Peek.' });
    expect(JSON.stringify(giftPreviewText(gift, german))).not.toMatch(/1234567899|private name|Example Shop|DHL/);
  });
});
