/**
 * Typed access to the merged carrier catalog.
 *
 * What it is: the generated `x-carriers` data read through the catalog types,
 * plus the lookups the server and the detection engine need (definition,
 * timezone, adapter, active input requirements, automatic-carrier sets).
 * What it is not: no provider I/O, no HTTP, no application code. Everything
 * here is a pure function of the generated catalog.
 */
import { CARRIER_CATALOG, type CarrierId } from '../../generated/catalog';
import type { CarrierDefinition, CarrierRequirementRule } from './types';

export const CARRIER_DEFINITIONS = CARRIER_CATALOG as unknown as Record<
  CarrierId,
  CarrierDefinition
>;

export function carrierDefinition(carrierId: string): CarrierDefinition {
  const definition = CARRIER_DEFINITIONS[carrierId as CarrierId];
  if (!definition) throw new RangeError(`Unknown carrier ${carrierId}`);
  return definition;
}

export function carrierTimezone(carrierId: string): string {
  return carrierDefinition(carrierId).timezone ?? 'UTC';
}

export function carrierAdapter(carrierId: string): string | null {
  return carrierDefinition(carrierId).tracking.adapter;
}

/**
 * The requirements that apply to one number. The pattern is anchored here,
 * unlike the unanchored UI filter in `carrierRequirements`.
 */
export function activeRequirements(
  carrierId: string,
  trackingNumber: string,
): CarrierRequirementRule[] {
  return (carrierDefinition(carrierId).tracking.requirements ?? []).filter(
    (requirement) => !requirement.whenTrackingNumber
      || new RegExp(`^(?:${requirement.whenTrackingNumber})$`).test(trackingNumber),
  );
}

export const AUTOMATIC_CARRIER_IDS = new Set(
  Object.entries(CARRIER_DEFINITIONS)
    .filter(([, definition]) => definition.tracking.mode === 'automatic')
    .map(([carrierId]) => carrierId),
);

export const CARRIER_NAMES = new Map(
  Object.entries(CARRIER_DEFINITIONS)
    .filter(([carrierId]) => AUTOMATIC_CARRIER_IDS.has(carrierId))
    .map(([carrierId, definition]) => [
      carrierId,
      definition.tracking.upstreamName ?? definition.displayName,
    ]),
);
