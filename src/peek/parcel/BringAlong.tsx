import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CarrierTruck } from '../../components/CarrierMark';
import { Icon } from '../../components/Icon';
import { ToastMark } from '../../components/ToastMark';
import { useI18n } from '../../i18n';
import type { ApiAuth } from '../../lib/apiClient';
import { carrierBrand } from '../../lib/carrierBrand';
import { carrierInfo, displayedCarrierId, formatTrackingNumber } from '../../lib/carriers';
import { useSheetDialog } from '../../lib/modal';
import { useParcels } from '../../store/ParcelsContext';
import type { ParcelRepo } from '../../types';
import { usePendingKeep } from '../pending';
import { useRecents, type RecentParcel } from '../recents';
import { bringable, bringAlong, bringAlongInDemo, markOffered } from './deviceParcels';
import { parcelDetail, parcelHeadline } from './summary';
import './BringAlong.css';

/** A long number keeps its two ends: "DEMOGLS…0001". */
function shortNumber(number: string): string {
  return number.length > 14 ? `${number.slice(0, 7)}…${number.slice(-4)}` : number;
}

function Row({ recent, checked, onChange }: { recent: RecentParcel; checked: boolean; onChange: (checked: boolean) => void }) {
  const { t, locale, languageTag } = useI18n();
  const { parcel } = recent.snapshot;
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  const detail = parcelDetail(parcel, { t, languageTag });
  return <label className="peekp-bring__row" style={carrierBrand(carrier).style}>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <CarrierTruck carrier={carrier} />
    <span>
      <strong>{recent.name ?? (parcel.trackingNumber ? shortNumber(formatTrackingNumber(parcel.trackingNumber, parcel.carrier)) : carrier.name)}</strong>
      <small>{[parcelHeadline(parcel, t), detail].filter(Boolean).join(' · ')}</small>
    </span>
  </label>;
}

function Sheet({ parcels, onBring, onClose }: {
  parcels: RecentParcel[];
  onBring: (chosen: RecentParcel[]) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const close = useRef<HTMLButtonElement>(null);
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dialog, dismiss] = useSheetDialog<HTMLDivElement>(true, onClose, close, working);
  const chosen = parcels.filter((recent) => !left.has(recent.id));

  async function bring() {
    if (working || !chosen.length) return;
    setWorking(true);
    setFailed(false);
    try {
      await onBring(chosen);
    } catch {
      setFailed(true);
      setWorking(false);
    }
  }

  return createPortal(<div className="sheet-backdrop" onClick={dismiss}>
    <div ref={dialog} className="sheet peekp-bring" role="dialog" aria-modal="true" aria-labelledby="peekp-bring-title" aria-describedby="peekp-bring-body" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
      <div className="sheet__grabber" aria-hidden="true" />
      <div className="sheet__heading">
        <h2 className="sheet__title" id="peekp-bring-title">{t('link.bring.title')}</h2>
        <button ref={close} className="sheet__close" type="button" disabled={working} onClick={dismiss} aria-label={t('common.close')}><Icon name="close" /></button>
      </div>
      <p className="sheet__intro" id="peekp-bring-body">{t('link.bring.body')}</p>
      <div className="peekp-bring__list">
        {parcels.map((recent) => <Row key={recent.id} recent={recent} checked={!left.has(recent.id)} onChange={(checked) => setLeft((previous) => {
          const next = new Set(previous);
          if (checked) next.delete(recent.id); else next.add(recent.id);
          return next;
        })} />)}
      </div>
      {failed && <p className="sheet__error" role="alert">{t('link.bring.failed')}</p>}
      <div className="peekp-bring__actions">
        <button type="button" className="button button--primary" disabled={working || !chosen.length} aria-busy={working} onClick={() => void bring()}>
          {t('link.bring.add.many', { count: chosen.length })}
        </button>
        <button type="button" className="text-button" disabled={working} onClick={dismiss}>{t('onboarding.notifications.notNow')}</button>
      </div>
    </div>
  </div>, document.body);
}

/** After a parcel was kept on its own, the list says so first; the question comes when that has been seen. */
const ASK_AFTER_KEEPING_MS = 1_600;

/**
 * Stands beside the deliveries of someone who just signed in, and asks once
 * about the other parcels this device looked up. It waits for a parcel that
 * is being kept on its own, so that one is not asked about twice.
 */
function BringAlong({ bring }: { bring: (parcels: RecentParcel[]) => Promise<number> }) {
  const { t } = useI18n();
  const { retryLoad } = useParcels();
  const recents = useRecents();
  const pendingId = usePendingKeep();
  const [asked, setAsked] = useState<RecentParcel[] | null>(null);
  const [brought, setBrought] = useState(0);
  // Whether a parcel was being kept when the deliveries opened, and whether its word has had its moment.
  const [keeping] = useState(pendingId !== null);
  const [settled, setSettled] = useState(!keeping);
  useEffect(() => {
    if (settled || pendingId) return;
    const timer = setTimeout(() => setSettled(true), ASK_AFTER_KEEPING_MS);
    return () => clearTimeout(timer);
  }, [settled, pendingId]);
  const candidates = asked ? [] : bringable(recents, pendingId);
  // The list is fixed once the question is on screen: parcels do not come and go under it.
  const parcels = asked ?? (pendingId || !settled || !candidates.length ? null : candidates);

  useEffect(() => {
    if (!brought) return;
    const timer = setTimeout(() => setBrought(0), 4_000);
    return () => clearTimeout(timer);
  }, [brought]);

  function close(shown: RecentParcel[]) {
    markOffered(shown.map((recent) => recent.id));
    setAsked([]);
  }

  return <>
    {parcels && parcels.length > 0 && <Sheet parcels={parcels} onClose={() => close(parcels)} onBring={async (chosen) => {
      setAsked(parcels);
      const count = await bring(chosen);
      close(parcels);
      if (count) {
        setBrought(count);
        void retryLoad();
      }
    }} />}
    {brought > 0 && <div className="action-toast" role="status"><ToastMark kind="success" /><span>{t('link.bring.done.many', { count: brought })}</span></div>}
  </>;
}

/** After signing in: the account takes the chosen parcels with one request. */
export function BringAlongParcels({ auth }: { auth: ApiAuth }) {
  return <BringAlong bring={(parcels) => bringAlong(parcels, auth)} />;
}

/** The demo's counterpart: the chosen parcels move into the demo deliveries. */
export function BringAlongInDemo({ repo }: { repo: ParcelRepo }) {
  return <BringAlong bring={(parcels) => bringAlongInDemo(parcels, repo)} />;
}
