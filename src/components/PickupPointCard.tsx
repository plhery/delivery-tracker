import { useEffect, useId, useState } from 'react';
import { useI18n } from '../i18n';
import { trackAction } from '../lib/analytics';
import { pickupPointMapsUrl, prefersAppleMaps, type PickupPoint } from '../lib/pickupPoint';

/** Where a parcel waits for collection, with a way to get there. */
export function PickupPointCard({ point }: { point: PickupPoint }) {
  const { t } = useI18n();
  const labelId = useId();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    if (copy !== 'copied') return;
    const timer = setTimeout(() => setCopy('idle'), 2000);
    return () => clearTimeout(timer);
  }, [copy]);

  async function copyAddress() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(point.query);
      trackAction('parcel-pickup-copy', 'success');
      setCopy('copied');
    } catch {
      setCopy('error');
    }
  }

  return (
    <section className="pickup-card" aria-labelledby={labelId}>
      <div className="pickup-card__place">
        <span className="pickup-card__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 9.5 5.5 4h13L20 9.5M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12v8h13v-8M10 20v-4.5h4V20" /></svg>
        </span>
        <div className="pickup-card__text">
          <p className="pickup-card__label" id={labelId}>{t('detail.pickupPoint')}</p>
          <p className="pickup-card__name">{point.name}</p>
          {point.address && <p className="pickup-card__address">{point.address}</p>}
        </div>
      </div>
      <div className="pickup-card__actions">
        <a
          className="pickup-card__action pickup-card__action--primary"
          href={pickupPointMapsUrl(point, prefersAppleMaps())}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackAction('parcel-pickup-directions')}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d={point.address ? 'M3 11 21 3l-8 18-2-8z' : 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 2-4-4'} />
          </svg>
          {t(point.address ? 'detail.pickupDirections' : 'detail.pickupShowOnMap')}
        </a>
        {point.address && (
          <button type="button" className="pickup-card__action" onClick={() => void copyAddress()}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d={copy === 'copied' ? 'm5 12 4 4L19 6' : 'M9 9h11v12H9V9ZM5 15H3V3h12v2'} /></svg>
            <span aria-live="polite">{t(copy === 'copied' ? 'detail.copied' : 'detail.pickupCopyAddress')}</span>
          </button>
        )}
      </div>
      {copy === 'error' && <p className="pickup-card__error" role="alert">{t('detail.pickupCopyUnavailable')}</p>}
    </section>
  );
}
