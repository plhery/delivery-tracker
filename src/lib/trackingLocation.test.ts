import { afterEach, describe, expect, it, vi } from 'vitest';
import { countryFlag, countryName, trackingLocationCountry, trackingPlace } from './trackingLocation';

describe('tracking places', () => {
  it.each([
    ['Zürich, Schweiz', 'CH', 'Zürich'], ['Bâle (Suisse)', 'CH', 'Bâle'], ['Milano, Italia', 'IT', 'Milano'],
    ['Paris; France', 'FR', 'Paris'], ['London, UK', 'GB', 'London'], ['ZUERICH, CH', 'CH', 'ZUERICH'],
    ['Zürich (Mülligen), CH', 'CH', 'Zürich (Mülligen)'], ['Hebron, KY, US, US', 'US', 'Hebron, KY'],
    ['Switzerland Haerkingen', 'CH', 'Haerkingen'], ['United Kingdom Coventry', 'GB', 'Coventry'],
    ['Shenzhen-Futian, China', 'CN', 'Shenzhen-Futian'],
  ])('takes the country off %s', (location, country, place) => {
    expect(trackingPlace(location)).toEqual({ country, place });
  });

  it.each([
    ['France', 'FR'], ['DE', 'DE'], ['CH ', 'CH'], ['THE NETHERLANDS', 'NL'], ['Czech Republic', 'CZ'], ['Hong Kong', 'HK'],
  ])('leaves no place when %s is only a country', (location, country) => {
    expect(trackingPlace(location)).toEqual({ country, place: '' });
  });

  it.each([
    '', 'Warehouse', 'Paris', 'Buchs AG', 'Basel, BS', 'Wilmington, DE', 'France distribution center',
    'Zürich Briefzentrum', 'Mexico City', 'Andorra la Vella',
  ])('keeps %s whole without guessing a country', (location) => {
    expect(trackingPlace(location)).toEqual({ country: null, place: location });
  });

  it('keeps Passport evidence to a final field that names a region', () => {
    expect(trackingLocationCountry('Zürich, CH')).toBe('CH');
    expect(trackingLocationCountry('Switzerland Haerkingen')).toBeNull();
    expect(trackingLocationCountry('Czech Republic')).toBeNull();
  });

  afterEach(() => vi.restoreAllMocks());

  it('reads and names China where the runtime calls it “China mainland”, as Safari does', async () => {
    const of = Intl.DisplayNames.prototype.of;
    vi.spyOn(Intl.DisplayNames.prototype, 'of').mockImplementation(function (this: Intl.DisplayNames, code: string) {
      return code === 'CN' ? 'China mainland' : of.call(this, code);
    });
    vi.resetModules();
    const fresh = await import('./trackingLocation');
    expect(fresh.trackingPlace('Shenzhen, China')).toEqual({ country: 'CN', place: 'Shenzhen' });
    expect(fresh.trackingLocationCountry('Canton, Chine')).toBe('CN');
    expect(fresh.countryName('CN', 'en-GB')).toBe('China');
    expect(fresh.countryName('CN', 'fr')).toBe('Chine');
  });

  it('names the country in the reader’s language', () => {
    expect(countryFlag('CH')).toBe('🇨🇭');
    expect(countryName('CZ', 'de')).toBe('Tschechien');
    expect(countryName('FI', 'fr')).toBe('Finlande');
    expect(countryName('HK', 'en')).toBe('Hong Kong');
  });
});
