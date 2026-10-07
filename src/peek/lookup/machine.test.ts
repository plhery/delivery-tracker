import { describe, expect, it } from 'vitest';
import {
  countdown,
  initialLookup,
  lookupStep,
  secondsLeft,
  survey,
  unanswered,
  type DeviceParcel,
  type LookupEvent,
  type LookupState,
} from './machine';

// Every number here is fictional.
const UPS = '1ZDEMO202600000001';
const SHARED = '01234567890123'; // A shape several carriers use: the carriers are asked.
const EXPRESS = '0000000046'; // Ten digits: DHL Express shares this shape with other carriers.
const SHAPELESS = 'DEMO4471203'; // No carrier's shape: nobody can be asked.
const AMAZON = 'TBA123456789012';
const TYPO = 'LX1234567B5DE';

function run(events: LookupEvent[], device: readonly DeviceParcel[] = [], from: LookupState = initialLookup()): LookupState {
  return events.reduce((state, event) => lookupStep(state, event, device), from);
}
const typed = (text: string): LookupEvent => ({ type: 'edit', text, via: 'typing' });
const pasted = (text: string): LookupEvent => ({ type: 'edit', text, via: 'paste' });
const track: LookupEvent = { type: 'submit' };
const rested = (text: string): LookupEvent => ({ type: 'pause', text });

describe('going on', () => {
  it('waits for Track when the number was typed, however certain the carrier', () => {
    const state = run([typed(UPS), rested(UPS)]);
    expect(state.job).toBeNull();
    expect(survey(state)).toMatchObject({ carrier: 'ups', source: 'shape', certain: true, need: null });
    expect(run([track], [], state).job).toEqual({ type: 'lookup', carrier: 'ups', input: { trackingNumber: UPS, carrier: 'ups' } });
  });

  it('goes straight on after a paste when the carrier is certain and nothing else is needed', () => {
    expect(run([pasted(`Your parcel ${UPS} is on its way`)]).job).toEqual({ type: 'lookup', carrier: 'ups', input: { trackingNumber: UPS, carrier: 'ups' } });
    expect(run([pasted('https://www.dhl.com/ch-en/home/tracking.html?tracking-id=1234567899')]).job)
      .toMatchObject({ input: { trackingNumber: '1234567899', carrier: 'dhl' } });
  });

  it('sends the number and the carrier and nothing else', () => {
    const { job } = run([pasted('99.34.123456.78901234')]);
    expect(job).toEqual({ type: 'lookup', carrier: 'swiss-post', input: { trackingNumber: '993412345678901234', carrier: 'swiss-post' } });
  });

  it('does nothing while a lookup is on its way', () => {
    const opening = run([pasted(UPS)]);
    expect(run([track, typed('other'), pasted('1ZDEMO202600000002'), { type: 'choose', carrier: 'dhl' }], [], opening)).toBe(opening);
    expect(run([{ type: 'done' }], [], opening)).toMatchObject({ job: null, text: UPS });
  });
});

describe('asking the carriers', () => {
  it.each([
    ['RR123456785FI', 'posti', ['posti', 'chronopost']],
    ['XR123456785TS', 'chronopost', ['chronopost']],
  ] as const)('confirms the postal fallback %s through its direct carrier before continuing a paste', (number, carrier, asked) => {
    const waiting = run([pasted(number)]);
    expect(waiting.job).toBeNull();
    expect(survey(waiting)).toMatchObject({ ask: number, carrier: 'intl-post', certain: false,
      check: { status: 'asking', asked: [] }, need: 'wait' });
    const found = run([{ type: 'answer', answer: { trackingNumber: number, carrier, asked: [...asked] } }], [], waiting);
    expect(found.job).toEqual({ type: 'lookup', carrier, input: { trackingNumber: number, carrier } });
  });

  it('keeps the postal fallback and manual choices when direct recognition finds nothing', () => {
    const number = 'RR123456785FI';
    const waiting = run([pasted(number)]);
    const none = run([{ type: 'answer', answer: { trackingNumber: number, carrier: 'intl-post', asked: ['posti', 'chronopost'] } }], [], waiting);
    expect(none.job).toEqual({ type: 'lookup', carrier: 'intl-post', input: { trackingNumber: number, carrier: 'intl-post' } });
    expect(survey(none)).toMatchObject({ carrier: 'intl-post', certain: false, check: { status: 'none' } });
    const chosen = run([{ type: 'choose', carrier: 'ups' }, track], [], waiting);
    expect(chosen.job).toEqual({ type: 'lookup', carrier: 'ups', input: { trackingNumber: number, carrier: 'ups' } });
  });

  it('asks on a paste, on leaving the field and on Track, never on a keystroke or a pause', () => {
    const typing = run([typed(SHARED), rested(SHARED)]);
    expect(survey(typing)).toMatchObject({ ask: null, check: { status: 'idle' } });
    expect(survey(run([{ type: 'blur' }], [], typing)).ask).toBe(SHARED);
    expect(survey(run([track], [], typing))).toMatchObject({ ask: SHARED, need: 'wait' });
    const paste = run([pasted(SHARED)]);
    expect(survey(paste)).toMatchObject({ ask: SHARED, check: { status: 'asking', asked: [] } });
    // A number of no known shape has nobody to ask.
    expect(survey(run([pasted(SHAPELESS)])).ask).toBeNull();
  });

  it('goes on by itself when a carrier has the pasted parcel', () => {
    const asking = run([pasted(SHARED)]);
    expect(asking.job).toBeNull();
    expect(asking.intent).toBe('paste');
    // The carrier found needs nothing: straight on.
    const found = run([{ type: 'answer', answer: { trackingNumber: SHARED, carrier: 'seur', asked: ['dpd', 'seur'] } }], [], asking);
    expect(found.job).toEqual({ type: 'lookup', carrier: 'seur', input: { trackingNumber: SHARED, carrier: 'seur' } });
  });

  it('continues a paste into universal discovery when no carrier knows the number', () => {
    const asking = run([pasted(SHARED)]);
    const none = run([{ type: 'answer', answer: { trackingNumber: SHARED, carrier: 'unknown', asked: ['dpd', 'seur'], unanswered: [] } }], [], asking);
    expect(none.intent).toBe('none');
    expect(survey(none)).toMatchObject({ check: { status: 'none' }, certain: false, need: null });
    expect(none.job).toEqual({ type: 'lookup', carrier: 'unknown', input: { trackingNumber: SHARED } });
  });

  it.each(['unknown', 'failed'] as const)('looks up a pasted Express-shaped number after %s recognition', (outcome) => {
    const waiting = run([pasted(`DHL Express tracking: ${EXPRESS}`)]);
    expect(waiting).toMatchObject({ job: null, intent: 'paste' });
    const answer = outcome === 'unknown'
      ? { trackingNumber: EXPRESS, carrier: 'unknown' as const, asked: ['dhl-express' as const] }
      : unanswered(EXPRESS);
    const found = run([{ type: 'answer', answer }], [], waiting);
    expect(found.job).toEqual({ type: 'lookup', carrier: 'unknown', input: { trackingNumber: EXPRESS } });
  });

  it('keeps a typed unconfirmed number for Track after recognition', () => {
    const asking = run([typed(EXPRESS), { type: 'blur' }]);
    const found = run([{ type: 'answer', answer: unanswered(EXPRESS) }], [], asking);
    expect(found.job).toBeNull();
    expect(run([track], [], found).job).toEqual({ type: 'lookup', carrier: 'unknown', input: { trackingNumber: EXPRESS } });
  });

  it('looks up a pasted number with no recognition candidates', () => {
    const found = run([pasted(SHAPELESS)]);
    expect(survey(found).ask).toBeNull();
    expect(found.job).toEqual({ type: 'lookup', carrier: 'unknown', input: { trackingNumber: SHAPELESS } });
  });

  it('holds a Track until the carriers answer, and degrades quietly when they do not', () => {
    const waiting = run([typed(SHARED), track]);
    expect(waiting).toMatchObject({ job: null, intent: 'track' });
    const refused = run([{ type: 'answer', answer: unanswered(SHARED) }], [], waiting);
    expect(survey({ ...refused, job: null }).check.status).toBe('failed');
    expect(refused.job).toEqual({ type: 'lookup', carrier: 'unknown', input: { trackingNumber: SHARED } });
    // An answer about another number is not this number's answer.
    expect(run([{ type: 'answer', answer: { trackingNumber: '99999999999999', carrier: 'dpd' } }], [], waiting)).toBe(waiting);
  });

  it('drops a pending Track when the text changes', () => {
    const waiting = run([typed(SHARED), track]);
    const edited = run([typed(`${SHARED}4`)], [], waiting);
    expect(edited.intent).toBe('none');
    expect(run([{ type: 'answer', answer: { trackingNumber: SHARED, carrier: 'seur' } }], [], edited).job).toBeNull();
  });

  it('lets the visitor choose when several carriers know the number', () => {
    const several = run([pasted(SHARED), { type: 'answer', answer: { trackingNumber: SHARED, carrier: 'unknown', recognized: ['dpd', 'seur'], asked: ['dpd', 'seur'] } }]);
    expect(several.job).toBeNull();
    expect(survey(several)).toMatchObject({ check: { status: 'several', carriers: ['dpd', 'seur'] }, need: 'carrier' });
    // Track without a choice stays put and leads to the choice.
    const pressed = run([track], [], several);
    expect(pressed.job).toBeNull();
    expect(pressed.halted).toBe(several.halted + 1);
    const chosen = run([{ type: 'choose', carrier: 'seur' }], [], several);
    expect(survey(chosen)).toMatchObject({ carrier: 'seur', source: 'chosen', need: null });
    expect(run([track], [], chosen).job).toMatchObject({ input: { trackingNumber: SHARED, carrier: 'seur' } });
  });

  it('asks nobody once a carrier is chosen by hand, and does not wait for an answer', () => {
    const chosen = run([typed(SHARED), { type: 'choose', carrier: 'seur' }, track]);
    expect(chosen.job).toMatchObject({ input: { trackingNumber: SHARED, carrier: 'seur' } });
    expect(survey({ ...chosen, job: null })).toMatchObject({ ask: null, check: { status: 'idle' } });
  });

  it('forgets a carrier chosen by hand when the number changes', () => {
    const chosen = run([typed(SHAPELESS), { type: 'choose', carrier: 'dhl' }]);
    expect(survey(chosen)).toMatchObject({ carrier: 'dhl', source: 'chosen' });
    expect(run([typed(`${SHAPELESS}9`)], [], chosen).carrier).toBe('auto');
    // The same number, written differently, keeps it.
    expect(run([typed(` ${SHAPELESS} `)], [], chosen).carrier).toBe('dhl');
  });
});

describe('input edge cases', () => {
  it('says that a text holds no number once typing rests, or at once on Track', () => {
    const typing = run([typed('hello there')]);
    expect(survey(typing).nothing).toBe(false);
    expect(survey(run([rested('hello there')], [], typing))).toMatchObject({ nothing: true, need: 'number' });
    const pressed = run([track], [], typing);
    expect(survey(pressed).nothing).toBe(true);
    expect(pressed.job).toBeNull();
    // An empty field has nothing to say until Track is pressed.
    expect(survey(initialLookup()).nothing).toBe(false);
    expect(survey(run([track])).nothing).toBe(false);
    // The notice goes as soon as a number appears.
    expect(survey(run([typed('hello 1ZDEMO202600000001')], [], pressed)).nothing).toBe(false);
    expect(survey(run([pasted('Thanks for your order!')])).nothing).toBe(true);
  });

  it('lists several numbers, tracks the first unless another is picked, and never picks for a paste', () => {
    const text = `UPS ${UPS}\nUPS 1ZDEMO202600000002\nSwiss Post 99.34.123456.78901234`;
    const state = run([pasted(text)]);
    expect(state.job).toBeNull();
    expect(survey(state).several.map(({ normalized }) => normalized)).toEqual([UPS, '1ZDEMO202600000002', '993412345678901234']);
    expect(survey(state)).toMatchObject({ normalized: UPS, carrier: 'ups' });
    expect(run([track], [], state).job).toMatchObject({ input: { trackingNumber: UPS, carrier: 'ups' } });
    const picked = run([{ type: 'pick', number: '993412345678901234' }], [], state);
    expect(picked.job).toBeNull();
    expect(run([track], [], picked).job).toMatchObject({ input: { trackingNumber: '993412345678901234', carrier: 'swiss-post' } });
    // A pick that is no longer in the text is dropped.
    expect(run([typed(`UPS ${UPS}\nUPS 1ZDEMO202600000002`)], [], picked).pick).toBeNull();
  });

  it('asks about a check digit that does not add up, with the likely number', () => {
    const typing = run([typed(TYPO)]);
    expect(survey(typing).typo).toBeNull();
    const shown = run([rested(TYPO)], [], typing);
    expect(survey(shown)).toMatchObject({ typo: { suggestion: 'LX123456785DE' }, need: 'typo' });
    // A paste shows the question at once and does not go on.
    expect(run([pasted(TYPO)])).toMatchObject({ job: null, intent: 'none' });
    expect(survey(run([pasted(TYPO)])).typo).not.toBeNull();
  });

  it('shows the question on a first Track and tracks as typed on the second', () => {
    const first = run([typed(TYPO), track]);
    expect(first.job).toBeNull();
    expect(survey(first).typo).not.toBeNull();
    const second = run([track], [], first);
    expect(second.asTyped).toBe(TYPO);
    expect(second.job).toEqual({ type: 'lookup', carrier: 'unknown', input: { trackingNumber: TYPO } });
  });

  it('tracks a number as typed when asked to, and the suggestion when that is taken', () => {
    const shown = run([typed(TYPO), rested(TYPO)]);
    expect(run([{ type: 'asTyped' }], [], shown).job).toMatchObject({ input: { trackingNumber: TYPO } });
    // The suggestion arrives like a paste: its carrier is certain, so it goes straight on.
    expect(run([pasted('LX123456785DE')], [], shown).job).toMatchObject({ input: { trackingNumber: 'LX123456785DE', carrier: 'dhl' } });
  });

  it('holds an Amazon order number back', () => {
    const typing = run([typed('302-4571983-2294617')]);
    expect(survey(typing)).toMatchObject({ order: false, match: null, need: 'order' });
    expect(survey(run([rested('302-4571983-2294617')], [], typing)).order).toBe(true);
    const pressed = run([track], [], typing);
    expect(survey(pressed)).toMatchObject({ order: true, nothing: false });
    expect(pressed.job).toBeNull();
    expect(run([pasted('302-4571983-2294617')]).job).toBeNull();
  });
});

describe('what a carrier asks for', () => {
  const GLS = 'gls-ch';

  it('asks for a required postcode before the lookup, and sends it only to that carrier', () => {
    const chosen = run([typed(SHARED), { type: 'choose', carrier: GLS }]);
    expect(survey(chosen)).toMatchObject({ need: 'input', fields: [{ field: 'dpdPostcode' }], missing: { field: 'dpdPostcode' } });
    const refused = run([track], [], chosen);
    expect(refused.job).toBeNull();
    expect(refused.trouble).toEqual({ kind: 'validation', message: 'error.postcode' });
    const filled = run([{ type: 'fill', carrier: GLS, field: 'dpdPostcode', value: '8004' }], [], refused);
    expect(filled.trouble).toBeNull();
    expect(run([track], [], filled).job).toEqual({ type: 'lookup', carrier: GLS, input: { trackingNumber: SHARED, carrier: GLS, dpdPostcode: '8004' } });
    // Another carrier never sees it.
    const other = run([{ type: 'choose', carrier: 'seur' }, track], [], filled);
    expect(other.job).toMatchObject({ input: { trackingNumber: SHARED, carrier: 'seur' } });
    expect(other.job).not.toHaveProperty('input.dpdPostcode');
  });

  it('refuses a postcode that cannot be one', () => {
    const state = run([typed(SHARED), { type: 'choose', carrier: GLS }, { type: 'fill', carrier: GLS, field: 'dpdPostcode', value: '80' }, track]);
    expect(state).toMatchObject({ job: null, trouble: { kind: 'validation', message: 'error.postcode' } });
  });

  it('offers an optional postcode once: a paste stops for it, a Track made before it showed stops once', () => {
    const answer: LookupEvent = { type: 'answer', answer: { trackingNumber: SHARED, carrier: 'dpd', asked: ['dpd'] } };
    // Pasted: the carrier turns out to offer an input, so the visitor is asked first.
    const pasting = run([pasted(SHARED), answer]);
    expect(pasting.job).toBeNull();
    expect(survey(pasting)).toMatchObject({ carrier: 'dpd', source: 'found', fields: [{ field: 'dpdPostcode', optional: true }], need: null });
    // With the field in front of them, Track goes on without it.
    expect(run([track], [], pasting).job).toEqual({ type: 'lookup', carrier: 'dpd', input: { trackingNumber: SHARED, carrier: 'dpd' } });
    // Typed: Track was pressed before the field existed.
    const pressed = run([typed(SHARED), track, answer]);
    expect(pressed.job).toBeNull();
    expect(pressed.offered).toBe(`dpd:${SHARED}`);
    const filled = run([{ type: 'fill', carrier: 'dpd', field: 'dpdPostcode', value: '8004' }, track], [], pressed);
    expect(filled.job).toMatchObject({ input: { trackingNumber: SHARED, carrier: 'dpd', dpdPostcode: '8004' } });
  });
});

describe('a number this device already follows', () => {
  const device: DeviceParcel[] = [{ id: 'k7Qm2xHd9RtW', number: UPS, carrier: 'ups' }];

  it('opens its link instead of spending a lookup', () => {
    expect(run([pasted(`1Z DEMO 2026 0000 0001`)], device).job).toEqual({ type: 'open', id: 'k7Qm2xHd9RtW' });
    const typing = run([typed(UPS)], device);
    expect(survey(typing, device)).toMatchObject({ source: 'device', onDevice: device[0], ask: null, fields: [] });
    expect(run([track], device, typing).job).toEqual({ type: 'open', id: 'k7Qm2xHd9RtW' });
  });

  it('looks up again when another carrier is chosen for the number', () => {
    const state = run([typed(UPS), { type: 'choose', carrier: 'dhl' }, track], device);
    expect(state.job).toMatchObject({ type: 'lookup', input: { trackingNumber: UPS, carrier: 'dhl' } });
  });

  it('does not question the check digit of a number it already follows', () => {
    const known: DeviceParcel[] = [{ id: 'm3Np8sVz4KcY', number: TYPO, carrier: 'unknown' }];
    expect(survey(run([typed(TYPO), rested(TYPO)], known), known)).toMatchObject({ typo: null, source: 'device' });
    expect(run([pasted(TYPO)], known).job).toEqual({ type: 'open', id: 'm3Np8sVz4KcY' });
  });

  it('needs no carrier to open a number nobody recognises', () => {
    const known: DeviceParcel[] = [{ id: 'm3Np8sVz4KcY', number: SHAPELESS, carrier: 'gls-ch' }];
    expect(run([pasted(SHAPELESS)], known).job).toEqual({ type: 'open', id: 'm3Np8sVz4KcY' });
  });
});

describe('Amazon numbers', () => {
  it('checks whether Amazon Shipping tracks the parcel publicly before any lookup', () => {
    const waiting = run([typed(AMAZON), track]);
    expect(waiting.job).toBeNull();
    expect(survey(waiting)).toMatchObject({ amazon: true, account: 'checking', ask: AMAZON, need: 'wait' });
    const confirmed = run([{ type: 'answer', answer: { trackingNumber: AMAZON, carrier: 'amazon-shipping', amazonShippingStatus: 'available' } }], [], waiting);
    expect(confirmed.job).toEqual({ type: 'lookup', carrier: 'amazon-shipping', input: { trackingNumber: AMAZON, carrier: 'amazon-shipping' } });
  });

  it('sends the visitor to their Amazon account when the parcel is not public', () => {
    const state = run([pasted(AMAZON), { type: 'answer', answer: { trackingNumber: AMAZON, carrier: 'amazon-logistics', amazonShippingStatus: 'not-found' } }]);
    expect(state.job).toBeNull();
    expect(survey(state)).toMatchObject({ account: 'required', need: 'account', carrier: 'amazon-logistics', certain: false });
    expect(run([track], [], state).job).toBeNull();
  });

  it('offers to check again when Amazon gave no answer', () => {
    const state = run([pasted(AMAZON), { type: 'answer', answer: unanswered(AMAZON) }]);
    expect(survey(state)).toMatchObject({ account: 'unavailable', ask: null });
    const again = run([{ type: 'recheck' }], [], state);
    expect(survey(again)).toMatchObject({ account: 'checking', ask: AMAZON });
  });

  it('holds back a carrier chosen by hand that only the Amazon account can track', () => {
    const state = run([typed(SHAPELESS), { type: 'choose', carrier: 'amazon-logistics' }, track]);
    expect(survey(state).account).toBe('required');
    expect(state.job).toBeNull();
  });
});

describe('trouble', () => {
  const opening = run([typed(UPS), track]);

  it('counts a burst limit down and refuses Track meanwhile', () => {
    const limited = run([{ type: 'failed', trouble: { kind: 'burst', until: 42_000 } }], [], opening);
    expect(limited).toMatchObject({ job: null, text: UPS, trouble: { kind: 'burst' } });
    expect(secondsLeft(limited.trouble, 0)).toBe(42);
    expect(secondsLeft(limited.trouble, 41_001)).toBe(1);
    expect(secondsLeft(limited.trouble, 42_000)).toBe(0);
    expect(secondsLeft(limited.trouble, 99_000)).toBe(0);
    expect(countdown(42)).toBe('0:42');
    expect(countdown(125)).toBe('2:05');
    expect(run([track], [], limited)).toBe(limited);
    // Editing or pasting does not get around the wait.
    expect(run([typed('1ZDEMO202600000002'), pasted(UPS)], [], limited)).toMatchObject({ job: null, trouble: { kind: 'burst' } });
    const cooled = run([{ type: 'cooled' }], [], limited);
    expect(cooled.trouble).toBeNull();
    expect(run([track], [], cooled).job).toMatchObject({ type: 'lookup' });
  });

  it('keeps the day’s refusal through an edit, and lets Track ask again', () => {
    const refused = run([{ type: 'failed', trouble: { kind: 'daily' } }], [], opening);
    expect(secondsLeft(refused.trouble, 0)).toBe(0);
    expect(run([typed('1ZDEMO202600000002')], [], refused).trouble).toEqual({ kind: 'daily' });
    expect(run([track], [], refused)).toMatchObject({ trouble: null, job: { type: 'lookup' } });
  });

  it('loses nothing from the field when offline or when the service fails, and clears with the next edit', () => {
    for (const kind of ['offline', 'server'] as const) {
      const failed = run([{ type: 'failed', trouble: { kind } }], [], opening);
      expect(failed).toMatchObject({ job: null, text: UPS, trouble: { kind } });
      expect(run([track], [], failed).job).toMatchObject({ type: 'lookup' });
      expect(run([typed(`${UPS} `)], [], failed).trouble).toBeNull();
    }
    const offline = run([{ type: 'failed', trouble: { kind: 'offline' } }], [], opening);
    expect(run([{ type: 'online' }], [], offline).trouble).toBeNull();
    expect(run([{ type: 'online' }], [], opening)).toBe(opening);
  });

  it('shows what the server refused about the input', () => {
    const refused = run([{ type: 'failed', trouble: { kind: 'validation', message: 'error.trackingNumber' } }], [], opening);
    expect(refused.trouble).toEqual({ kind: 'validation', message: 'error.trackingNumber' });
    expect(run([typed('1ZDEMO202600000002')], [], refused).trouble).toBeNull();
  });

  it('notes why Paste could not paste until the field changes', () => {
    const blocked = run([{ type: 'pasteFailed', reason: 'blocked' }]);
    expect(blocked.paste).toBe('blocked');
    expect(run([typed('1')], [], blocked).paste).toBeNull();
    expect(run([{ type: 'pasteFailed', reason: 'empty' }]).paste).toBe('empty');
  });
});
