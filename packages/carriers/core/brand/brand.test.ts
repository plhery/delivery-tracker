import { describe, expect, it } from 'vitest';
import { CARRIER_DEFINITIONS } from '../catalog/definitions';
import {
  BRAND_DERIVATION,
  BRAND_PROPERTIES,
  CARRIER_DECALS,
  CARRIER_PALETTES,
  CARRIER_TRUCK,
  DEFAULT_CARRIER_COLOR,
  FALLBACK_BRAND_COLOR,
  carrierBrand,
  carrierBrandFamily,
  carrierDecal,
  mix,
} from './index';

const HEX = /^#[\da-f]{6}$/;

describe('carrier brand', () => {
  it('derives the nine properties from the catalog color', () => {
    const palette = carrierBrand('#ffcc00');
    expect(Object.keys(palette)).toEqual([...BRAND_PROPERTIES]);
    expect(Object.values(palette).every((value) => HEX.test(value))).toBe(true);
    // The truck wears the carrier color itself, and the accent is plain white.
    expect(palette.truck).toBe('#ffcc00');
    expect(palette.accent).toBe('#ffffff');
  });

  it('lets a declared palette win property by property', () => {
    const palette = carrierBrand('#ffcc00', { truck: '#123456' });
    expect(palette.truck).toBe('#123456');
    expect(palette.edge).toBe(mix('#ffcc00', '#000000', 0.2));
  });

  it('falls back when the catalog color is not a hex literal', () => {
    expect(carrierBrand('not-a-color').truck).toBe(FALLBACK_BRAND_COLOR);
  });

  it('gives the GLS countries one family, one palette and no livery', () => {
    const gls = ['gls-ch', 'gls-de', 'gls-fr'];
    expect(gls.map(carrierBrandFamily)).toEqual(['gls', 'gls', 'gls']);
    expect(gls.map((id) => CARRIER_PALETTES[id])).toEqual(gls.map(() => CARRIER_PALETTES['gls-ch']));
    expect(gls.map(carrierDecal)).toEqual(['default', 'default', 'default']);
  });

  it('keeps a carrier that declares nothing on its own identity', () => {
    expect(carrierBrandFamily('swiss-post')).toBe('swiss-post');
    expect(CARRIER_PALETTES['swiss-post']).toBeUndefined();
    expect(carrierDecal('swiss-post')).toBe('default');
  });

  it('declares palettes and liveries only for carriers the catalog knows', () => {
    for (const [id, palette] of Object.entries(CARRIER_PALETTES)) {
      expect(CARRIER_DEFINITIONS).toHaveProperty(id);
      expect(Object.keys(palette).every((property) => BRAND_PROPERTIES.includes(property as never))).toBe(true);
    }
    for (const [id, decal] of Object.entries(CARRIER_DECALS)) {
      expect(CARRIER_DEFINITIONS).toHaveProperty(id);
      expect(CARRIER_TRUCK.decals).toHaveProperty(decal);
    }
  });

  it('names the color the catalog gives carriers without an accent', () => {
    const colors = Object.values(CARRIER_DEFINITIONS).map((definition) => definition.color);
    expect(colors.filter((color) => color === DEFAULT_CARRIER_COLOR).length).toBeGreaterThan(1);
  });

  it('paints the truck with brand properties and literals only', () => {
    const paints = [
      CARRIER_TRUCK.body.fill, CARRIER_TRUCK.body.stroke, CARRIER_TRUCK.cab.fill, CARRIER_TRUCK.cab.stroke,
      CARRIER_TRUCK.windshield.fill, CARRIER_TRUCK.wheels.tire.fill, CARRIER_TRUCK.wheels.hub.fill,
      ...Object.values(CARRIER_TRUCK.decals).flatMap((shapes) =>
        shapes.map((shape) => (shape.type === 'line' ? shape.stroke : shape.fill))),
    ];
    for (const paint of paints) {
      expect(HEX.test(paint) || BRAND_PROPERTIES.includes(paint as never)).toBe(true);
    }
  });

  it('mixes every property towards a base color', () => {
    expect(BRAND_DERIVATION.map((step) => step.property)).toEqual([...BRAND_PROPERTIES]);
    expect(BRAND_DERIVATION.every((step) => HEX.test(step.base) && step.amount >= 0 && step.amount <= 1)).toBe(true);
  });
});
