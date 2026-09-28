import type { ClassifiedStatus } from '../../core/status';

const STATUS = new Map<string, ClassifiedStatus>([
  ['荷物受付', { status: 'in_transit', stage: 'accepted' }],
  ['発送済み', { status: 'in_transit', stage: 'in_transit' }],
  ['配達完了', { status: 'delivered', stage: 'delivered' }],
  ['持戻（宅配BOX不可）120以上', { status: 'exception', stage: 'failed_attempt' }],
  ['持戻（休業）', { status: 'exception', stage: 'failed_attempt' }],
  ['配達日・時間帯指定（保管中）', { status: 'in_transit', stage: 'in_transit' }],
  ['輸送中', { status: 'in_transit', stage: 'in_transit' }],
  ['作業店通過', { status: 'in_transit', stage: 'in_transit' }],
  ['配達店到着', { status: 'in_transit', stage: 'in_transit' }],
  ['配達準備中', { status: 'in_transit', stage: 'in_transit' }],
  ['配達中', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['持ち出し中', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['転送', { status: 'in_transit', stage: 'in_transit' }],
  ['輸送経路修正', { status: 'in_transit', stage: 'in_transit' }],
  ['調査中', { status: 'exception', stage: 'exception' }],
  ['配達担当店保管中', { status: 'in_transit', stage: 'in_transit' }],
  ['ご来店予定（保管中）', { status: 'in_transit', stage: 'ready_for_pickup' }],
  ['保管中（ご指定店）', { status: 'in_transit', stage: 'ready_for_pickup' }],
  ['引渡', { status: 'in_transit', stage: 'in_transit' }],
  ['委託先引渡', { status: 'in_transit', stage: 'in_transit' }],
  ['返品', { status: 'exception', stage: 'returned' }],
  ['返品完了', { status: 'exception', stage: 'returned' }],
]);

export function yamatoStatus(description: string): ClassifiedStatus | undefined {
  return STATUS.get(description);
}
