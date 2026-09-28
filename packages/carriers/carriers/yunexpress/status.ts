import type { ClassifiedStatus } from '../../core/status';

const WORDING = new Map<string, ClassifiedStatus>([
  ['Shipment information received', { status: 'pending', stage: 'registered' }],
  ['Shipment picked up', { status: 'in_transit', stage: 'accepted' }],
  ['Arrived at origin facility', { status: 'in_transit', stage: 'in_transit' }],
  ['Departed from sort facility', { status: 'in_transit', stage: 'in_transit' }],
  ['Shipment is in transit to next facility', { status: 'in_transit', stage: 'in_transit' }],
  ['The country of origin commences customs declaration.', { status: 'in_transit', stage: 'customs' }],
  ['Arrived at the origin international airport', { status: 'in_transit', stage: 'in_transit' }],
  ['Clearence processing completed - Export', { status: 'in_transit', stage: 'in_transit' }],
  ['International flight has departed', { status: 'in_transit', stage: 'in_transit' }],
  ['International flight has arrived', { status: 'in_transit', stage: 'in_transit' }],
  ['Start Customs Clearence', { status: 'in_transit', stage: 'customs' }],
  ['Collected at Cargo Terminal', { status: 'in_transit', stage: 'in_transit' }],
  ['Clearance processing completed - Import', { status: 'in_transit', stage: 'in_transit' }],
  ['Customs inspection - Import', { status: 'in_transit', stage: 'customs' }],
]);

export function yunExpressStatus(description: string, code?: unknown): ClassifiedStatus | undefined {
  // The latest event's explicit delivered code also covers partner wording
  // containing variable delivery notes. It is never inherited by older scans.
  if (code === 50) return { status: 'delivered', stage: 'delivered' };
  return WORDING.get(description);
}
