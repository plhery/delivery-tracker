/**
 * Brand vocabulary.
 *
 * What it is: the shape of the nine brand properties, of a palette declared in
 * `carrier.json`, and of the truck geometry both clients render.
 * What it is not: no data and no behaviour; every declaration here is erased at
 * build time. `packages/carriers/generated/brand.ts` annotates its constants
 * with these types, which is why they live in their own module: the generated
 * file must not import the runtime side of `core/brand`.
 */

/** The nine CSS custom properties a carrier identity resolves to. */
export type BrandProperty =
  | 'surface-light'
  | 'surface-dark'
  | 'ink-light'
  | 'ink-dark'
  | 'brand-light'
  | 'brand-dark'
  | 'truck'
  | 'edge'
  | 'accent';

export type CarrierPalette = Record<BrandProperty, string>;

/** Which livery the truck wears. Anything without an approved wordmark is `default`. */
export type CarrierDecal = 'default' | 'dhl' | 'ups';

/** How one property is mixed out of the carrier's catalog color. */
export interface BrandDerivationStep {
  property: BrandProperty;
  base: string;
  amount: number;
}

/** `[x, y]` in the truck's own 32x21 coordinate space. */
export type TruckPoint = readonly [number, number];

/** A paint is either a hex literal or the name of one of the nine properties. */
export type TruckPaint = string;

export interface TruckBody {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  fill: TruckPaint;
  stroke: TruckPaint;
}

/**
 * A filled and stroked outline. `d` is what the SVG draws; `points` is the
 * straight-line spelling of the same outline for the SwiftUI canvas.
 */
export interface TruckPanel {
  d: string;
  points: readonly TruckPoint[];
  fill: TruckPaint;
  stroke: TruckPaint;
}

/** Same, without a stroke. */
export interface TruckGlass {
  d: string;
  points: readonly TruckPoint[];
  fill: TruckPaint;
}

export interface TruckWheels {
  centers: readonly TruckPoint[];
  tire: { r: number; fill: TruckPaint };
  hub: { r: number; fill: TruckPaint };
}

/** Stroked segments: `d` for SVG, `segments` for the canvas. */
export interface TruckDecalLine {
  type: 'line';
  d: string;
  segments: readonly (readonly TruckPoint[])[];
  stroke: TruckPaint;
  strokeWidth: number;
}

export interface TruckDecalCircle {
  type: 'circle';
  cx: number;
  cy: number;
  r: number;
  fill: TruckPaint;
}

/** A filled outline; the canvas draws `points`, which approximates any curve in `d`. */
export interface TruckDecalPolygon {
  type: 'polygon';
  d: string;
  points: readonly TruckPoint[];
  fill: TruckPaint;
}

export type TruckDecalShape = TruckDecalLine | TruckDecalCircle | TruckDecalPolygon;

export interface TruckGeometry {
  viewBox: { width: number; height: number };
  strokeWidth: number;
  body: TruckBody;
  cab: TruckPanel;
  windshield: TruckGlass;
  wheels: TruckWheels;
  decals: Record<CarrierDecal, readonly TruckDecalShape[]>;
}
