import type { CSSProperties } from 'react';
import { CarrierMark } from '../components/CarrierMark';
import { ParcelIllustration } from '../components/Icon';
import { PeekLockup } from '../components/PeekMark';
import { TrackingJournal } from '../components/TrackingJournal';
import { localizedExpectedDelivery, useI18n } from '../i18n';
import { carrierBrand } from '../lib/carrierBrand';
import { carrierInfo, displayedCarrierId, formatTrackingNumber } from '../lib/carriers';
import { parcelDeliveryEstimate, parcelDisplayStatusKey } from '../lib/parcelStatus';
import { maskedNumber, parcelLinkErrorKey, type ParcelLinkView } from './links';
import { leaveParcelLink, PIP_TRANSITION_NAME } from './route';
import { useParcelLink } from './useParcelLink';
import './ParcelPage.css';

/**
 * One parcel at its own address, for anyone with the link. `entrance="reveal"`
 * is the hand-over from the front door, with the lookup's answer as `initial`;
 * a link opened directly loads on its own.
 */
export function ParcelPage({ linkId, entrance = 'direct', initial }: {
  linkId: string;
  entrance?: 'reveal' | 'direct';
  initial?: ParcelLinkView;
}) {
  const { t, locale, languageTag } = useI18n();
  const { status, view, name, trouble, checking, live, refreshing, refresh } = useParcelLink(linkId, initial);

  const header = <header className="peekp-header">
    <button type="button" className="peekp-home" aria-label={t('app.title')} onClick={() => leaveParcelLink()}><PeekLockup /></button>
  </header>;

  if (status === 'unavailable') {
    return <main className="peekp peekp--gone">
      {header}
      <div className="peekp-body">
        <h1>{t('link.gone.title')}</h1>
        <p>{t('link.gone.body')}</p>
        <button type="button" className="button button--secondary" onClick={() => leaveParcelLink()}>{t('peek.title')}</button>
      </div>
    </main>;
  }

  if (!view) {
    return <main className="peekp peekp--loading">
      {header}
      <div className="peekp-body">
        <div className="peekp-pip" style={{ viewTransitionName: PIP_TRANSITION_NAME }}><ParcelIllustration /></div>
        {trouble ? <p role="alert">{t(parcelLinkErrorKey(trouble))}</p> : <p role="status">{t('status.syncing')}</p>}
      </div>
    </main>;
  }

  const { parcel, numberHint } = view;
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  const number = parcel.trackingNumber ? formatTrackingNumber(parcel.trackingNumber, parcel.carrier)
    : numberHint ? maskedNumber(numberHint) : null;
  const estimate = parcelDeliveryEstimate(parcel);
  const brand = { ...carrierBrand(carrier).style, '--carrier-brand': 'light-dark(var(--carrier-brand-light), var(--carrier-brand-dark))' } as CSSProperties;

  return <main className="peekp" style={brand} data-entrance={entrance} data-live={live || undefined}>
    {header}
    <div className="peekp-body">
      <div className="peekp-pip" style={{ viewTransitionName: PIP_TRANSITION_NAME }}>
        <ParcelIllustration label={{ carrier, number }} />
      </div>
      <CarrierMark carrier={carrier} />
      <h1>{t(parcelDisplayStatusKey(parcel))}</h1>
      {name && <p className="peekp-name">{name}</p>}
      {estimate && <p className="peekp-estimate">{t('detail.expected', { date: localizedExpectedDelivery(estimate, t, languageTag) })}</p>}
      {number && <p className="peekp-number"><span>{t('detail.trackingNumber')}</span> <strong>{number}</strong></p>}
      {trouble && <p className="peekp-trouble" role="status">{t(parcelLinkErrorKey(trouble))}</p>}
      <button type="button" className="button button--secondary" disabled={refreshing} onClick={() => void refresh()}>{t('detail.checkNow')}</button>
      <TrackingJournal events={parcel.events} syncing={checking} />
    </div>
  </main>;
}
