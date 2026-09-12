/**
 * DHL eCommerce wording and UTAPI status codes → product stage.
 *
 * UTAPI events carry both a free-text `description` and a coarse
 * `statusCode` (`pre-transit`, `transit`, `failure`, `delivered`). The
 * wording is the more precise of the two, so it is read first; the code is
 * the fallback, except for `delivered`, which is terminal and outranks an
 * intuitive translation of the text.
 */
import type { CarrierStatus } from '../../core/result';
import { trackingLanguageStage } from '../../core/status';
import { clean as cleanText } from '../../core/transport';
import type { JsonObject } from '../../core/types';

/** The same tag-stripping cleaner the projection uses (see adapter.ts). */
function clean(value: unknown, limit = 500): string {
  return typeof value === 'string' ? cleanText(value.replace(/<[^>]*>/g, ''), limit) : '';
}

export function stageFor(event: JsonObject): string {
  const text = clean(event.description).toLowerCase();
  if (/return(?:ed|ing)? to (?:the )?sender/.test(text)) return 'returned';
  if (/not delivered|unable to deliver|delivery attempt|delivery failed/.test(text)) return 'failed_attempt';
  // A carrier-reported problem that is neither a missed attempt nor a return.
  if (/carrier exception|shipment exception|delivery exception|damaged|refused|address (?:incorrect|incomplete|unknown)|(?:incorrect|incomplete) address|lost in transit/.test(text)) return 'exception';
  // Sender-side drop-off scans (ha-dhl-nl#15) must never read as recipient
  // pickup: the parcel is entering the network, not awaiting collection.
  if (/picked.?up at (?:a )?parcel ?shop|drop(?:ped)? ?off at|handed in at/.test(text)) return 'accepted';
  if (/ready for (?:pickup|collection)|available for (?:pickup|collection)/.test(text)) return 'ready_for_pickup';
  if (/out for delivery/.test(text)) return 'out_for_delivery';
  if (/customs.*(?:cleared|released)|clearance completed/.test(text)) return 'in_transit';
  if (/customs|clearance/.test(text)) return 'customs';
  if (/label created|manifest data received|en route to dhl ecommerce or awaiting processing|electronic|information received/.test(text)) return 'registered';
  if (/package received at dhl|picked up|accepted/.test(text)) return 'accepted';
  if (/^(?:close bag|scanned into sack\/container)$/.test(text)) return 'in_transit';
  // A terminal provider code outranks an intuitive translated label.
  if (event.statusCode === 'delivered') return 'delivered';
  const translated = trackingLanguageStage(String(event.description ?? ''));
  if (translated) return translated;
  switch (event.statusCode) {
    case 'transit': return 'in_transit';
    case 'pre-transit': return 'registered';
    case 'failure': return 'failed_attempt';
    default: return 'pending';
  }
}

export function statusFor(stage: string): CarrierStatus {
  if (stage === 'delivered') return 'delivered';
  if (stage === 'out_for_delivery' || stage === 'ready_for_pickup') return 'out_for_delivery';
  if (['exception', 'failed_attempt', 'returned'].includes(stage)) return 'exception';
  if (stage === 'registered' || stage === 'pending') return 'pending';
  return 'in_transit';
}
