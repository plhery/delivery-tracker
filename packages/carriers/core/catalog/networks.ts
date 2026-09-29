/**
 * Brands that run several catalog networks ("DPD" is `dpd` and `dpd-fr`).
 *
 * Kept apart from the provider-name hints so browser code can use it without
 * their country tables.
 */

// Brands whose other networks keep the brand in front ("DHL Express", "GLS
// Italy"). "post" is left out: it also starts unrelated names.
export const NETWORK_BRANDS: readonly string[] = ['dhl', 'dpd', 'gls', 'hermes'];

/** The multi-network brand a catalog carrier belongs to ("dpd" for `dpd-fr`), if any. */
export function carrierBrand(id: string): string | undefined {
  return NETWORK_BRANDS.find((brand) => id === brand || id.startsWith(`${brand}-`));
}
