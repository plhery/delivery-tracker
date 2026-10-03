import { useEffect, useRef, type MouseEvent } from 'react';
import { CarrierTruck } from '../../components/CarrierMark';
import { Icon } from '../../components/Icon';
import { localizedExpectedDelivery, useI18n } from '../../i18n';
import { carrierBrand } from '../../lib/carrierBrand';
import { carrierInfo, displayedCarrierId } from '../../lib/carriers';
import { localizedParcelCompletionDate, parcelDeliveryEstimate, parcelDisplayStatusKey } from '../../lib/parcelStatus';
import { maskedNumber } from '../links';
import { shortNumber } from '../lookup/DeviceParcels';
import { watchDeviceParcels } from '../lookup/deviceList';
import { useRecents, type RecentParcel } from '../recents';
import { openParcelLink, parcelLinkPath } from '../route';

/** How many of the device's other parcels a page lists; the front door has them all. */
const LISTED = 3;

function OtherParcel({ recent }: { recent: RecentParcel }) {
  const { t, locale, languageTag } = useI18n();
  const { parcel, numberHint } = recent.snapshot;
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  const estimate = parcelDeliveryEstimate(parcel);
  const when = estimate ? localizedExpectedDelivery(estimate, t, languageTag) : localizedParcelCompletionDate(parcel, languageTag, t);
  const number = parcel.trackingNumber ? shortNumber(parcel.trackingNumber, parcel.carrier)
    : numberHint ? maskedNumber(numberHint) : t('common.parcel');
  function open(event: MouseEvent) {
    // A modified click opens the link the browser's way, in a new tab or window.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    openParcelLink(recent.id);
    // The other parcel's page opens on its card, not at its foot.
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  return <a className="peekp-other" style={carrierBrand(carrier).style} href={parcelLinkPath(recent.id)} onClick={open}>
    <CarrierTruck carrier={carrier} />
    <span>
      <strong>{recent.name ?? number}</strong>
      <small>{[t(parcelDisplayStatusKey(parcel)), when].filter(Boolean).join(' · ')}</small>
    </span>
    <Icon name="chevron" />
  </a>;
}

/**
 * The foot of a parcel's page. A visitor finds the other parcels this browser
 * looked up, the way to one more, and the account that would keep them. With
 * nothing else on the device, the way to another parcel is offered once the
 * journey is `over`.
 */
export function OtherParcels({ linkId, visitor, over, onTrackAnother, onSignIn }: {
  /** The parcel the page shows, left out of the list. */
  linkId: string;
  visitor: boolean;
  over: boolean;
  /** Leads to the front door, which lists every parcel of the device. */
  onTrackAnother: () => void;
  onSignIn: () => void;
}) {
  const { t } = useI18n();
  const recents = useRecents();
  const others = visitor ? recents.filter((recent) => recent.id !== linkId) : [];
  const listed = others.slice(0, LISTED);
  const list = useRef(listed);
  useEffect(() => { list.current = listed; });
  const ids = listed.map((recent) => recent.id).join(' ');
  // What the device knows about them may be days old, or still waiting for its carrier.
  useEffect(() => ids ? watchDeviceParcels(() => list.current) : undefined, [ids]);

  if (!listed.length && !over) return null;
  const another = <button type="button" className="button button--secondary" onClick={onTrackAnother}><Icon name="search" />{t('app.trackAnother')}</button>;
  if (!listed.length) {
    return <section className="peekp-another" aria-labelledby="peekp-another-title">
      <h2 id="peekp-another-title">{t('link.another')}</h2>
      {another}
    </section>;
  }
  return <section className="peekp-another" aria-labelledby="peekp-another-title">
    <div className="peekp-another__heading">
      <h2 id="peekp-another-title">{t('link.device.title')}</h2>
      {others.length > listed.length && <button type="button" className="peekp-another__all" onClick={onTrackAnother}>{t('link.device.all', { count: recents.length })}</button>}
    </div>
    <ul>{listed.map((recent) => <li key={recent.id}><OtherParcel recent={recent} /></li>)}</ul>
    {another}
    <p>{t('door.recents.kept')} <button type="button" className="peekp-another__account" onClick={onSignIn}>{t('link.device.account')}</button></p>
  </section>;
}
