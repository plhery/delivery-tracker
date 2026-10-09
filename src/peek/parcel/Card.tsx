import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AutoCarrierNotice } from '../../components/AutoCarrierNotice';
import { CarrierMark } from '../../components/CarrierMark';
import { Icon, PARCEL, ParcelIllustration } from '../../components/Icon';
import type { Rect } from '../../components/map/WorldMap';
import { useCoveredBox } from '../../components/ParcelMap';
import { ProgressTrack } from '../../components/ProgressTrack';
import { useI18n } from '../../i18n';
import { carrierBrand } from '../../lib/carrierBrand';
import type { CarrierInfo } from '../../lib/carriers';
import type { ParcelWithEvents, Stage } from '../../types';
import { PIP_TRANSITION_NAME } from '../route';
import { Glyph } from './glyphs';
import { flagKey } from './summary';
import type { ParcelAttention } from '../../lib/parcelPriority';

/** In a gift's card, beside the carrier: the way into the alerts. */
export function CardBell({ label, on, onOpen }: {
  /** "Notify me", or "Notifications on" once this browser has them. */
  label: string;
  on: boolean;
  onOpen: () => void;
}) {
  return <button type="button" className="peekp-bell" data-on={on || undefined} onClick={onOpen}>
    <Icon name="bell" /><span>{label}</span>
  </button>;
}

/** Where the sparks stand around the box, in parts of Pip's own frame. */
const SPARKS = [
  { left: '-6%', top: '4%', size: 16, color: '#C99B35', delay: .5 },
  { left: '90%', top: '16%', size: 11, color: '#D6AE48', delay: .7 },
  { left: '-20%', top: '62%', size: 9, color: '#B594BE', delay: .9 },
  { left: '98%', top: '66%', size: 14, color: '#C99B35', delay: .6 },
];

/**
 * The kraft Pip. A parcel that arrived opens its box: closed for a frame,
 * so the opening is seen, then open for good, its carrier's label still on
 * its side. When a parcel is revealed, golden sparks twinkle once around the box.
 */
function KraftPip({ carrier, number, open, hero, sparks, ribbon = false }: {
  carrier: CarrierInfo | null;
  number: string | null;
  open: boolean;
  hero: boolean;
  sparks: boolean;
  /** Wrapped as a gift: a ribbon instead of the carrier's label. */
  ribbon?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setOpened(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return <div className={`peekp-pip${hero ? ' peekp-pip--hero' : ''}${open && opened ? ' peekp-pip--open' : ''}`} style={{ viewTransitionName: PIP_TRANSITION_NAME }}>
    <ParcelIllustration label={carrier && !ribbon ? { carrier, number } : undefined} ribbon={ribbon} />
    {sparks && <div className="peekp-pip__sparks" aria-hidden="true">
      {SPARKS.map(({ left, top, size, color, delay }) => <svg key={left} width={size} height={size} viewBox="-1 -1 2 2"
        style={{ left, top, animationDelay: `${delay}s` }}><path d={PARCEL.glint} fill={color} /></svg>)}
    </div>}
  </div>;
}

/**
 * A second carrier's mark adds a line to the card's top row. Its map is taller than the opened card's, so the route only
 * starts below the mark, keeping the room it has on any other card, and the card grows by that much, all of it map.
 * ParcelPage.css gives the same height.
 */
const HANDOVER_ROOM = 24;

const FLAG_ICONS: Record<ParcelAttention, ReactNode> = {
  sync_error: <Icon name="refresh" />,
  stalled: <Icon name="clock" />,
  not_announced: <Icon name="clock" />,
  exception: <Glyph name="warning" />,
  failed_attempt: <Glyph name="warning" />,
  customs: <Glyph name="warning" />,
  ready_for_pickup: <Icon name="location" />,
};

/**
 * The parcel's card, in its carrier's colours: the status as the headline,
 * what is known about its arrival, and Pip. `figure` says how Pip appears:
 * on the `map` drawn across the card, as the `kraft` parcel in its corner, as
 * the open box in the middle (`hero`), or not at all when the map beside the
 * card has him.
 */
export function LinkCard({ parcel, stage, carrier, delivery, headline, name, detail, notes, flag, figure, number, map, bell, settled, gift }: {
  parcel: ParcelWithEvents;
  stage: Stage | null;
  /** Null while no carrier is known. */
  carrier: CarrierInfo | null;
  /** The carrier that delivers a parcel handed over by the first: its mark stands under the first one. */
  delivery: CarrierInfo | null;
  headline: string;
  name: string | null;
  detail: string | null;
  notes: readonly string[];
  flag: ParcelAttention | null;
  figure: 'map' | 'kraft' | 'hero' | 'none';
  /** What the label on Pip's side says: the number, masked for a viewer. */
  number: string | null;
  /** The map across the top of the card, told what the card writes over it and how much lower its route starts. */
  map?: (covered: Rect | null, room: number) => ReactNode;
  /** A wrapped gift's way into the alerts, in the card's corner. */
  bell?: ReactNode;
  /** The reveal's settle beat: the newest step fills and the sparks twinkle. */
  settled: boolean;
  /**
   * A gift. Its recipient gets the lilac card with the ribboned Pip while it
   * is `wrapped`, and the open box once it is `opened`; its sender (`own`)
   * keeps the usual card, marked as a gift.
   */
  gift?: 'wrapped' | 'opened' | 'own';
}) {
  const { t } = useI18n();
  const delivered = stage === 'delivered';
  const present = gift === 'wrapped' || gift === 'opened';
  const card = useRef<HTMLElement>(null);
  const handedOver = carrier && delivery;
  // The second mark stands over the map, which keeps clear of it.
  const [deliveryMark, deliveryMarkBox] = useCoveredBox<HTMLSpanElement>(card, figure === 'map' && !!handedOver);
  return <section ref={card} className={`peekp-card peekp-card--${figure}${carrier ? '' : ' peekp-card--neutral'}${present ? ` peekp-card--gift peekp-card--${gift}` : ''}`} aria-label={headline} data-settled={settled || undefined}>
    {figure === 'map' && map?.(deliveryMarkBox, handedOver ? HANDOVER_ROOM : 0)}
    <div className="peekp-card__top">
      {handedOver ? <span className="peekp-card__marks">
        <CarrierMark carrier={carrier} />
        <span ref={deliveryMark} className="peekp-card__delivery" style={carrierBrand(delivery).style}><CarrierMark carrier={delivery} /></span>
      </span>
        : carrier ? <CarrierMark carrier={carrier} />
        : <span className="peekp-card__nocarrier"><Icon name="detect" />{t('link.unknown.carrier')}</span>}
      {bell}
    </div>
    {figure === 'hero' && <KraftPip carrier={carrier} number={number} open={delivered} hero sparks={false} ribbon={present} />}
    <div className="peekp-card__body">
      <div className="peekp-card__text">
        {gift === 'own' && <p className="peekp-card__gift"><Icon name="gift" />{t('share.gift.marker')}</p>}
        {name && <p className="peekp-card__name">{name}</p>}
        <h1>{headline}</h1>
        {detail && <p className="peekp-card__detail">{detail}</p>}
        {notes.map((note) => <p key={note} className="peekp-card__note">{note}</p>)}
        <AutoCarrierNotice parcel={parcel} className="peekp-card__note" />
      </div>
      {figure === 'kraft' && <KraftPip carrier={carrier} number={number} open={delivered} hero={false} sparks={settled && !delivered} />}
    </div>
    {flag && <p className="peekp-card__flag">{FLAG_ICONS[flag]}<span>{t(flagKey(flag))}</span></p>}
    {gift !== 'opened' && <div className="peekp-card__progress"><ProgressTrack stage={stage} /></div>}
  </section>;
}
