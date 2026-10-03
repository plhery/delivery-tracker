import { useEffect, useState, type ReactNode } from 'react';
import { AutoCarrierNotice } from '../../components/AutoCarrierNotice';
import { CarrierMark } from '../../components/CarrierMark';
import { Icon, PARCEL, ParcelIllustration } from '../../components/Icon';
import { ProgressTrack } from '../../components/ProgressTrack';
import { useI18n } from '../../i18n';
import type { CarrierInfo, ParcelTrackingLink } from '../../lib/carriers';
import { trackAction } from '../../lib/analytics';
import type { ParcelWithEvents, Stage } from '../../types';
import { PIP_TRANSITION_NAME } from '../route';
import { Glyph } from './glyphs';
import { flagKey, type Freshness } from './summary';
import type { ParcelAttention } from '../../lib/parcelPriority';

/** The marker beside the carrier: how fresh the card is. Tapping it checks now. */
export function LiveMarker({ freshness, busy, onCheck }: {
  freshness: Freshness;
  busy: boolean;
  /** Absent once the journey is over: there is nothing left to check. */
  onCheck?: () => void;
}) {
  const { t } = useI18n();
  const content = <>
    {freshness.dot && <span className="peekp-live__dot" aria-hidden="true"><i /></span>}
    <span className="peekp-live__label">{freshness.label}</span>
    <span className="peekp-live__short" aria-hidden="true">{freshness.short}</span>
  </>;
  if (!onCheck) return <span className="peekp-live" data-kind={freshness.kind}>{content}</span>;
  return <button type="button" className="peekp-live" data-kind={freshness.kind} data-pulse={freshness.pulse || undefined}
    disabled={busy} aria-busy={busy} title={t('detail.checkNow')} aria-label={`${freshness.label}. ${t('detail.checkNow')}`} onClick={onCheck}>
    {content}
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
export function LinkCard({ parcel, stage, carrier, headline, name, detail, notes, flag, figure, number, map, marker, links, settled, gift }: {
  parcel: ParcelWithEvents;
  stage: Stage | null;
  /** Null while no carrier is known. */
  carrier: CarrierInfo | null;
  headline: string;
  name: string | null;
  detail: string | null;
  notes: readonly string[];
  flag: ParcelAttention | null;
  figure: 'map' | 'kraft' | 'hero' | 'none';
  /** What the label on Pip's side says: the number, masked for a viewer. */
  number: string | null;
  map?: ReactNode;
  marker: ReactNode;
  /** The carriers of a journey handed from one to another, each with its own page. */
  links: readonly ParcelTrackingLink[];
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
  return <section className={`peekp-card peekp-card--${figure}${carrier ? '' : ' peekp-card--neutral'}${present ? ` peekp-card--gift peekp-card--${gift}` : ''}`} aria-label={headline} data-settled={settled || undefined}>
    {figure === 'map' && map}
    <div className="peekp-card__top">
      {carrier ? <CarrierMark carrier={carrier} />
        : <span className="peekp-card__nocarrier"><Icon name="detect" />{t('link.unknown.carrier')}</span>}
      {marker}
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
    {links.length > 1 && <div className="peekp-card__journey" role="group" aria-label={t('detail.trackingSources')}>
      {links.map((link) => {
        const role = t(link.role === 'active' ? 'detail.sourceActive' : link.role === 'waiting' ? 'detail.sourceWaiting' : 'detail.sourceHistory');
        return <a key={`${link.role}:${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer" data-role={link.role}
          aria-label={`${t('detail.carrierWebsite', { carrier: link.name })} — ${role}`} onClick={() => trackAction('parcel-carrier-link')}>
          <span>{link.name}</span><Icon name="arrow" /><small>{role}</small>
        </a>;
      })}
    </div>}
  </section>;
}
