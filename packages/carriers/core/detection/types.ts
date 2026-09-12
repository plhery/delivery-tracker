/**
 * Detection vocabulary.
 *
 * What it is: the result shapes the detection engine returns and its callers
 * pass around (confidence, candidate carriers, parsed input).
 * What it is not: no provider I/O, no application or framework types. These
 * declarations are erased at build time and safe to import from anywhere.
 */
import type { CarrierId } from '../../generated/catalog';

export type DetectionConfidence = 'high' | 'low' | 'none';

export interface CarrierDetection {
  carrier: CarrierId;
  confidence: DetectionConfidence;
  candidates: CarrierId[];
}

export interface TrackingInputMatch extends CarrierDetection {
  trackingNumber: string;
  trackingUrl?: string;
  source: 'number' | 'link' | 'text' | 'none';
}
