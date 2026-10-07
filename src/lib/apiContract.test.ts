import { describe, expect, it } from 'vitest';
import contract from '../../contracts/openapi.json';

describe('postcode API contract', () => {
  it('accepts supported raw request formats and rejects malformed separators', () => {
    const pattern = new RegExp(
      contract.components.schemas.CreatePackageRequest.properties.dpdPostcode.pattern,
    );
    for (const value of ['8000', '75001', '75 001', 'SW1A 1AA', '4445-027', '123456789012']) {
      expect(pattern.test(value), value).toBe(true);
    }
    for (const value of ['ABC', '12--345', '12 - 345', '75001_', '1234567890123']) {
      expect(pattern.test(value), value).toBe(false);
    }
  });

  it('documents the canonical uppercase response format, in groups joined by one space or hyphen', () => {
    const pattern = new RegExp(
      contract.components.schemas.PackageRow.properties.dpd_postcode.pattern,
    );
    for (const value of ['8000', '75001', 'SW1A1AA', 'SW1A 1AA', '4445-027']) {
      expect(pattern.test(value), value).toBe(true);
    }
    for (const value of ['SW1A  1AA', ' 8000', 'abc1', '12--345']) {
      expect(pattern.test(value), value).toBe(false);
    }
  });
});
