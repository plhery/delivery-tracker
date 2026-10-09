import { describe, expect, it } from 'vitest';
import catalog from '../../../shared/analytics.json';
import { initialLookup, lookupStep, survey, type LookupEvent, type LookupState } from './machine';
import { DOOR_STOPS, doorStops } from './stops';

// Every number here is fictional.
const UPS = '1ZDEMO202600000001';
const SHARED = '01234567890123';
const TYPO = 'LX1234567B5DE';

const run = (events: LookupEvent[], from: LookupState = initialLookup()) => events.reduce((state, event) => lookupStep(state, event), from);
const stops = (state: LookupState) => doorStops(state, survey(state));
const pasted = (text: string): LookupEvent => ({ type: 'edit', text, via: 'paste' });
const typed = (text: string): LookupEvent => ({ type: 'edit', text, via: 'typing' });

describe('what stops the door', () => {
  it('has a name the usage counts know for every stop', () => {
    for (const name of Object.values(DOOR_STOPS)) expect(catalog.actions).toContain(name);
  });

  it('names nothing while the text is a number the door can go on with, or half typed', () => {
    expect(stops(initialLookup())).toEqual([]);
    expect(stops(run([pasted(UPS)]))).toEqual([]);
    expect(stops(run([typed('hello')]))).toEqual([]);
  });

  it('names each notice or question the door shows', () => {
    expect(stops(run([pasted('Thanks for your order!')]))).toEqual(['door-no-number']);
    expect(stops(run([pasted('302-4571983-2294617')]))).toEqual(['door-order-number']);
    expect(stops(run([pasted(TYPO)]))).toEqual(['door-check-digit']);
    expect(stops(run([pasted(`UPS ${UPS}\nUPS 1ZDEMO202600000029`)]))).toEqual(['door-several-numbers']);
    const several = run([pasted(SHARED), { type: 'answer', answer: { trackingNumber: SHARED, carrier: 'unknown', recognized: ['dpd', 'seur'], asked: ['dpd', 'seur'] } }]);
    expect(stops(several)).toEqual(['door-several-carriers']);
    // A carrier chosen is the question answered.
    expect(stops(run([{ type: 'choose', carrier: 'seur' }], several))).toEqual([]);
    const postcode = run([pasted(SHARED), { type: 'answer', answer: { trackingNumber: SHARED, carrier: 'gls-ch', asked: ['gls-ch'] } }]);
    expect(stops(postcode)).toEqual(['door-carrier-input']);
    expect(stops(run([{ type: 'submit' }], postcode))).toEqual(['door-carrier-input']);
  });

  it('names the trouble a lookup met, and a refusal that stands beside no field', () => {
    const typedUps = run([typed(UPS)]);
    expect(stops(run([{ type: 'failed', trouble: { kind: 'burst', until: 0 } }], typedUps))).toEqual(['door-limit-minute']);
    expect(stops(run([{ type: 'failed', trouble: { kind: 'daily' } }], typedUps))).toEqual(['door-limit-day']);
    expect(stops(run([{ type: 'failed', trouble: { kind: 'offline' } }], typedUps))).toEqual(['door-offline']);
    expect(stops(run([{ type: 'failed', trouble: { kind: 'server' } }], typedUps))).toEqual(['door-server-error']);
    expect(stops(run([{ type: 'failed', trouble: { kind: 'verification' } }], typedUps))).toEqual(['door-verification']);
    expect(stops(run([{ type: 'failed', trouble: { kind: 'validation', message: 'error.trackingNumber' } }], typedUps))).toEqual(['door-refused']);
  });
});
