'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CarrierMark } from '../../components/CarrierMark';
import { Icon } from '../../components/Icon';
import { RouteEngraving, useParcelRoute } from '../../components/ParcelMap';
import { ProgressTrack } from '../../components/ProgressTrack';
import { localizedDatePhrase, localizedDeliveryWindow, localizedExpectedDelivery, useI18n } from '../../i18n';
import { carrierBrand } from '../../lib/carrierBrand';
import { carrierInfo, displayedCarrierId } from '../../lib/carriers';
import { localizedParcelCompletionDate, parcelDeliveryEstimate, parcelDisplayStatusKey } from '../../lib/parcelStatus';
import { currentEvent } from '../../lib/stages';
import type { ParcelWithEvents } from '../../types';
import { stampFacts } from './facts';
import { perforatedOutline } from './geometry';
import { PRINT } from './motifs';
import { RoundPostmark, Stamp, StampPrint, type StampDesign } from './stamps';
import styles from './study.module.css';

export type CardDesign = 'today' | 'envelope' | 'postcard' | 'stamp';

export interface CardProps {
  parcel: ParcelWithEvents;
  design: CardDesign;
  stamp: StampDesign;
  world: boolean;
  dropBesideMap?: boolean;
}

function useCardText(parcel: ParcelWithEvents) {
  const { locale, languageTag, t } = useI18n();
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  const current = currentEvent(parcel.events);
  const estimate = parcelDeliveryEstimate(parcel);
  const completion = localizedParcelCompletionDate(parcel, languageTag, t);
  const name = parcel.label || t('common.parcel');
  const facts = stampFacts(parcel, carrier.name, languageTag, t);
  return {
    carrier, current, languageTag, facts,
    name,
    nextUp: t('app.nextUp'),
    status: t(parcelDisplayStatusKey(parcel)),
    expected: estimate ? localizedExpectedDelivery(estimate, t, languageTag) : null,
    arrival: completion ? localizedDatePhrase(completion, t)
      : estimate ? localizedDeliveryWindow(parcel.expectedDeliveryFrom, estimate, t, languageTag) : null,
  };
}

type CardText = ReturnType<typeof useCardText>;

/** The stamp-shaped card's paper, drawn to whatever size the card takes. */
function PerforatedPaper({ margin }: { margin: number }) {
  const id = useId();
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const card = svg.current?.parentElement;
    if (!card) return;
    const observer = new ResizeObserver(() => setSize((last) => {
      const next = { width: card.offsetWidth, height: card.offsetHeight };
      return last && last.width === next.width && last.height === next.height ? last : next;
    }));
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  return <svg ref={svg} className={styles.cardPaper} width={size?.width} height={size?.height} aria-hidden="true">
    {size && size.width > margin * 4 && size.height > margin * 4 && <>
      <defs>
        <filter id={`${id}-shadow`} x="-5%" y="-5%" width="110%" height="110%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.4" floodColor="#000" floodOpacity=".14" />
        </filter>
      </defs>
      <path d={perforatedOutline(size.width, size.height, 11.5, 3.3)} className={styles.paper} filter={`url(#${id}-shadow)`} />
      <rect x={margin} y={margin} width={size.width - margin * 2} height={size.height - margin * 2} className={styles.cardPrint} />
      <rect x={margin + 3} y={margin + 3} width={size.width - margin * 2 - 6} height={size.height - margin * 2 - 6} className={styles.cardFrame} />
    </>}
  </svg>;
}

/** The stamp's print, set flat onto the stamp-shaped card and cancelled on its corner once delivered. */
function PrintedPicture({ stamp, text, world }: { stamp: StampDesign; text: CardText; world: boolean }) {
  const clip = useId();
  return <span className={styles.picturePlate}>
    <svg className={styles.printedPicture} data-print={stamp.print} viewBox={`0 0 ${PRINT.width} ${PRINT.height}`} aria-hidden="true">
      <defs><clipPath id={clip}><rect width={PRINT.width} height={PRINT.height} /></clipPath></defs>
      <StampPrint design={stamp} motif={stamp.motif === 'today' ? 'globe' : stamp.motif} facts={text.facts} world={world} clip={clip} />
    </svg>
    {text.facts.delivered && <span className={styles.cardPostmark}><RoundPostmark facts={text.facts} /></span>}
  </span>;
}

function Actions({ placed }: { placed: boolean }) {
  return <span className="detail__hero-actions">
    {placed && <button type="button" className="detail__map-button" aria-label="Open the map"><Icon name="globe" /></button>}
    <button type="button" className="detail__notification" aria-label="Mute"><Icon name="bell" /></button>
  </span>;
}

function Summary({ text }: { text: CardText }) {
  return <span className="parcel-card__summary"><span className="parcel-card__state">{text.status}</span>
    {text.expected && <><span aria-hidden="true">·</span><span className="parcel-card__eta">{text.expected}</span></>}</span>;
}

/** The list's Next up card, with the app's markup and classes, laid out by `design`. */
export function NextUpCard({ parcel, design, stamp: stampDesign, world }: CardProps) {
  const text = useCardText(parcel);
  const stamp = <Stamp design={stampDesign} facts={text.facts} world={world} />;
  const top = <span className="parcel-card__hero-top"><CarrierMark carrier={text.carrier} /><span className="parcel-card__next-label">{text.nextUp}</span></span>;
  let body: ReactNode;
  if (design === 'envelope') {
    body = <>
      <span className={styles.envelopeTop}>
        <span className={styles.sender}><CarrierMark carrier={text.carrier} /><span className="parcel-card__next-label">{text.nextUp}</span></span>
        <span className={styles.cornerStamp}>{stamp}</span>
      </span>
      <strong className="parcel-card__label">{text.name}</strong>
      <Summary text={text} />
    </>;
  } else if (design === 'postcard') {
    body = <>
      {top}
      <span className={styles.postcardBack}>
        <span className={styles.note}>
          <span className={styles.noteText}>{text.facts.message}</span>
          <span className={styles.noteMeta}>{[text.facts.messagePlace, text.facts.time].filter(Boolean).join(' · ')}</span>
        </span>
        <span className={styles.address}>
          <span className={styles.addressStamp}>{stamp}</span>
          <strong className="parcel-card__label">{text.name}</strong>
          <span className={styles.addressLine}>{text.status}</span>
          {text.expected && <span className={styles.addressLine}>{text.expected}</span>}
        </span>
      </span>
    </>;
  } else if (design === 'stamp') {
    body = <>
      <PerforatedPaper margin={8} />
      {top}
      <span className="parcel-card__hero-main"><strong className="parcel-card__label">{text.name}</strong><PrintedPicture stamp={stampDesign} text={text} world={world} /></span>
      <Summary text={text} />
    </>;
  } else {
    body = <>
      {top}
      <span className="parcel-card__hero-main"><strong className="parcel-card__label">{text.name}</strong>{stamp}</span>
      <Summary text={text} />
    </>;
  }
  return <div style={carrierBrand(text.carrier).style} data-design={design} data-airmail={text.facts.international || undefined}
    className={`parcel-card-swipe parcel-card-swipe--hero ${styles.nextUp}`}>
    <div className="parcel-card-swipe__clip">
      <button type="button" className="parcel-card parcel-card--hero">{body}</button>
    </div>
  </div>;
}

/** The top of the opened parcel, with the app's markup and classes, laid out by `design`. */
export function OpenedCard({ parcel, design, stamp: stampDesign, world, dropBesideMap = false }: CardProps) {
  const text = useCardText(parcel);
  const { placed, route } = useParcelRoute(parcel, text.languageTag);
  const stage = text.current?.stage;
  // The postcard keeps the route behind the globe button.
  const mapped = placed && design !== 'postcard';
  const stamp = <Stamp design={stampDesign} facts={text.facts} world={world} />;
  const carrier = <button type="button" className="detail__carrier"><CarrierMark carrier={text.carrier} /></button>;
  const progress = <div className="detail__progress"><ProgressTrack stage={stage ?? null} /></div>;
  const status = <>
    <p className="detail__state">{text.status}</p>
    {text.arrival && <p className="detail__arrival">{text.arrival}</p>}
  </>;
  let body: ReactNode;
  if (design === 'envelope') {
    body = <>
      {mapped && <RouteEngraving route={route} stage={stage} onOpen={() => {}} />}
      <div className="detail__hero-meta">{carrier}<span className={styles.cornerStamp}>{stamp}</span></div>
      <div className="detail__title-row"><h2 className="detail__title">{text.name}</h2></div>
      <div className={styles.envelopeFoot}><div>{status}</div><Actions placed={placed} /></div>
      {progress}
    </>;
  } else if (design === 'postcard') {
    body = <>
      <div className="detail__hero-meta">{carrier}<Actions placed={placed} /></div>
      <div className={styles.postcardBack}>
        <div className={styles.note}>
          <p className={styles.noteText}>{text.facts.message}</p>
          <p className={styles.noteMeta}>{[text.facts.messagePlace, text.facts.time].filter(Boolean).join(' · ')}</p>
        </div>
        <div className={styles.address}>
          <div className={styles.addressStamp}>{stamp}</div>
          <h2 className="detail__title">{text.name}</h2>
          <p className={styles.addressLine}>{text.status}</p>
          {text.arrival && <p className={styles.addressLine}>{text.arrival}</p>}
        </div>
      </div>
      {progress}
    </>;
  } else if (design === 'stamp') {
    body = <>
      <PerforatedPaper margin={9} />
      {mapped && <RouteEngraving route={route} stage={stage} onOpen={() => {}} />}
      <div className="detail__hero-meta">{carrier}<Actions placed={placed} /></div>
      <div className="detail__title-row"><h2 className="detail__title">{text.name}</h2>
        {!(mapped && dropBesideMap) && <PrintedPicture stamp={stampDesign} text={text} world={world} />}</div>
      {status}
      {progress}
    </>;
  } else {
    body = <>
      {mapped && <RouteEngraving route={route} stage={stage} onOpen={() => {}} />}
      <div className="detail__hero-meta">{carrier}<Actions placed={placed} /></div>
      <div className="detail__title-row"><h2 className="detail__title">{text.name}</h2>{!(mapped && dropBesideMap) && stamp}</div>
      {status}
      {progress}
    </>;
  }
  return <div style={carrierBrand(text.carrier).style} data-design={design} data-airmail={text.facts.international || undefined}
    className={`detail detail--postcard ${styles.opened}`}>
    <section className={`detail__hero${mapped ? ' detail__hero--map' : ''}`}>{body}</section>
  </div>;
}
