import { describe, expect, it } from 'vitest';
import { brandCarrierForNumber, universalCarrierHints } from './hints';

describe('carrier names reported by universal providers', () => {
  it('resolves a bare brand only when the number leaves one of its networks', () => {
    // DPD's depot prefix: 0606-0619 Switzerland, 10xx France (ex-Exapaq).
    expect(brandCarrierForNumber('DPD Group', '06080000000002')).toBe('dpd');
    expect(brandCarrierForNumber('dpd', '10000000000001')).toBe('dpd-fr');
    // A DPD France 250… number is its own high-confidence shape.
    expect(brandCarrierForNumber('DPD', '250000000000000')).toBe('dpd-fr');
    // Both DPD networks match and neither is preferred.
    expect(brandCarrierForNumber('DPD Group', '06200000000002')).toBeUndefined();
    // Only DPD Switzerland accepts a 14-digit number starting with 2-9.
    expect(brandCarrierForNumber('DPD Group', '20000000000002')).toBe('dpd');
    // The number is no network of the brand at all.
    expect(brandCarrierForNumber('GLS', '06080000000002')).toBeUndefined();
    // Not a bare brand.
    expect(brandCarrierForNumber('Swiss Post', '06080000000002')).toBeUndefined();
  });

  it('proposes one carrier only for a single, resolvable name', () => {
    expect(universalCarrierHints(['DPD Group'], '06080000000002')).toEqual({
      reported_carriers: ['DPD Group'], discovered_carrier: 'dpd',
    });
    // Without the number a brand stays a hint, as before.
    expect(universalCarrierHints(['DPD Group'])).toEqual({ reported_carriers: ['DPD Group'] });
    expect(universalCarrierHints(['DPD Group', 'DPD Group ', 7, null], '06080000000002').discovered_carrier).toBe('dpd');
    expect(universalCarrierHints(['Swiss Post', 'DPD Group'], '06080000000002')).toEqual({
      reported_carriers: ['Swiss Post', 'DPD Group'],
    });
  });
});
