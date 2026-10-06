import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { CarrierMark } from '../../components/CarrierMark';
import { pipMood } from '../../components/map/Pip';
import { defaultMode } from '../../components/map/route';
import { WorldMap } from '../../components/map/WorldMap';
import { CardRoute, useParcelRoute } from '../../components/ParcelMap';
import { ProgressTrack } from '../../components/ProgressTrack';
import { localizedExpectedDelivery, useI18n } from '../../i18n';
import { carrierBrand } from '../../lib/carrierBrand';
import { useDeliveredHold } from '../../lib/deliveredHold';
import type { CardList } from '../../lib/deliveredMove';
import { carrierInfo, displayedCarrierId, formatTrackingNumber, normalizeTrackingNumber } from '../../lib/carriers';
import { localizedParcelCompletionDate, parcelDeliveryEstimate, parcelDisplayStatusKey } from '../../lib/parcelStatus';
import { pickupPoint } from '../../lib/pickupPoint';
import { isFinal } from '../../lib/stages';
import { maskedNumber } from '../links';
import { useMedia, useNow } from '../parcel/hooks';
import { parcelDetail, parcelFreshness, parcelHeadline, parcelStage } from '../parcel/summary';
import { useRecents, type RecentParcel } from '../recents';
import { openParcelLink, parcelLinkPath } from '../route';
import { usePeekSession } from '../session';
import { forgetDeviceParcels, leadParcel, watchDeviceParcels } from './deviceList';

/** A long number as a card writes it: its two ends. A short one stays whole. */
export function shortNumber(number: string, carrier: RecentParcel['carrier']): string {
  const plain = normalizeTrackingNumber(number);
  return plain.length > 14 ? `${plain.slice(0, 7)}…${plain.slice(-4)}` : formatTrackingNumber(number, carrier);
}

/** What a card calls its parcel: the name this device gave it, else its number. */
function useParcelTitle(recent: RecentParcel): string {
  const { t } = useI18n();
  const { parcel, numberHint } = recent.snapshot;
  return recent.name ?? (parcel.trackingNumber ? shortNumber(parcel.trackingNumber, parcel.carrier)
    : numberHint ? maskedNumber(numberHint) : t('common.parcel'));
}

/** A modified click opens the link the browser's way, in a new tab or window. Any other opens the page out of the card. */
function openOnClick(id: string) {
  return (event: MouseEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    openParcelLink(id, { from: event.currentTarget });
  };
}

/** The list's cards, for what moves when one of its parcels has arrived. */
const DOOR_CARDS: CardList = { card: '[data-parcel-link]', id: 'data-parcel-link', name: '.door-nextup__name, strong', large: '.door-nextup', blocks: '.door-device__list > li' };

/** A card of the list, with the parcel's route small at its end once a scan has a place. `arrived` marks one whose parcel has just been delivered. */
function DeviceParcel({ recent, arrived = false }: { recent: RecentParcel; arrived?: boolean }) {
  const { t, locale, languageTag } = useI18n();
  const { parcel } = recent.snapshot;
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  const estimate = parcelDeliveryEstimate(parcel);
  const when = estimate ? localizedExpectedDelivery(estimate, t, languageTag) : localizedParcelCompletionDate(parcel, languageTag, t);
  const title = useParcelTitle(recent);
  const { placed, route } = useParcelRoute(parcel, languageTag);
  return <a className={`door-parcel${placed ? ' door-parcel--route' : ''}`} style={carrierBrand(carrier).style} href={parcelLinkPath(recent.id)} data-parcel-link={recent.id} data-arrived={arrived ? '' : undefined} onClick={openOnClick(recent.id)}>
    {placed && <CardRoute route={route} />}
    <span className="door-parcel__top"><CarrierMark carrier={carrier} />{when && <span className="door-parcel__when">{when}</span>}</span>
    <strong>{title}</strong>
    <span className="door-parcel__state">{t(parcelDisplayStatusKey(parcel))}</span>
  </a>;
}

/** The door's phone layout ends at this width: from here the lead card writes beside its map instead of under it. */
const BESIDE = '(min-width: 761px)';
/** Room for the card's top row, and beside the words for the land to fade in from under them. */
const LEAD_INSETS = {
  beside: { top: 44, right: 22, bottom: 26, left: 76 },
  under: { top: 44, right: 16, bottom: 30, left: 16 },
};
/** Pip keeps below the card's top row and, on a phone, above the words written over the foot of the map. */
const LEAD_CEILING = 46;
const LEAD_FLOOR = 150;

/**
 * The parcel the list leads with, on the card its own page gives it: the
 * status as the headline, what is known about its arrival, and its route in
 * the carrier's colours with Pip beside the parcel.
 */
function LeadParcel({ recent, arrived = false }: { recent: RecentParcel; arrived?: boolean }) {
  const { t, locale, languageTag } = useI18n();
  const now = useNow();
  const beside = useMedia(BESIDE);
  const [time] = useState(() => new Date());
  const { parcel } = recent.snapshot;
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  const stage = parcelStage(parcel);
  const title = useParcelTitle(recent);
  const { route } = useParcelRoute(parcel, languageTag);
  const wording = { t, languageTag, now };
  const freshness = parcelFreshness({ parcel, checking: false, offline: false, trouble: false, seenAt: recent.lastSeenAt }, wording);
  // A parcel waiting to be collected says where.
  const detail = parcelDetail(parcel, wording) ?? (stage === 'ready_for_pickup' ? pickupPoint(parcel.pickupPoint)?.name : null);
  const mood = pipMood(stage ?? undefined);
  return <a className="door-nextup" style={carrierBrand(carrier).style} href={parcelLinkPath(recent.id)} data-parcel-link={recent.id} data-arrived={arrived ? '' : undefined} onClick={openOnClick(recent.id)}>
    <span className="door-nextup__map" aria-hidden="true">
      {route && <WorldMap route={route} mode={defaultMode(route, stage ?? undefined)} time={time} look="tint" labels="ends" context={false}
        live={!stage || !isFinal(stage)} pip={mood && { mood, ceiling: LEAD_CEILING, floor: beside ? undefined : LEAD_FLOOR }} languageTag={languageTag}
        insets={beside ? LEAD_INSETS.beside : LEAD_INSETS.under} className="door-nextup__canvas" />}
    </span>
    <span className="door-nextup__top">
      <CarrierMark carrier={carrier} />
      <span className="door-nextup__fresh">{freshness.dot && <i aria-hidden="true" />}{freshness.label}</span>
    </span>
    <span className="door-nextup__text">
      <span className="door-nextup__name">{title}</span>
      <strong>{parcelHeadline(parcel, t)}</strong>
      {detail && <span className="door-nextup__detail">{detail}</span>}
    </span>
    {/* The headline already says how far the parcel is. */}
    <div className="door-nextup__progress" aria-hidden="true"><ProgressTrack stage={stage} /></div>
  </a>;
}

/**
 * "On this device": the parcels this browser looked up or opened, each in its
 * carrier's colours with its route. The one that matters now leads the list
 * on a card of its own. They live in the browser only; forgetting them all
 * also forgets, on the server, the lookups this device made.
 */
export function DeviceParcels({ onSignIn, onForgotten, covered = false }: {
  onSignIn: () => void;
  /** The list is gone: the door takes the focus back. */
  onForgotten: () => void;
  /** A parcel's page lies over the list, and reads its parcel itself. */
  covered?: boolean;
}) {
  const { t } = useI18n();
  const { account } = usePeekSession();
  const recents = useRecents();
  const [asking, setAsking] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [failed, setFailed] = useState(false);
  const question = useRef<HTMLDivElement>(null);
  const list = useRef(recents);
  useEffect(() => { list.current = recents; });
  const listed = recents.length > 0;
  const watching = listed && !covered;
  useEffect(() => watching ? watchDeviceParcels(() => list.current) : undefined, [watching]);
  useEffect(() => { if (asking) question.current?.focus(); }, [asking]);
  // A parcel delivered since the list was last shown says so where its card stands, before the list is led by another.
  const cards = useRef<HTMLUListElement>(null);
  const parcels = useMemo(() => recents.map((recent) => ({ ...recent.snapshot.parcel, id: recent.id })), [recents]);
  const delivered = useDeliveredHold(parcels, watching && !asking, cards, DOOR_CARDS);

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
  const shown = new Map(delivered.arranged.map((parcel) => [parcel.id, parcel]));
  const led = leadParcel(recents.map((recent) => ({ ...recent, snapshot: { ...recent.snapshot, parcel: shown.get(recent.id) ?? recent.snapshot.parcel } })));
  const lead = recents.find((recent) => recent.id === led?.id) ?? null;
  const arrived = (recent: RecentParcel) => delivered.arrived({ ...recent.snapshot.parcel, id: recent.id });
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
    <ul ref={cards} className="door-device__list">
      {lead && <li key={lead.id} className="door-device__lead"><LeadParcel recent={lead} arrived={arrived(lead)} /></li>}
      {recents.filter((recent) => recent !== lead).map((recent) => <li key={recent.id}><DeviceParcel recent={recent} arrived={arrived(recent)} /></li>)}
    </ul>
    <p className="door-aside">{t('door.recents.kept')}{account !== 'signed-in' && <>{' '}<button type="button" className="door-link" onClick={onSignIn}>{t('door.recents.signIn')}</button></>}</p>
  </section>;
}
