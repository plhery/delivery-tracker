import type { ClassifiedStatus, Stage } from '../../core/status';

const STATUS = new Map<string, ClassifiedStatus>([
  ['123', { status: 'in_transit', stage: 'in_transit' }],
  ['756', { status: 'in_transit', stage: 'in_transit' }],
  ['310', { status: 'in_transit', stage: 'accepted' }],
  ['311', { status: 'in_transit', stage: 'accepted' }],
  ['111', { status: 'in_transit', stage: 'in_transit' }],
  ['131', { status: 'in_transit', stage: 'in_transit' }],
  ['171', { status: 'in_transit', stage: 'in_transit' }],
  ['136', { status: 'in_transit', stage: 'in_transit' }],
  ['176', { status: 'in_transit', stage: 'in_transit' }],
  ['710', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['741', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['746', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['745', { status: 'delivered', stage: 'delivered' }],
  ['835', { status: 'exception', stage: 'exception' }],
]);

/** Exact operation codes from the domestic website; unfamiliar codes stay unmapped. */
export function ytoStatus(code: string, signType?: unknown): ClassifiedStatus | undefined {
  if (code === '751') return signType === '1'
    ? { status: 'in_transit', stage: 'in_transit' } : { status: 'in_transit', stage: 'ready_for_pickup' };
  return STATUS.get(code);
}

export interface YtoScan {
  stage: Stage;
  wording: string;
  returnLeg?: true;
}

const SCANS: ReadonlyArray<readonly [chinese: string, english: string, stage: Stage, wording: string]> = [
  ['揽收扫描', 'Pickup scan', 'accepted', 'Picked up'],
  ['装件入车扫描', 'Load scan into vehicle', 'in_transit', 'Loaded for transport'],
  ['下车扫描', 'Get off scan', 'in_transit', 'Unloaded at a sorting centre'],
  ['快件城市信息', 'Package city information', 'in_transit', 'In transit'],
  ['退回件扫描', 'Return package scan', 'exception', 'Return to the sender started'],
  ['派件扫描', 'Delivery scan', 'out_for_delivery', 'Out for delivery'],
  ['入柜|入库', 'In cabinet | In storage', 'ready_for_pickup', 'In a parcel locker or pickup station'],
  // The courier took the parcel back out of the locker or station.
  ['小件员取出', 'Small item handler takes out.', 'in_transit', 'Taken out of the locker by the courier'],
  ['PDA正常签收扫描', 'PDA normal delivery scan', 'delivered', 'Delivered'],
];

function key(label: string): string {
  return label.trim().replace(/\s*\|\s*/g, '|').replace(/[.。]+$/, '').toLowerCase();
}

const BY_LABEL = new Map(SCANS.flatMap(([chinese, english, stage, wording]) => {
  const entry: YtoScan = { stage, wording, ...(chinese === '退回件扫描' ? { returnLeg: true } : {}) };
  return [[key(chinese), entry], [key(english), entry]] as const;
}));

/** The stage and stored wording of one YTO scan label, Chinese or translated. */
export function ytoScan(label: string): YtoScan | undefined {
  return BY_LABEL.get(key(label));
}
