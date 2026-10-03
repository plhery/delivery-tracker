import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { CarrierTruck } from '../../components/CarrierMark';
import { Icon } from '../../components/Icon';
import { ParcelStamp } from '../../components/ParcelStamp';
import { SignInScreen } from '../../components/SignInScreen';
import { useI18n } from '../../i18n';
import { carrierBrand } from '../../lib/carrierBrand';
import { carrierInfo, type CarrierInfo } from '../../lib/carriers';
import { useSheetDialog } from '../../lib/modal';
import { countryName } from '../../lib/trackingLocation';
import type { ParcelWithEvents } from '../../types';
import { clearPendingKeep, rememberPendingKeep } from '../pending';
import type { SignInMethods } from '../session';
import { Glyph } from './glyphs';

/** The parcel among other parcels: three little cards, the front one in its carrier's colours. */
export function CardStack({ carrier }: { carrier: CarrierInfo }) {
  return <span className="peekp-stack" aria-hidden="true">
    <span><CarrierTruck carrier={carrierInfo('gls-de')} /></span>
    <span><CarrierTruck carrier={carrierInfo('swiss-post')} /></span>
    <span><CarrierTruck carrier={carrier} /></span>
  </span>;
}

/** The invitation to an account, under the card: the whole row leads to signing in. */
export function AccountRow({ carrier, onSignIn }: { carrier: CarrierInfo; onSignIn: () => void }) {
  const { t } = useI18n();
  return <button type="button" className="peekp-account" onClick={onSignIn}>
    <CardStack carrier={carrier} />
    <span>
      <strong>{t('link.account.title')}</strong>
      <span className="peekp-textlink">{t('link.account.action')}<Icon name="chevron" /></span>
    </span>
  </button>;
}

/**
 * "Sign in to keep it": the parcel's line, what keeping does, and the ways to
 * sign in. The parcel is noted before a sign-in leaves the page or completes,
 * so it joins the account as soon as there is one.
 */
export function KeepSheet({ linkId, carrier, title, summary, methods, onClose }: {
  linkId: string;
  carrier: CarrierInfo;
  /** The parcel's name, or its number. */
  title: string;
  /** Its status and estimate, on one line. */
  summary: string;
  methods: SignInMethods;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const close = useRef<HTMLButtonElement>(null);
  const [dialog, dismiss] = useSheetDialog<HTMLDivElement>(true, () => {
    // Closing the sheet takes the wish back: a later sign-in keeps nothing by surprise.
    clearPendingKeep(linkId);
    onClose();
  }, close);
  const noted = <Arguments extends unknown[]>(signIn: ((...values: Arguments) => Promise<void>) | undefined) => signIn && ((...values: Arguments) => {
    rememberPendingKeep(linkId);
    return signIn(...values);
  });

  return createPortal(<div className="sheet-backdrop" onClick={dismiss}>
    <div ref={dialog} className="sheet peekp-keepsheet" role="dialog" aria-modal="true" aria-labelledby="peekp-keepsheet-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
      <div className="sheet__grabber" aria-hidden="true" />
      <div className="sheet__heading">
        <h2 className="sheet__title" id="peekp-keepsheet-title">{t('link.keep.action')}</h2>
        <button ref={close} className="sheet__close" type="button" onClick={dismiss} aria-label={t('common.close')}><Icon name="close" /></button>
      </div>
      <div className="peekp-keepsheet__parcel" style={carrierBrand(carrier).style}>
        <CarrierTruck carrier={carrier} />
        <span><strong>{title}</strong><small>{summary}</small></span>
      </div>
      <p className="peekp-keepsheet__what">{t('link.keep.sheet')}</p>
      <SignInScreen {...methods} card title={t('link.keep.action')} subtitle={t('link.keep.sheet')}
        signInWithGoogle={noted(methods.signInWithGoogle)} signInWithApple={noted(methods.signInWithApple)} verifyCode={noted(methods.verifyCode)!} />
    </div>
  </div>, document.body);
}

/** Someone signed in opened a link: one tap adds the parcel to their deliveries. */
export function AddToDeliveries({ busy, error, onAdd }: { busy: boolean; error: string | null; onAdd: () => void }) {
  const { t } = useI18n();
  return <div className="peekp-add">
    <button type="button" className="button button--primary" disabled={busy} aria-busy={busy} onClick={onAdd}><Icon name="plus" />{t('link.add')}</button>
    {error ? <p className="peekp-add__error" role="alert">{error}</p> : <p>{t('link.addHint')}</p>}
  </div>;
}

/** The parcel is in the reader's deliveries already. */
export function AlreadyFollowed({ name, onOpen }: { name: string; onOpen: () => void }) {
  const { t } = useI18n();
  return <div className="peekp-already" role="note">
    <span aria-hidden="true"><Icon name="parcel" /></span>
    <div>
      <strong>{t('link.already.title')}</strong>
      <p>{t('link.already.body', { name })}</p>
      <button type="button" className="peekp-textlink" onClick={onOpen}>{t('link.open')}<Icon name="chevron" /></button>
    </div>
  </div>;
}

/**
 * Above the card of a parcel someone else shared. A visitor is told that
 * following it needs no account; once the journey is over, `until` is the day
 * the link stops working.
 */
export function SharedWithYou({ visitor = false, until = null }: { visitor?: boolean; until?: string | null }) {
  const { t } = useI18n();
  return <p className="peekp-shared"><Glyph name="link" />{until ? t('share.withYouUntil', { date: until }) : t(visitor ? 'share.withYou' : 'link.shared')}</p>;
}

/** A parcel that crossed a border earns a stamp: the way into the passport. */
export function PassportTeaser({ parcel, origin, onStart }: { parcel: ParcelWithEvents; origin: string; onStart: () => void }) {
  const { t, languageTag } = useI18n();
  return <section className="peekp-passport" aria-labelledby="peekp-passport-title">
    <span className="peekp-passport__stamp tone-blue" aria-hidden="true"><ParcelStamp parcel={parcel} /></span>
    <div>
      <h2 id="peekp-passport-title">{t('link.passport.title')}</h2>
      <p>{t('link.passport.body', { country: countryName(origin, languageTag) })}</p>
      <button type="button" className="peekp-textlink" onClick={onStart}>{t('link.passport.action')}<Icon name="chevron" /></button>
    </div>
  </section>;
}
