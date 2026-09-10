import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { carrierInfo } from '../lib/carriers';
import type { Parcel } from '../types';

export function AutoCarrierNotice({ parcel, className }: { parcel: Parcel; className?: string }) {
  const { locale, t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const changedAt = Date.parse(parcel.autoChangedAt ?? '');
  const expiresAt = changedAt + 12 * 60 * 60_000;
  useEffect(() => {
    // Recheck on new metadata and expire even if the package is not refreshed.
    const timer = setTimeout(() => setNow(Date.now()), 0);
    const expiry = Number.isFinite(expiresAt) && expiresAt > Date.now()
      ? setTimeout(() => setNow(Date.now()), expiresAt - Date.now()) : undefined;
    return () => { clearTimeout(timer); clearTimeout(expiry); };
  }, [expiresAt]);
  if (!parcel.autoChangedFrom || parcel.autoChangedFrom === parcel.carrier
    || parcel.autoChangedTo !== parcel.carrier || !Number.isFinite(changedAt)
    || now < changedAt || now >= expiresAt) return null;
  return <span className={className}>{t('parcel.autoChangedCarrier', {
    carrier: carrierInfo(parcel.autoChangedFrom, locale).name,
  })}</span>;
}
