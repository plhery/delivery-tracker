import { describe, expect, it } from 'vitest';
import { recognitionCandidates, recognizeAll, settleRecognition, type RecognitionOutcome } from './carrierRecognition';

const outcome = (carrier: string, status: RecognitionOutcome['status'], extra: Partial<RecognitionOutcome> = {}): RecognitionOutcome => ({
  carrier, status, needsInput: null, preferred: false, lastActivityAt: null, ...extra,
});
const now = new Date('2026-09-10T12:00:00Z');

describe('recognition candidates', () => {
  it('keeps the carriers that can answer, hint first, then number evidence, then popularity', () => {
    expect(recognitionCandidates('12345678901231').map((candidate) => candidate.carrier)).toEqual(['dpd', 'seur', 'brt', 'hermes-de', 'ciblex']);
    expect(recognitionCandidates('06080000000002')).toEqual([
      { carrier: 'dpd', needsInput: null, preferred: true },
      { carrier: 'seur', needsInput: null, preferred: false },
      { carrier: 'brt', needsInput: null, preferred: false },
      { carrier: 'ciblex', needsInput: null, preferred: false },
    ]);
    expect(recognitionCandidates('12345678901', { hint: 'gls-de' })).toEqual([
      { carrier: 'gls-de', needsInput: 'dpdPostcode', preferred: false },
      { carrier: 'gls-ch', needsInput: 'dpdPostcode', preferred: false },
    ]);
    expect(recognitionCandidates('06080000000002', { skip: (carrier) => carrier === 'dpd' }).map((candidate) => candidate.carrier))
      .toEqual(['seur', 'brt', 'ciblex']);
    // A selected carrier needs no recognition.
    expect(recognitionCandidates('1Z999AA10123456784')).toEqual([]);
    // A DPD France depot: DPD France cannot be asked, and DPD Switzerland's
    // group-wide answer would file its parcel under the wrong network.
    expect(recognitionCandidates('10000000000001').map((candidate) => candidate.carrier)).toEqual(['seur', 'brt', 'ciblex']);
  });

  it('can ask bpost about an ambiguous numeric barcode without a recipient postcode', () => {
    expect(recognitionCandidates('000000000000000000000001')).toEqual(expect.arrayContaining([
      { carrier: 'bpost', needsInput: null, preferred: false },
    ]));
  });
});

describe('asking carriers', () => {
  it('asks all at once and treats a failure or a late answer as no answer', async () => {
    const started: string[] = [];
    const outcomes = await recognizeAll(recognitionCandidates('12345678901231'), async (carrier) => {
      started.push(carrier);
      if (carrier === 'dpd') return { known: true, lastActivityAt: '2026-09-09T08:00:00Z' };
      if (carrier === 'hermes-de') throw new Error('upstream down');
      if (carrier === 'seur' || carrier === 'brt') return { known: false };
      return new Promise(() => undefined);
    }, 20);
    expect(started).toEqual(['dpd', 'seur', 'brt', 'hermes-de', 'ciblex']);
    expect(outcomes.map(({ carrier, status }) => [carrier, status])).toEqual([
      ['dpd', 'known'], ['seur', 'unknown'], ['brt', 'unknown'], ['hermes-de', 'failed'], ['ciblex', 'failed'],
    ]);
    expect(outcomes[0].lastActivityAt).toBe('2026-09-09T08:00:00Z');
  });
});

describe('settling on a carrier', () => {
  it('picks the only recent answer', () => {
    expect(settleRecognition([outcome('dpd', 'known'), outcome('ciblex', 'unknown'), outcome('hermes-de', 'failed')], now))
      .toEqual({ carrier: 'dpd', choices: [] });
    expect(settleRecognition([outcome('dpd', 'known', { lastActivityAt: '2026-01-02T00:00:00Z' }), outcome('ciblex', 'known')], now))
      .toEqual({ carrier: 'ciblex', choices: [] });
    expect(settleRecognition([outcome('dpd', 'unknown')], now)).toEqual({ choices: [] });
  });
  it('prefers number evidence, then one brand\'s most common network, and otherwise lets the user choose', () => {
    expect(settleRecognition([outcome('dpd', 'known', { preferred: true }), outcome('ciblex', 'known')], now))
      .toEqual({ carrier: 'dpd', choices: [] });
    expect(settleRecognition([outcome('gls-de', 'known'), outcome('gls-ch', 'known')], now))
      .toEqual({ carrier: 'gls-ch', choices: [] });
    expect(settleRecognition([outcome('dpd', 'known'), outcome('hermes-de', 'known')], now))
      .toEqual({ choices: ['dpd', 'hermes-de'] });
    expect(settleRecognition([outcome('seur', 'known'), outcome('brt', 'known')], now))
      .toEqual({ choices: ['seur', 'brt'] });
  });
});
