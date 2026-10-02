import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { CarrierMark } from '../../components/CarrierMark';
import { localizedExpectedDelivery, useI18n } from '../../i18n';
import { carrierBrand } from '../../lib/carrierBrand';
import { carrierInfo, displayedCarrierId, formatTrackingNumber, normalizeTrackingNumber } from '../../lib/carriers';
import { localizedParcelCompletionDate, parcelDeliveryEstimate, parcelDisplayStatusKey } from '../../lib/parcelStatus';
import { maskedNumber } from '../links';
import { useRecents, type RecentParcel } from '../recents';
import { openParcelLink, parcelLinkPath } from '../route';
import { forgetDeviceParcels, refreshDeviceParcels } from './deviceList';

/** How soon, and how often, the list asks again about a parcel whose carrier has not answered yet. */
const FIRST_CHECK_MS = 2_000;
const FIRST_CHECK_ROUNDS = 6;

/** A long number as a card writes it: its two ends. A short one stays whole. */
export function shortNumber(number: string, carrier: RecentParcel['carrier']): string {
  const plain = normalizeTrackingNumber(number);
  return plain.length > 14 ? `${plain.slice(0, 7)}…${plain.slice(-4)}` : formatTrackingNumber(number, carrier);
}

function DeviceParcel({ recent }: { recent: RecentParcel }) {
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
  }
  return <a className="door-parcel" style={carrierBrand(carrier).style} href={parcelLinkPath(recent.id)} onClick={open}>
    <span className="door-parcel__top"><CarrierMark carrier={carrier} />{when && <span className="door-parcel__when">{when}</span>}</span>
    <strong>{recent.name ?? number}</strong>
    <span className="door-parcel__state">{t(parcelDisplayStatusKey(parcel))}</span>
  </a>;
}

/**
 * "On this device": the parcels this browser looked up or opened, each in its
 * carrier's colours. They live in the browser only; forgetting them all also
 * forgets, on the server, the lookups this device made.
 */
export function DeviceParcels({ onSignIn, onForgotten }: {
  onSignIn: () => void;
  /** The list is gone: the door takes the focus back. */
  onForgotten: () => void;
}) {
  const { t } = useI18n();
  const recents = useRecents();
  const [asking, setAsking] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [failed, setFailed] = useState(false);
  const question = useRef<HTMLDivElement>(null);
  const list = useRef(recents);
  useEffect(() => { list.current = recents; });
  const listed = recents.length > 0;
  useEffect(() => {
    if (!listed) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A parcel looked up a moment ago may still be waiting for its carrier: a few more rounds, further and further apart.
    const round = async (rounds: number) => {
      const unanswered = await refreshDeviceParcels(list.current, controller.signal);
      if (unanswered && rounds < FIRST_CHECK_ROUNDS && !controller.signal.aborted) {
        timer = setTimeout(() => void round(rounds + 1), FIRST_CHECK_MS * 1.5 ** rounds);
      }
    };
    void round(0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [listed]);
  useEffect(() => { if (asking) question.current?.focus(); }, [asking]);

  async function forget() {
    setForgetting(true);
    setFailed(false);
    const kept = await forgetDeviceParcels(list.current);
    setForgetting(false);
    setAsking(false);
    setFailed(kept > 0);
    if (!kept) onForgotten();
  }

  if (!listed) return null;
  return <section className="door-device" aria-labelledby="door-device-title">
    <div className="door-device__heading">
      <h2 id="door-device-title">{t('peek.onThisDevice')}</h2>
      {!asking && <button type="button" className="door-device__forget" onClick={() => { setFailed(false); setAsking(true); }}>{t('door.recents.forgetAll')}</button>}
    </div>
    {asking && <div ref={question} className="door-device__question" role="group" aria-labelledby="door-device-question" tabIndex={-1}>
      <p id="door-device-question">{t('door.recents.forget.many', { count: recents.length })}</p>
      <div>
        <button type="button" className="door-device__cancel" disabled={forgetting} onClick={() => setAsking(false)}>{t('common.cancel')}</button>
        <button type="button" className="door-device__confirm" disabled={forgetting} onClick={() => void forget()}>{t('door.recents.forget.yes')}</button>
      </div>
    </div>}
    {failed && <p className="door-message" role="alert">{t('door.recents.forget.failed')}</p>}
    <ul className="door-device__list">{recents.map((recent) => <li key={recent.id}><DeviceParcel recent={recent} /></li>)}</ul>
    <p className="door-aside">{t('door.recents.kept')} <button type="button" className="door-link" onClick={onSignIn}>{t('door.recents.signIn')}</button></p>
  </section>;
}
