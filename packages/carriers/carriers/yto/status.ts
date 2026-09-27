/**
 * YTO Express scan vocabulary.
 *
 * YTO reaches us only through universal providers. ParcelsApp relays YTO's
 * scan-type labels either in Chinese or in its own English translation, and
 * switches between the two for the same scans. Both forms map to one stage and
 * one stored wording, so a language switch does not duplicate the history.
 * Labels outside this list fall back to the shared wording rules.
 */
import type { Stage } from '../../core/status';

export interface YtoScan {
  stage: Stage;
  wording: string;
}

const SCANS: ReadonlyArray<readonly [chinese: string, english: string, stage: Stage, wording: string]> = [
  ['揽收扫描', 'Pickup scan', 'accepted', 'Picked up'],
  ['装件入车扫描', 'Load scan into vehicle', 'in_transit', 'Loaded for transport'],
  ['下车扫描', 'Get off scan', 'in_transit', 'Unloaded at a sorting centre'],
  ['快件城市信息', 'Package city information', 'in_transit', 'In transit'],
  ['退回件扫描', 'Return package scan', 'returned', 'Return to the sender started'],
  ['派件扫描', 'Delivery scan', 'out_for_delivery', 'Out for delivery'],
  ['入柜|入库', 'In cabinet | In storage', 'ready_for_pickup', 'In a parcel locker or pickup station'],
  // The courier took the parcel back out of the locker or station.
  ['小件员取出', 'Small item handler takes out.', 'in_transit', 'Taken out of the locker by the courier'],
  ['PDA正常签收扫描', 'PDA normal delivery scan', 'delivered', 'Delivered'],
];

function key(label: string): string {
  return label.trim().replace(/\s*\|\s*/g, '|').replace(/[.。]+$/, '').toLowerCase();
}

const BY_LABEL = new Map(SCANS.flatMap(([chinese, english, stage, wording]) =>
  [[key(chinese), { stage, wording }], [key(english), { stage, wording }]] as const));

/** The stage and stored wording of one YTO scan label, Chinese or translated. */
export function ytoScan(label: string): YtoScan | undefined {
  return BY_LABEL.get(key(label));
}
