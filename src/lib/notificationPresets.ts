import type { ApiNotificationStage, ApiParcelAlertPreset } from '../generated/apiContract';

/**
 * The stages each notification preset announces. An account's settings and the
 * alerts of a parcel link choose among the same three lists, on the web and on
 * the server.
 */
export const ALL_NOTIFICATION_STAGES: ApiNotificationStage[] = [
  'registered',
  'accepted',
  'in_transit',
  'customs',
  'exception',
  'out_for_delivery',
  'failed_attempt',
  'ready_for_pickup',
  'delivered',
  'returned',
];

export const IMPORTANT_NOTIFICATION_STAGES: ApiNotificationStage[] = [
  'customs',
  'exception',
  'out_for_delivery',
  'failed_attempt',
  'ready_for_pickup',
  'delivered',
  'returned',
];

export const DELIVERY_DAY_NOTIFICATION_STAGES: ApiNotificationStage[] = [
  'out_for_delivery',
  'delivered',
];

/** What an alert on a parcel link announces: every scan, the important steps, or the delivery only. */
export const ALERT_PRESET_STAGES: Record<ApiParcelAlertPreset, readonly ApiNotificationStage[]> = {
  all: ALL_NOTIFICATION_STAGES,
  important: IMPORTANT_NOTIFICATION_STAGES,
  delivery: DELIVERY_DAY_NOTIFICATION_STAGES,
};
