import { useState } from 'react';
import { useI18n } from '../i18n';
import { Sheet, SwitchRow } from '../peek/parcel/Sheet';
import type { ParcelWithEvents } from '../types';
import { Icon } from './Icon';

type Alert = 'notifications' | 'email';

/**
 * A parcel's alerts, for an account whose delivery email is on: notifications
 * and the email, each switched for this parcel alone. A switch saves at once
 * and moves when the server has answered.
 */
export function ParcelAlertsSheet({ parcel, email, preset, onSetNotificationsMuted, onSetEmailMuted, onClose }: {
  parcel: ParcelWithEvents;
  /** Where the delivery email goes. */
  email: string;
  /** The account's notification preset, as Settings names it. */
  preset: string;
  onSetNotificationsMuted: (muted: boolean) => Promise<unknown>;
  onSetEmailMuted: (muted: boolean) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState<Alert | null>(null);
  const [failed, setFailed] = useState(false);
  const name = parcel.label.trim();

  async function save(alert: Alert, change: () => Promise<unknown>) {
    if (saving) return;
    setSaving(alert);
    setFailed(false);
    try {
      await change();
    } catch {
      setFailed(true);
    } finally {
      setSaving(null);
    }
  }

  return <Sheet title={name ? t('email.parcel.title', { name }) : t('email.parcel.open')} className="parcel-alerts" onClose={onClose}>{(dismiss) => <>
    <div className="peeks-switches">
      <SwitchRow icon={<Icon name="bell" />} title={t('email.parcel.notifications')} hint={t('email.parcel.notificationsBody', { preset })}
        checked={!parcel.notificationsMuted} busy={saving === 'notifications'}
        onChange={(on) => void save('notifications', () => onSetNotificationsMuted(!on))} />
      <SwitchRow icon={<Icon name="mail" />} title={t('email.parcel.email')} hint={t('email.parcel.emailBody', { email })}
        checked={!parcel.emailMuted} busy={saving === 'email'}
        onChange={(on) => void save('email', () => onSetEmailMuted(!on))} />
    </div>
    <p className="peeks__promise">{t('email.parcel.note', { place: `${t('settings.title')} › ${t('settings.deliveryUpdates')}` })}</p>
    {failed && <p className="sheet__error" role="alert">{t('detail.notificationFailed')}</p>}
    <div className="peeks__actions">
      <button type="button" className="button button--primary" onClick={dismiss}>{t('native.done')}</button>
    </div>
  </>}</Sheet>;
}
