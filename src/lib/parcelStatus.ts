import type { ParcelWithEvents } from '../types';
import type { MessageKey } from '../i18n';
import { currentEvent, stageMeta } from './stages';
import { activeTrackingCarrierId, tracksAutomatically } from './carriers';

export interface ParcelDisplayStatus {
  label: string;
  tone: 'ok' | 'warn' | 'done';
  syncing: boolean;
}

/** Show estimates only when they still help explain what happens next. */
export function parcelDeliveryEstimate(parcel: ParcelWithEvents, now = Date.now()): string | null {
  const value = parcel.expectedDelivery;
  const stage = currentEvent(parcel.events)?.stage;
  if (!value || (stage && ['delivered', 'returned', 'ready_for_pickup', 'failed_attempt'].includes(stage))) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!match) return null;
  const day = /T\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value))
    ? new Date(value) : new Date(`${match[1]}T00:00:00`);
  day.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (!Number.isFinite(day.getTime()) || day < today) return null;
  if (stage === 'out_for_delivery' && day.getTime() === today.getTime() && !/[T ]\d{2}:\d{2}/.test(value)) return null;
  return value;
}

export function parcelHasCarrierUpdate(parcel: ParcelWithEvents): boolean {
  const current = currentEvent(parcel.events);
  return Boolean(current && current.stage !== 'pending');
}

export function parcelIsUnannounced(parcel: ParcelWithEvents): boolean {
  return !parcelHasCarrierUpdate(parcel) && parcel.syncStatus === 'waiting';
}

/** Keep the app's sync lifecycle separate from the carrier's delivery stage. */
export function parcelDisplayStatus(parcel: ParcelWithEvents): ParcelDisplayStatus {
  const current = currentEvent(parcel.events);
  const hasCarrierUpdate = parcelHasCarrierUpdate(parcel);

  if (!hasCarrierUpdate && !tracksAutomatically(activeTrackingCarrierId(parcel))) {
    return { label: 'Check tracking website', tone: 'warn', syncing: false };
  }

  if (!hasCarrierUpdate && (parcel.syncStatus === 'pending' || parcel.syncStatus === 'syncing')) {
    return { label: 'Checking for updates', tone: 'ok', syncing: true };
  }
  if (!hasCarrierUpdate && parcel.syncStatus === 'error') {
    return { label: 'Update unavailable', tone: 'warn', syncing: false };
  }
  if (!hasCarrierUpdate && parcel.syncStatus === 'unsupported') {
    return {
      label: 'Check tracking website',
      tone: 'warn',
      syncing: false,
    };
  }
  if (!hasCarrierUpdate && parcel.syncStatus === 'waiting') {
    return { label: 'Waiting for the carrier', tone: 'ok', syncing: false };
  }

  const meta = current ? stageMeta(current.stage) : null;
  return {
    label: meta?.label ?? 'Waiting for the carrier',
    tone: meta?.tone ?? 'ok',
    syncing: false,
  };
}

export function parcelDisplayStatusKey(parcel: ParcelWithEvents): MessageKey {
  const current = currentEvent(parcel.events);
  const hasCarrierUpdate = parcelHasCarrierUpdate(parcel);
  if (!hasCarrierUpdate && !tracksAutomatically(activeTrackingCarrierId(parcel))) {
    return 'status.unsupported';
  }
  if (!hasCarrierUpdate && (parcel.syncStatus === 'pending' || parcel.syncStatus === 'syncing')) {
    return 'status.syncing';
  }
  if (!hasCarrierUpdate && parcel.syncStatus === 'error') return 'status.failed';
  if (!hasCarrierUpdate && parcel.syncStatus === 'unsupported') return 'status.unsupported';
  if (!hasCarrierUpdate && parcel.syncStatus === 'waiting') return 'status.unannounced';
  return current ? (`stage.${current.stage}` as MessageKey) : 'status.unannounced';
}

/** The actual completion date shown beside a final-state status tag. */
export function localizedParcelCompletionDate(
  parcel: ParcelWithEvents,
  languageTag: string,
): string | null {
  const current = currentEvent(parcel.events);
  if (current?.stage === 'delivered' || current?.stage === 'returned') {
    const occurredAt = new Date(current.occurredAt);
    if (!Number.isNaN(occurredAt.getTime())) {
      return new Intl.DateTimeFormat(languageTag, {
        day: 'numeric',
        month: 'numeric',
        year: '2-digit',
      }).format(occurredAt);
    }
  }
  return null;
}
