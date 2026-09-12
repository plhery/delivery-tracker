import type { CSSProperties } from 'react';
import {
  CARRIER_PALETTES,
  DEFAULT_CARRIER_COLOR,
  carrierBrand as carrierPalette,
  carrierBrandFamily,
  carrierDecal,
} from '@carriers/core/brand';
import type { CarrierInfo } from './carriers';

export { DEFAULT_CARRIER_COLOR, carrierBrandFamily, carrierDecal };

/** The wordmarks we set by hand; every other carrier shows its catalog name. */
const WORDMARKS: Record<string, string> = { dhl: 'DHL', gls: 'GLS', ups: 'ups' };

/**
 * Only the approved wordmarks need special treatment; new carriers use catalog
 * colors. Both the palette and the livery are data in the carrier folders, read
 * through `packages/carriers/core/brand`.
 */
export function carrierBrand(carrier: CarrierInfo) {
  const family = carrierBrandFamily(carrier.id);
  const palette = carrierPalette(carrier.color, CARRIER_PALETTES[carrier.id]);
  const style = Object.fromEntries(
    Object.entries(palette).map(([property, value]) => [`--carrier-${property}`, value]),
  ) as CSSProperties;
  return { family, name: WORDMARKS[family] ?? carrier.name, decal: carrierDecal(carrier.id), style };
}
