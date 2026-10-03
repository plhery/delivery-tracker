import { useId } from 'react';
import { CarrierMark } from '../../components/CarrierMark';
import { ParcelIllustration } from '../../components/Icon';
import { useI18n } from '../../i18n';
import { carrierBrand } from '../../lib/carrierBrand';
import { carrierInfo, displayedCarrierId, formatTrackingNumber } from '../../lib/carriers';
import { parcelHasCarrierUpdate } from '../../lib/parcelStatus';
import type { ParcelWithEvents } from '../../types';
import { maskedNumber, numberEnds } from '../links';
import { giftArrival, giftDelivered, parcelDetail, parcelHeadline, parcelStage } from './summary';

/**
 * The share sheet's preview: what the link shows, as a small card. The
 * switches under it change it, so none of them needs a sentence. A gift on
 * its way is the wrapped parcel, with no number and no name.
 */
export function SharePreview({ parcel, name, showNumber, gift }: {
  parcel: ParcelWithEvents;
  /** The name the link carries, when it carries one. */
  name: string | null;
  showNumber: boolean;
  gift: boolean;
}) {
  const { t, locale, languageTag } = useI18n();
  const caption = useId();
  const wording = { t, languageTag };
  const delivered = parcelStage(parcel) === 'delivered';
  const wrapped = gift && !delivered;
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  // No carrier has been found for the number yet: the card stays neutral, as the page does.
  const known = parcel.carrier !== 'unknown' || parcelHasCarrierUpdate(parcel);
  const headline = wrapped ? t('share.gift.headline') : gift ? t('share.gift.here') : parcelHeadline(parcel, t);
  const detail = wrapped ? giftArrival(parcel, wording) : (gift ? giftDelivered(parcel, wording) : null) ?? parcelDetail(parcel, wording);
  const number = showNumber ? formatTrackingNumber(parcel.trackingNumber, parcel.carrier) : maskedNumber(numberEnds(parcel.trackingNumber));

  return <div role="group" aria-labelledby={caption}>
    <p className="peeks-preview__caption" id={caption}>{t(wrapped ? 'share.preview.wrapped' : 'share.preview.title')}</p>
    <div className="peeks-preview" style={known ? carrierBrand(carrier).style : undefined} data-gift={gift || undefined}>
      <div className="peeks-preview__text">
        {known ? <CarrierMark carrier={carrier} /> : <span className="peeks-preview__nocarrier">{t('link.unknown.carrier')}</span>}
        {name && !wrapped && <span className="peeks-preview__name">{gift ? `${t('share.gift.inside')} ${name}` : name}</span>}
        <strong>{headline}</strong>
        {detail && <span className="peeks-preview__detail">{detail}</span>}
        {!wrapped && <span className="peeks-preview__number">{number}</span>}
      </div>
      <span className={`peeks-preview__pip${delivered ? ' peeks-preview__pip--open' : ''}`}>
        <ParcelIllustration label={known && !delivered && !gift ? { carrier, number } : undefined} ribbon={gift} />
      </span>
    </div>
  </div>;
}
