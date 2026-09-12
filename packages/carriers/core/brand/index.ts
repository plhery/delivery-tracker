/**
 * The carrier visual identity, stated once.
 *
 * What it is: the two named colors every client falls back to, the `mix()` that
 * derives a palette from a carrier's catalog color, the explicit palettes and
 * liveries declared in the carrier folders, and the truck geometry the web SVG
 * and the SwiftUI canvas both render.
 * What it is not: no rendering. The web reads this module, the iPhone reads the
 * same data through `ios/SwissDeliveryTracker/Resources/Brand.json`, and a test
 * on each side fails when either drawing drifts from it.
 *
 * The palettes, liveries and truck are data: `carriers/<id>/carrier.json` owns
 * `brand.palette` and `brand.decal`, `truck.json` owns the geometry, and
 * `packages/carriers/scripts/generate-brand.mjs` projects both into
 * `packages/carriers/generated/brand.ts` and `Brand.json`.
 */
import {
  CARRIER_DECALS as GENERATED_DECALS,
  CARRIER_FAMILIES as GENERATED_FAMILIES,
  CARRIER_PALETTES as GENERATED_PALETTES,
  CARRIER_TRUCK as GENERATED_TRUCK,
} from '../../generated/brand';
import paletteData from './palette.json';
import type {
  BrandDerivationStep,
  BrandProperty,
  CarrierDecal,
  CarrierPalette,
  TruckGeometry,
} from './types';

export * from './types';

/** The color 66 carrier folders declare when the carrier has no approved accent. */
export const DEFAULT_CARRIER_COLOR: string = paletteData.defaultColor;

/** Stands in for a catalog color that is not a `#rrggbb` literal. */
export const FALLBACK_BRAND_COLOR: string = paletteData.fallbackColor;

/** The nine properties, in the order a palette declares them. */
export const BRAND_PROPERTIES = paletteData.properties as readonly BrandProperty[];

/** How each property is mixed out of the carrier color when none is declared. */
export const BRAND_DERIVATION = paletteData.derivation as readonly BrandDerivationStep[];

/** Carrier ids whose identity belongs to another family (the GLS countries). */
export const CARRIER_FAMILIES = GENERATED_FAMILIES;

/** Explicit palettes, by carrier id. Family members repeat the family's palette. */
export const CARRIER_PALETTES = GENERATED_PALETTES;

/** Declared liveries, by carrier id. Everything else wears `default`. */
export const CARRIER_DECALS = GENERATED_DECALS;

/** One truck, rendered by `CarrierMark` on the web and `CarrierFleetMark` on iOS. */
export const CARRIER_TRUCK: TruckGeometry = GENERATED_TRUCK;

const HEX = /^#[\da-f]{6}$/i;

/** Blends `color` towards `base`; an unusable color falls back to the brand grey-green. */
export function mix(color: string, base: string, amount: number): string {
  const hex = HEX.test(color) ? color : FALLBACK_BRAND_COLOR;
  return '#' + [1, 3, 5].map(offset => Math.round(
    parseInt(hex.slice(offset, offset + 2), 16) * (1 - amount)
    + parseInt(base.slice(offset, offset + 2), 16) * amount,
  ).toString(16).padStart(2, '0')).join('');
}

/**
 * The nine properties for one carrier color. A declared palette wins property
 * by property, so a carrier can pin the two colors a wordmark requires and let
 * the rest follow from its catalog color.
 */
export function carrierBrand(color: string, palette?: Partial<CarrierPalette>): CarrierPalette {
  return Object.fromEntries(BRAND_DERIVATION.map((step) =>
    [step.property, palette?.[step.property] ?? mix(color, step.base, step.amount)],
  )) as CarrierPalette;
}

/** The identity a carrier id belongs to: its own, or the family it declares. */
export function carrierBrandFamily(id: string): string {
  return CARRIER_FAMILIES[id] ?? id;
}

/** The livery a carrier id wears. */
export function carrierDecal(id: string): CarrierDecal {
  return CARRIER_DECALS[id] ?? 'default';
}
