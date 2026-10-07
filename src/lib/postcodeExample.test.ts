import { describe, expect, it } from 'vitest';
import postcodes from '../../shared/postcode-examples.json';
import { carrierRequirements, requirementSatisfied, typedRequirementValue } from './carriers';
import { deviceCountry, lettersPostcode, postcodeExample } from './postcodeExample';

const dpd = carrierRequirements('dpd', '06080000000002')[0]!;
const dpdGermany = carrierRequirements('dpd-de', '06080000000002')[0]!;

describe('postcode examples', () => {
  it("reads the country from the device's clock, then from its languages", () => {
    expect(deviceCountry('Europe/Paris', ['en-US'])).toBe('FR');
    expect(deviceCountry('Europe/Zurich', ['fr-FR'])).toBe('CH');
    expect(deviceCountry('America/Chicago', ['es', 'en-US'])).toBe('US');
    expect(deviceCountry('America/Toronto', ['fr_CA'])).toBe('CA');
    expect(deviceCountry('Australia/Perth', ['zh-Hant-AU'])).toBe('AU');
    expect(deviceCountry('Etc/UTC', ['en'])).toBeNull();
    expect(deviceCountry('', ['en-ZZ'])).toBeNull();
  });

  it("shows the reader's country where a carrier takes any postcode", () => {
    expect(dpd.placeholder).toBeUndefined();
    expect(postcodeExample('dpd', dpd, 'FR')).toBe('75001');
    expect(postcodeExample('dpd', dpd, 'GB')).toBe('SW1A 1AA');
    // The carrier's own country when the device does not tell, or tells one without an example.
    expect(postcodeExample('dpd', dpd, null)).toBe('8000');
    expect(postcodeExample('dpd', dpd, 'BR')).toBe('8000');
  });

  it("keeps a national carrier's own example", () => {
    expect(postcodeExample('dpd-de', dpdGermany, 'FR')).toBe('10115');
    expect(postcodeExample('gls-ch', carrierRequirements('gls-ch', '12345678')[0]!, 'FR')).toBe('8000');
  });

  it('offers only examples the wide field accepts, for countries the clocks name', () => {
    for (const example of Object.values(postcodes.examples)) {
      expect(requirementSatisfied(dpd, example), example).toBe(true);
    }
    for (const country of Object.values(postcodes.timeZones)) {
      expect(postcodes.examples, country).toHaveProperty(country);
    }
  });

  it('keeps single spaces while a postcode is typed and digits in a numeric one', () => {
    expect(lettersPostcode(dpd)).toBe(true);
    expect(lettersPostcode(dpdGermany)).toBe(false);
    expect(typedRequirementValue(dpd, ' sw1a  1aa ')).toBe('sw1a 1aa ');
    expect(typedRequirementValue(dpdGermany, '10 115x9')).toBe('10115');
  });
});
