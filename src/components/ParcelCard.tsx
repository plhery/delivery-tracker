import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { activeTrackingCarrierId, carrierInfo } from '../lib/carriers';
import { localizedExpectedDelivery, useI18n } from '../i18n';
import { localizedParcelCompletionDate, parcelDeliveryEstimate, parcelDisplayStatusKey } from '../lib/parcelStatus';
import { currentEvent } from '../lib/stages';
import { parcelIcon } from '../lib/parcelDesign';
import { userErrorMessage } from '../lib/userMessages';
import type { ParcelWithEvents } from '../types';
import { CarrierMark } from './CarrierMark';
import { carrierBrand } from '../lib/carrierBrand';
import { Icon, PostageStamp } from './Icon';

type Drag = { x: number; y: number; pointerId: number; origin: number; width: number; direction: 'horizontal' | 'vertical' | null };

export function ParcelCard({ parcel, onOpen, onArchive, notice, variant = 'regular' }: {
  parcel: ParcelWithEvents;
  onOpen: (parcel: ParcelWithEvents, source: HTMLButtonElement) => void;
  onArchive?: (parcel: ParcelWithEvents) => Promise<unknown>;
  notice?: string;
  variant?: 'regular' | 'hero';
}) {
  const { locale, languageTag, t } = useI18n();
  const carrier = carrierInfo(activeTrackingCarrierId(parcel), locale);
  const current = currentEvent(parcel.events);
  const estimate = parcelDeliveryEstimate(parcel);
  const expectedDelivery = estimate ? localizedExpectedDelivery(estimate, t, languageTag) : null;
  const statusLabel = t(parcelDisplayStatusKey(parcel));
  const completionDate = localizedParcelCompletionDate(parcel, languageTag, t);
  const parcelName = parcel.label || t('common.parcel');
  const branding = carrierBrand(carrier);
  const hero = variant === 'hero';
  const drag = useRef<Drag | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const suppressClick = useRef(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [collapsing, setCollapsing] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [swipeThreshold, setSwipeThreshold] = useState(187);
  const armed = dragging && -offset >= swipeThreshold;
  useEffect(() => () => { if (releaseTimer.current) clearTimeout(releaseTimer.current); }, []);

  function suppressReleaseClick() {
    suppressClick.current = true;
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => { suppressClick.current = false; }, 350);
  }
  async function archive() {
    if (!onArchive || archiving) return;
    setArchiveError(null);
    setArchiving(true);
    setOffset(-(button.current?.getBoundingClientRect().width ?? 400));
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) await new Promise((resolve) => setTimeout(resolve, 180));
    setCollapsing(true);
    if (!reduced) await new Promise((resolve) => setTimeout(resolve, 180));
    try { await onArchive(parcel); }
    catch (reason) {
      setArchiving(false); setCollapsing(false); setOffset(0);
      setArchiveError(userErrorMessage(reason, t, 'detail.archiveFailed'));
    }
  }
  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (!onArchive || archiving || event.isPrimary === false || event.button > 0) return;
    setSwipeThreshold(Math.max(154, event.currentTarget.getBoundingClientRect().width * 0.52));
    drag.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, origin: offset, width: event.currentTarget.getBoundingClientRect().width, direction: null };
  }
  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const x = event.clientX - start.x;
    const y = event.clientY - start.y;
    if (start.direction === null) {
      if (Math.max(Math.abs(x), Math.abs(y)) < 8) return;
      start.direction = Math.abs(x) > Math.abs(y) * 1.25 ? 'horizontal' : 'vertical';
      if (start.direction === 'horizontal') {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragging(true);
      }
    }
    if (start.direction !== 'horizontal') return;
    event.preventDefault();
    suppressClick.current = true;
    setOffset(Math.max(-Math.max(start.width, 88), Math.min(0, start.origin + x)));
  }
  function finishSwipe(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    drag.current = null;
    setDragging(false);
    if (!start || start.direction !== 'horizontal') return;
    suppressReleaseClick();
    const end = Math.min(0, start.origin + event.clientX - start.x);
    if (-end >= Math.max(154, start.width * 0.52)) void archive();
    else setOffset(end < -36 ? -88 : 0);
  }
  function cancelSwipe() {
    const wasHorizontal = drag.current?.direction === 'horizontal';
    drag.current = null;
    setDragging(false);
    if (wasHorizontal) { setOffset(offset < -44 ? -88 : 0); suppressReleaseClick(); }
  }
  const statusSummary = completionDate ? `${statusLabel} ${t('parcel.onDate', { date: completionDate })}` : statusLabel;
  const label = expectedDelivery ? t('parcel.ariaExpected', { name: parcelName, status: statusSummary, date: expectedDelivery }) : t('parcel.aria', { name: parcelName, status: statusSummary });

  return <div data-parcel-id={parcel.id} data-carrier={carrier.id} style={branding.style} className={`parcel-card-swipe${hero ? ' parcel-card-swipe--hero' : ''}${offset ? ' parcel-card-swipe--revealed' : ''}${collapsing ? ' parcel-card-swipe--collapsing' : ''}`}>
    <div className="parcel-card-swipe__clip">
      {onArchive && <button type="button" className={`parcel-card-swipe__archive${armed ? ' parcel-card-swipe__archive--armed' : ''}`} aria-label={t('parcel.archiveAria', { name: parcelName })}
        aria-hidden={offset > -8} tabIndex={offset <= -8 ? 0 : -1} disabled={archiving} style={{ visibility: offset <= -8 ? 'visible' : 'hidden' }} onClick={() => void archive()}><Icon name="archive" /><span>{archiving ? t('detail.archiving') : t('parcel.archive')}</span></button>}
      <button ref={button} type="button" className={`parcel-card${hero ? ' parcel-card--hero' : ''}${parcel.archivedAt ? ' parcel-card--archived' : ''}${dragging ? ' parcel-card--dragging' : ''}`}
        style={{ transform: `translateX(${offset}px)` }} disabled={archiving} aria-busy={archiving} aria-label={hero ? `${t('app.nextUp')}: ${label}` : label}
        onClick={(event) => { if (suppressClick.current) return; if (offset) setOffset(0); else onOpen(parcel, event.currentTarget); }}
        onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={finishSwipe} onPointerCancel={cancelSwipe}>
        {hero ? <>
          <span className="parcel-card__hero-top"><CarrierMark carrier={carrier} /><span className="parcel-card__next-label">{t('app.nextUp')}</span></span>
          <span className="parcel-card__hero-main"><strong className="parcel-card__label">{parcelName}</strong><PostageStamp icon={parcelIcon(current?.stage)} /></span>
          <span className="parcel-card__summary"><span className="parcel-card__state">{statusLabel}</span>{expectedDelivery && <><span aria-hidden="true">·</span><span className="parcel-card__eta">{expectedDelivery}</span></>}</span>
          {parcel.syncStatus === 'error' && <span className="parcel-card__notice">{t('parcel.syncAttention')}</span>}
        </> : <>
          <span className="parcel-card__top"><CarrierMark carrier={carrier} />{(expectedDelivery || completionDate) && <span className={completionDate ? 'parcel-card__completion' : 'parcel-card__eta'}>{expectedDelivery || completionDate}</span>}</span>
          <strong className="parcel-card__label">{parcelName}</strong>
          <span className="parcel-card__state">{statusLabel}</span>
          {parcel.syncStatus === 'error' ? <span className="parcel-card__notice">{t('parcel.syncAttention')}</span> : notice && !['customs', 'ready_for_pickup', 'failed_attempt'].includes(current?.stage ?? '') && <span className="parcel-card__notice">{notice}</span>}
        </>}
      </button>
    </div>
    {archiveError && <p className="parcel-card__error" role="alert">{archiveError}</p>}
  </div>;
}
