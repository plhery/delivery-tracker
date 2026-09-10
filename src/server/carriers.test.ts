import { describe, expect, it } from 'vitest';
import { normalizeCarrierInputs } from './carriers';

describe('Mondial Relay label barcode inputs', () => {
  const barcode = '12123456780101006623123454'; // Official specification example.

  it('accepts a verified barcode without a postcode and preserves optional legacy postcodes', () => {
    expect(normalizeCarrierInputs('mondial-relay', barcode, '', '')).toEqual({ trackingUrl: null, dpdPostcode: null });
    expect(normalizeCarrierInputs('mondial-relay', barcode, '', '75001').dpdPostcode).toBe('75001');
  });

  it('rejects invalid barcodes and postcodes without weakening short-number requirements', () => {
    expect(() => normalizeCarrierInputs('mondial-relay', '12123456780101006623123455', '', '')).toThrow('barcode');
    expect(() => normalizeCarrierInputs('mondial-relay', barcode, '', 'bad')).toThrow('postcode');
    expect(() => normalizeCarrierInputs('mondial-relay', '12345678', '', '')).toThrow('postcode');
    expect(() => normalizeCarrierInputs('mondial-relay', barcode, 'https://example.com', '')).toThrow('tracking URL');
  });
});
