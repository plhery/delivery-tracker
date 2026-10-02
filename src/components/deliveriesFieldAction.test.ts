import { describe, expect, it } from 'vitest';
import { unanswered } from '../peek/lookup/machine';
import { fieldAction, followedParcels } from './deliveriesFieldAction';

const followed = followedParcels([
  { id: 'sneakers', trackingNumber: '1234567899', carrier: 'dhl' },
  { id: 'vinyl', trackingNumber: '1ZDEMO202600000001', carrier: 'ups' },
]);

describe('what the deliveries field does with a text', () => {
  it('adds a number whose shape names one carrier', () => {
    expect(fieldAction('1ZDEMO202600000009', followed)).toEqual({
      type: 'add',
      shown: '1ZDEMO202600000009',
      input: { trackingNumber: '1ZDEMO202600000009', label: '', carrier: 'ups' },
    });
  });

  it('reads the number out of a message, and keeps it as written', () => {
    const action = fieldAction('Your parcel is on its way.\nTrack 99.34.111111.22222222 with Swiss Post.', followed);
    expect(action).toMatchObject({ type: 'add', input: { trackingNumber: '99.34.111111.22222222', carrier: 'swiss-post' } });
  });

  it('opens a number the deliveries already hold, however it is spelled', () => {
    expect(fieldAction('1Z DEMO 2026 0000 0001', followed)).toEqual({ type: 'open', id: 'vinyl' });
    expect(fieldAction('1234567899', followed)).toEqual({ type: 'open', id: 'sneakers' });
  });

  it('asks the carriers that share a shape, then adds with the one that has the parcel', () => {
    const asking = fieldAction('01234567890123', followed);
    expect(asking).toMatchObject({ type: 'ask', number: '01234567890123' });
    expect(asking.type === 'ask' && asking.carriers).toContain('dpd');
    // DPD's postcode is optional: nothing holds the add back.
    expect(fieldAction('01234567890123', followed, { trackingNumber: '01234567890123', carrier: 'dpd', asked: ['dpd', 'seur'] }))
      .toMatchObject({ type: 'add', input: { trackingNumber: '01234567890123', carrier: 'dpd' } });
  });

  it('leaves the choice to the Add sheet when the carriers do not settle it', () => {
    const number = '01234567890123';
    expect(fieldAction(number, followed, { trackingNumber: number, carrier: 'unknown', recognized: ['dpd', 'seur'], asked: ['dpd', 'seur'] })).toEqual({ type: 'sheet' });
    expect(fieldAction(number, followed, { trackingNumber: number, carrier: 'unknown', asked: ['dpd', 'seur'] })).toEqual({ type: 'sheet' });
    expect(fieldAction(number, followed, unanswered(number))).toEqual({ type: 'sheet' });
  });

  it('hands everything that needs the person to the Add sheet', () => {
    // Nothing, and no number.
    expect(fieldAction('', followed)).toEqual({ type: 'sheet' });
    expect(fieldAction('hello there', followed)).toEqual({ type: 'sheet' });
    // Several numbers in one text.
    expect(fieldAction('1ZDEMO202600000008 and 1ZDEMO202600000009', followed)).toEqual({ type: 'sheet' });
    // A postal number whose check digit does not add up.
    expect(fieldAction('RR123456780CH', followed)).toEqual({ type: 'sheet' });
    // Amazon: an order number, and a parcel tracked in the Amazon account.
    expect(fieldAction('123-1234567-1234567', followed)).toEqual({ type: 'sheet' });
    expect(fieldAction('TBA123456789012', followed)).toEqual({ type: 'sheet' });
    // A carrier that requires the delivery postcode.
    expect(fieldAction('https://gls-group.eu/DE/de/paketverfolgung?match=123456789018', followed)).toEqual({ type: 'sheet' });
  });
});
