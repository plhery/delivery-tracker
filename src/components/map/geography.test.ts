import { geoContains } from 'd3-geo';
import { describe, expect, it } from 'vitest';
import { cities, countryLabel, geography, loadWorld } from './geography';

describe('geography', () => {
  it('waits for the map data before handing out shapes', async () => {
    expect(() => geography('coarse')).toThrow('The map data has not loaded yet');
    await loadWorld();
    const coarse = geography('coarse');
    expect(geography('coarse')).toBe(coarse);
    const switzerland = coarse.countries.get('CH')!;
    expect(switzerland.name).toBe('Switzerland');
    expect(geoContains(switzerland.shape, [7.45, 46.95])).toBe(true);
    expect(geoContains(switzerland.shape, [2.35, 48.86])).toBe(false);
    expect(countryLabel('CH')).toEqual(switzerland.label);
    expect(countryLabel('XX')).toBeNull();
    // Each part carries a cap that holds all of it, so views can skip what they cannot see.
    for (const part of coarse.land.slice(0, 20)) expect(part.radius).toBeGreaterThanOrEqual(0);
    expect(geography('fine').borders.length).toBeGreaterThan(coarse.borders.length / 2);
    expect(geography('fine').lakes.length).toBeGreaterThan(0);
  });

  it('lists major cities, most prominent first', async () => {
    await loadWorld();
    const list = cities();
    expect(cities()).toBe(list);
    expect(list.length).toBeGreaterThan(50);
    expect(list.map((city) => city.name)).toContain('Tokyo');
    expect(list[0].rank).toBeLessThanOrEqual(list.at(-1)!.rank);
  });
});
