import { describe, expect, it } from 'vitest';
import {
  detectCarrier,
  detectCarrierMatch,
  formatTrackingNumber,
  isValidMondialRelayBarcode,
  isValidS10TrackingNumber,
  normalizeTrackingNumber,
  parseTrackingInput,
  supportsSwissPostHandoff,
} from './index';

/**
 * The per-carrier number expectations live in src/lib/carriers.test.ts until
 * the corpus sweep replaces them. What this file pins down is the engine
 * itself, and in particular the one behaviour that had two implementations
 * before the move: the server copy of the S10 check skipped normalization.
 */
describe('S10, with one implementation for the client and the server', () => {
  it('agrees with the former server implementation on already-normalized input', () => {
    expect(isValidS10TrackingNumber('RA123456785CH')).toBe(true);
    expect(isValidS10TrackingNumber('RA123456789CH')).toBe(false);
    expect(isValidS10TrackingNumber('RA12345678CH')).toBe(false);
    expect(supportsSwissPostHandoff('LW230226618CH')).toBe(true);
    expect(supportsSwissPostHandoff('LW230226619CH')).toBe(false);
    expect(supportsSwissPostHandoff('RR230226618CH')).toBe(false);
  });

  it('now also accepts the printed spelling the server copy used to reject', () => {
    expect(isValidS10TrackingNumber('ra 123.456-785 ch')).toBe(true);
    expect(supportsSwissPostHandoff('lw 230 226 618 ch')).toBe(true);
  });
});

describe('normalization', () => {
  it('uppercases and strips the separators carriers print', () => {
    expect(normalizeTrackingNumber(' ra 123 456-789 ch ')).toBe('RA123456789CH');
    expect(formatTrackingNumber('993412345612345678')).toBe('99.34.123456.12345678');
  });
});

describe('the detection engine', () => {
  it('selects a carrier only when exactly one rule claims high confidence', () => {
    expect(detectCarrier('RA123456785CH')).toBe('swiss-post');
    expect(detectCarrierMatch('RA123456785CH')).toMatchObject({ carrier: 'swiss-post', confidence: 'high' });
    expect(detectCarrierMatch('')).toEqual({ carrier: 'unknown', confidence: 'none', candidates: [] });
  });

  it('rejects a number whose declared checksum does not verify', () => {
    expect(detectCarrier('RA123456789CH')).toBe('unknown');
    expect(isValidMondialRelayBarcode('12123456780101006623123454')).toBe(true);
    expect(isValidMondialRelayBarcode('12123456780101006623123455')).toBe(false);
  });

  it('reads a number out of a pasted carrier link', () => {
    expect(parseTrackingInput('https://service.post.ch/ekp-web/ui/entry/search/RA123456785CH'))
      .toMatchObject({ trackingNumber: 'RA123456785CH', carrier: 'swiss-post', source: 'link' });
  });
});
