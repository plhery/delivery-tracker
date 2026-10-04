import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { trackingFailureMessage, useI18n, type MessageKey } from '../../i18n';
import { AMAZON_HISTORY_EXPIRED } from '../../lib/amazon';
import { trackAction } from '../../lib/analytics';
import {
  activeTrackingCarrierId,
  carrierInfo,
  carrierTrackingHintKey,
  formatTrackingNumber,
  parcelTrackingLinks,
  parcelTrackingNumbers,
  tracksAutomatically,
  type CarrierInfo,
  type ParcelTrackingLink,
} from '../../lib/carriers';
import type { ParcelAttention } from '../../lib/parcelPriority';
import { currentEvent } from '../../lib/stages';
import type { ParcelWithEvents, Stage } from '../../types';
import { maskedNumber, parcelLinkErrorKey, type ParcelLinkError, type ParcelLinkView } from '../links';
import { Glyph } from './glyphs';
import { copyText } from './share';
import type { Freshness } from './summary';

/**
 * Where the carrier shows the parcel. A link that masks the number leads to
 * the carrier's tracking page without it, never to the parcel itself.
 */
export function carrierLinks(view: ParcelLinkView, locale: string): ParcelTrackingLink[] {
  const { parcel } = view;
  if (parcel.trackingNumber) return parcelTrackingLinks(parcel, locale);
  const carrier = carrierInfo(activeTrackingCarrierId(parcel), locale);
  const template = carrier.trackingUrl?.('');
  if (!template) return [];
  try {
    const home = new URL(template);
    home.search = '';
    home.hash = '';
    return [{ carrier, name: carrier.trackingSiteName ?? carrier.name, url: home.href, active: true, ready: true, role: 'active' }];
  } catch {
    return [];
  }
}

/** The tracking number with a way to copy it, and the carrier's own page. A viewer sees the number's two ends. */
export function NumberSection({ view, links }: { view: ParcelLinkView; links: readonly ParcelTrackingLink[] }) {
  const { t, locale } = useI18n();
  const { parcel, numberHint } = view;
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const numbers = parcel.trackingNumber ? parcelTrackingNumbers(parcel) : [];

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(number: string, carrier: CarrierInfo['id']) {
    const done = await copyText(carrier === 'postlogistics' ? formatTrackingNumber(number, carrier) : number);
    setFailed(!done);
    if (!done) return;
    trackAction('parcel-copy-tracking', 'success');
    setCopied(number);
  }

  if (!numbers.length && !numberHint && !links.length) return null;
  return <section className="peekp-number">
    {numbers.map(({ carrier, number }) => <div className="peekp-number__row" key={number}>
      <div><span>{numbers.length > 1 ? carrierInfo(carrier, locale).name : t('detail.trackingNumber')}</span><strong>{formatTrackingNumber(number, carrier)}</strong></div>
      <button type="button" onClick={() => void copy(number, carrier)}
        aria-label={numbers.length > 1 ? `${t('detail.copyTracking')} — ${carrierInfo(carrier, locale).name}` : t('detail.copyTracking')}>
        <Icon name={copied === number ? 'check' : 'copy'} />
        <span className="sr-only" aria-live="polite">{copied === number ? t('detail.copied') : ''}</span>
      </button>
    </div>)}
    {!numbers.length && numberHint && <div className="peekp-number__row">
      <div><span>{t('detail.trackingNumber')}</span><strong>{maskedNumber(numberHint)}</strong></div>
    </div>}
    {failed && <p className="peekp-number__error" role="alert">{t('detail.copyUnavailable')}</p>}
    {links.length === 1 && <a className="peekp-number__link" href={links[0].url} target="_blank" rel="noopener noreferrer" onClick={() => trackAction('parcel-carrier-link')}>
      <span>{t('detail.carrierWebsite', { carrier: links[0].name })}</span><Icon name="arrow" />
    </a>}
  </section>;
}

interface Note {
  id: string;
  icon: ReactNode;
  title?: string;
  body: string;
  /** The carrier's own words, set as a quotation. */
  quoted?: boolean;
  /** A card on paper for what the reader should know; a quiet one for what Peek is doing about it. */
  paper?: boolean;
}

/**
 * What needs saying beside the card: why nothing moves, what the carrier
 * said, why the latest update is missing. Each says what happened and what
 * Peek keeps doing; the carrier's own page is linked once, below the number.
 */
export function Notes({ view, stage, flag, trouble, carrier }: {
  view: ParcelLinkView;
  stage: Stage | null;
  flag: ParcelAttention | null;
  /** Why the page's own read failed, when it did and the device is online. */
  trouble: ParcelLinkError | null;
  carrier: CarrierInfo;
}) {
  const { t } = useI18n();
  const { parcel } = view;
  const active = carrierInfo(activeTrackingCarrierId(parcel));
  const expired = active.id === 'amazon-shipping' && parcel.syncError === AMAZON_HISTORY_EXPIRED;
  const automatic = tracksAutomatically(active.id) && !expired;
  const scan = currentEvent(parcel.events);
  const notes: Note[] = [];

  if (trouble) notes.push({ id: 'trouble', icon: <Glyph name="info" />, body: t(parcelLinkErrorKey(trouble)) });
  if (!automatic) {
    notes.push({
      id: 'manual', icon: <Glyph name="info" />,
      body: t((expired ? 'add.amazonHistoryExpired' : carrierTrackingHintKey(active.id)) as MessageKey, { carrier: carrier.name }),
    });
  } else if (parcel.syncError) {
    notes.push({ id: 'sync', icon: <Glyph name="info" />, body: trackingFailureMessage(parcel.syncError, t) });
  }
  if (flag === 'stalled') notes.push({ id: 'quiet', icon: <Icon name="hourglass" />, body: t('link.quiet', { carrier: carrier.name }) });
  if ((stage === 'exception' || stage === 'failed_attempt') && scan?.description.trim()) {
    notes.push({ id: 'says', icon: <Glyph name="info" />, title: t('link.carrierSays', { carrier: carrier.name }), body: scan.description.trim(), quoted: true, paper: true });
  }
  if (stage === 'returned') notes.push({ id: 'returned', icon: <Glyph name="back" />, body: t('link.returned', { carrier: carrier.name }), paper: true });
  if (!notes.length) return null;

  return <div className="peekp-notes">
    {notes.map((note) => <div key={note.id} className={`peekp-note${note.paper ? ' peekp-note--paper' : ''}`} role="note">
      <span className="peekp-note__icon" aria-hidden="true">{note.icon}</span>
      <div>
        {note.title && <strong>{note.title}</strong>}
        {note.quoted ? <blockquote>{note.body}</blockquote> : <p>{note.body}</p>}
      </div>
    </div>)}
  </div>;
}

/** What the carrier told about the shipment itself. */
export function ShipmentFacts({ parcel, stage }: { parcel: ParcelWithEvents; stage: Stage | null }) {
  const { t, languageTag } = useI18n();
  const sender = parcel.senderName?.trim();
  // While the parcel waits, its pickup point has a card of its own.
  const pickup = stage === 'ready_for_pickup' ? undefined : parcel.pickupPoint?.trim();
  const weight = Number.isFinite(parcel.weightKg) && parcel.weightKg! > 0
    ? new Intl.NumberFormat(languageTag, { style: 'unit', unit: 'kilogram', maximumFractionDigits: 3 }).format(parcel.weightKg!) : null;
  if (!sender && !pickup && !weight && !parcel.dimensionsText) return null;
  return <div className="peekp-facts">
    {sender && <p>{t('parcel.sender', { sender })}</p>}
    {(pickup || weight || parcel.dimensionsText) && <dl>
      {pickup && <div><dt>{t(stage === 'delivered' ? 'detail.collectedAt' : 'detail.pickupPoint')}</dt><dd>{pickup}</dd></div>}
      {weight && <div><dt>{t('detail.weight')}</dt><dd>{weight}</dd></div>}
      {parcel.dimensionsText && <div><dt>{t('detail.dimensions')}</dt><dd>{parcel.dimensionsText}</dd></div>}
    </dl>}
  </div>;
}

/** Under the journal: when the carrier was last asked, and the way to ask again. */
export function FreshnessLine({ freshness, busy, onCheck }: { freshness: Freshness; busy: boolean; onCheck: () => void }) {
  const { t } = useI18n();
  return <div className="peekp-fresh" data-kind={freshness.kind}>
    <span>{freshness.label}</span>
    <button type="button" disabled={busy} aria-busy={busy} title={t('detail.checkNow')} aria-label={t('detail.checkNow')} onClick={onCheck}>
      <Icon name="refresh" />
    </button>
  </div>;
}
