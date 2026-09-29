import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../core/status';

/** The official client's package enum and English translations. */
export const CANADA_POST_STATUS_STAGE: Readonly<Record<string, Stage>> = {
  HalfAccepted: 'registered', FullAccepted: 'accepted', InTransit: 'in_transit',
  InTransitAlert: 'exception', FullProgressAlert: 'exception', FullProgress: 'out_for_delivery',
  HalfDelivered: 'failed_attempt', ReadyPickup: 'ready_for_pickup', Delivered: 'delivered',
  '0': 'registered', '1': 'accepted', '2': 'in_transit', '3': 'exception', '4': 'exception',
  '5': 'out_for_delivery', '6': 'failed_attempt', '7': 'ready_for_pickup', '8': 'delivered',
};

export function canadaPostPackageStage(code: string): Stage | null {
  return Object.hasOwn(CANADA_POST_STATUS_STAGE, code) ? CANADA_POST_STATUS_STAGE[code]! : null;
}

const SCAN_STAGE: Readonly<Record<string, Stage>> = {
  '2600': 'in_transit', '1481': 'exception', '0156': 'ready_for_pickup', '0172': 'exception',
  '1701': 'ready_for_pickup', '1703': 'in_transit', '0174': 'out_for_delivery', '0170': 'in_transit',
  '1301': 'accepted', '1466': 'delivered', '0500': 'out_for_delivery', '2407': 'ready_for_pickup',
  '0405': 'accepted', '0175': 'in_transit', '0100': 'in_transit', '1302': 'accepted',
};

export function canadaPostScanStage(code: string): Stage | null {
  return Object.hasOwn(SCAN_STAGE, code) ? SCAN_STAGE[code]! : null;
}

export function canadaPostStage(text: string): Stage | null {
  const value = text.toLowerCase();
  if (/\b(?:will|may|might|would)\b.*\breturn(?:ed)?\b/.test(value)) return /notice|pick[ -]?up|collect/.test(value) ? 'ready_for_pickup' : null;
  if (/\b(?:en\s?route|in transit)\b.*\bsender\b/.test(value)) return 'in_transit';
  if (/\breturned to (?:the )?sender\b/.test(value)) return 'returned';
  if (/\b(?:being returned|returning|return to sender)\b/.test(value)) return 'exception';
  if (/available for pick[ -]?up|held at (?:the )?post office/.test(value)) return 'ready_for_pickup';
  if (/delivery attempt|notice left|delivery notice|no answer|business closed|not delivered|unable to deliver|recipient not located/.test(value)) return 'failed_attempt';
  if (/\b(?:will|expected|scheduled)\b.*\bdelivered\b/.test(value)) return null;
  if (/\bdelivered\b/.test(value)) return 'delivered';
  if (/out for delivery/.test(value)) return 'out_for_delivery';
  if (/customs|clearance/.test(value)) return 'customs';
  if (/exception|alert|delay|damaged|lost|seized|held|re-routed due to processing error/.test(value)) return 'exception';
  if (/manifest|label created|information (?:received|submitted)|order received|pre-shipment|waiting for item/.test(value)) return 'registered';
  if (/accepted|picked up|received by canada post|item arrived|arrived at/.test(value)) return 'accepted';
  if (/in transit|on its way|departed|processed|processing|distribution cent(?:re|er)|sorting/.test(value)) return 'in_transit';
  return null;
}

export function statusForStage(stage: Stage): CarrierStatus {
  if (stage === 'delivered') return 'delivered';
  if (stage === 'out_for_delivery' || stage === 'ready_for_pickup') return 'out_for_delivery';
  if (stage === 'exception' || stage === 'failed_attempt' || stage === 'returned') return 'exception';
  if (stage === 'registered' || stage === 'pending') return 'pending';
  return 'in_transit';
}

export function canadaPostStatus(code: string, text: string): CarrierStatus {
  const stage = canadaPostPackageStage(code.trim()) ?? canadaPostStage(text);
  return stage ? statusForStage(stage) : 'unknown';
}
