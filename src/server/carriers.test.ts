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

describe('optional carrier inputs', () => {
  const dpdNumber = '06080000000001';

  it('lets DPD track without a postcode and still checks one that is supplied', () => {
    expect(normalizeCarrierInputs('dpd', dpdNumber, '', '')).toEqual({ trackingUrl: null, dpdPostcode: null });
    expect(normalizeCarrierInputs('dpd', dpdNumber, '', ' 8000 ').dpdPostcode).toBe('8000');
    expect(() => normalizeCarrierInputs('dpd', dpdNumber, '', '800')).toThrow('postcode');
    expect(() => normalizeCarrierInputs('dpd', dpdNumber, 'https://example.com', '')).toThrow('tracking URL');
  });

  it('keeps the other postcode carriers required', () => {
    expect(() => normalizeCarrierInputs('gls-ch', '993990103198', '', '')).toThrow('postcode');
    expect(() => normalizeCarrierInputs('gls-de', '123456789018', '', '')).toThrow('postcode');
    expect(() => normalizeCarrierInputs('heppner', '23456789', '', '')).toThrow('postcode');
    expect(() => normalizeCarrierInputs('paack', 'PAACK12345', '', '')).toThrow('postcode');
    expect(() => normalizeCarrierInputs('ups', '1Z999AA10123456784', '', '8000')).toThrow('not used');
  });
});
