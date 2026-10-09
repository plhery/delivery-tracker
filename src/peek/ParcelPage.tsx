import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, ParcelIllustration } from '../components/Icon';
import { ParcelMapSheet, useParcelRoute } from '../components/ParcelMap';
import type { Rect } from '../components/map/WorldMap';
// The journal and the pickup card keep their styles with the deliveries' detail.
import '../components/ParcelDetail.css';
import { PeekLockup } from '../components/PeekMark';
import { PickupPointCard } from '../components/PickupPointCard';
import { stampOrigin } from '../components/ParcelStamp';
import { TrackingJournal } from '../components/TrackingJournal';
import { localizedDeliveryWindow, localizedEventDescription, stageLabel, useI18n, type MessageKey } from '../i18n';
import { trackAction, trackScreen } from '../lib/analytics';
import { carrierBrand } from '../lib/carrierBrand';
import { activeTrackingCarrierId, carrierInfo, deliveringCarrierId, displayedCarrierId, formatTrackingNumber, tracksAutomatically } from '../lib/carriers';
import { LANDING_PATH } from '../lib/experience';
import { captureCardOrigin } from '../lib/cardTransition';
import { useCardDialog } from '../lib/cardDialog';
import { focusClickedButton } from '../lib/modal';
import { parcelDeliveryEstimate, parcelHasCarrierUpdate, parcelIsUnannounced } from '../lib/parcelStatus';
import { pickupPoint } from '../lib/pickupPoint';
import { currentEvent, isFinal, sortEventsDesc } from '../lib/stages';
import { useTabTitle } from '../lib/tabTitle';
import { deviceAlert } from './alerts';
import { linkNote, noteLink, useLinkNote } from './deviceNotes';
import { collapseGiftRows, isWrappedGift, maskedNumber, parcelLinkErrorKey, sendLinkFeedback, type ParcelLinkView } from './links';
import { Actions, type PingAction } from './parcel/Actions';
import { AlertsSheet } from './parcel/AlertsSheet';
import { deliveryCalendar, deliverySlot, downloadCalendar } from './parcel/calendar';
import { CardBell, LinkCard } from './parcel/Card';
import { carrierLinks, FreshnessLine, Notes, NumberSection, ShipmentFacts } from './parcel/Details';
import { FeedbackOverlays, FeedbackQuestion, useParcelFeedback } from './parcel/Feedback';
import { scanIdentity } from './parcel/feedbackModel';
import { linkFeedbackNotes } from './parcel/feedbackNotes';
import { ForgetDialog, ForgetFooter, forgetParcel } from './parcel/Forget';
import { GiftNote, GiftSurprise } from './parcel/Gift';
import { Glyph } from './parcel/glyphs';
import { useNow, useOffline, useWideLayout } from './parcel/hooks';
import { AccountRow, AddToDeliveries, AlreadyFollowed, KeepSheet, PassportTeaser, SharedWithYou } from './parcel/Keep';
import { OtherParcels } from './parcel/OtherParcels';
import { RouteMap } from './parcel/RouteMap';
import { SampleInvitation, SampleNote } from './parcel/Sample';
import { copyText, shareParcelLink } from './parcel/share';
import { LinkShareSheet } from './parcel/ShareSheet';
import {
  capitalized,
  forgetDate,
  giftArrival,
  giftDelivered,
  journeyEndedBefore,
  momentLabel,
  parcelDetail,
  parcelFlag,
  parcelFreshness,
  parcelHeadline,
  parcelStage,
  parcelTabTitle,
  previousEstimateLine,
} from './parcel/summary';
import { announceNotice, Toast } from './parcel/Toast';
import { announceKeepOutcome, onKeepOutcome, usePendingKeep, type KeepOutcome } from './pending';
import { recentFor, renameParcel } from './recents';
import { closeParcelLink, forgetParcelLinkOpener, leaveParcelLink, openLanding, parcelLinkOpener, parcelLinkURL, PIP_TRANSITION_NAME } from './route';
import { SAMPLE_LINK_ID } from './sample';
import { usePeekSession } from './session';
import { useParcelLink, type ParcelLinkState } from './useParcelLink';
import './ParcelPage.css';

/** How long a word at the edge of the screen stays. */
const TOAST_MS = 4_000;
const OWN_LINK_AFTER_MS = 1_400;
const OWN_LINK_MS = 10_000;
const NEWS_MS = 7_000;

/** The way back to the front door: closing, for a page that lies over it. */
const Leave = createContext<() => void>(leaveParcelLink);

/**
 * A page opened from the front door lies over it, as a parcel's page lies over
 * the deliveries: it grows out of the card it was opened with, or of Pip for
 * his sample, closes back into it, and can be pulled down from its top.
 */
function OverDoor({ linkId, children }: { linkId: string; children: ReactNode }) {
  const { t } = useI18n();
  // Measured once, where the card stands as the page opens.
  const [origin] = useState(() => captureCardOrigin(parcelLinkOpener(linkId) ?? undefined));
  useEffect(forgetParcelLinkOpener, []);
  const [dialog, leave] = useCardDialog<HTMLDivElement>(closeParcelLink, undefined, {
    origin,
    findCard: () => linkId === SAMPLE_LINK_ID ? document.querySelector<HTMLElement>('.door-pip')
      : document.querySelector<HTMLElement>(`[data-parcel-link="${CSS.escape(linkId)}"]`),
    // On a wide screen the page writes beside its map, as the door's cards do: both land on the card.
    anchor: (page) => page.querySelector<HTMLElement>('.peekp-columns[data-beside], .peekp-card'),
    worded: (page) => page.querySelector<HTMLElement>('.peekp-card'),
  });
  return createPortal(<div className="sheet-backdrop peekp-backdrop">
    <div ref={dialog} className={`peekp-over${origin ? ' peekp-over--from-card' : ''}`} role="dialog" aria-modal="true" aria-label={t('detail.label')} tabIndex={-1}>
      <Leave.Provider value={leave}>{children}</Leave.Provider>
    </div>
  </div>, document.body);
}

/**
 * One parcel at its own address, for anyone with the link. `entrance="reveal"`
 * is the hand-over from the front door, with the lookup's answer as `initial`;
 * a link opened directly loads on its own. The sample parcel is shown the same
 * way, as its owner would see it: it says that it is a sample, and leads to a
 * parcel of one's own instead of being kept or forgotten. `over` says the
 * front door is still there underneath.
 */
export function ParcelPage({ over = false, ...page }: {
  linkId: string;
  entrance?: 'reveal' | 'direct';
  initial?: ParcelLinkView;
  over?: boolean;
}) {
  return over ? <OverDoor linkId={page.linkId}><Page {...page} /></OverDoor> : <Page {...page} />;
}

function Page({ linkId, entrance = 'direct', initial }: {
  linkId: string;
  entrance?: 'reveal' | 'direct';
  initial?: ParcelLinkView;
}) {
  const { t } = useI18n();
  const session = usePeekSession();
  const state = useParcelLink(linkId, initial);
  const signedIn = session.account === 'signed-in';
  const sample = linkId === SAMPLE_LINK_ID;
  useEffect(() => { trackScreen('parcel-link', sample ? 'demo' : signedIn ? 'account' : 'anonymous'); }, [sample, signedIn]);

  // Someone signed in goes back to their deliveries; a visitor to the front door.
  const openDeliveries = session.openDeliveries;
  const leave = useContext(Leave);
  const home = useCallback(() => { if (openDeliveries) openDeliveries(); else leave(); }, [openDeliveries, leave]);

  if (state.status === 'unavailable') return <Gone onHome={home} />;
  if (state.status === 'stopped') return <Gone stopped onHome={home} />;
  if (!state.view) {
    return <Shell onHome={home} title={`${t('status.syncing')} · ${t('app.title')}`} entrance={entrance}>
      <div className="peekp-waiting">
        <div className="peekp-pip peekp-pip--hero" style={{ viewTransitionName: PIP_TRANSITION_NAME }}><ParcelIllustration /></div>
        {state.trouble ? <>
          <p role="alert">{t(parcelLinkErrorKey(state.trouble))}</p>
          <button type="button" className="button button--secondary" disabled={state.refreshing} onClick={() => void state.refresh()}>{t('app.tryAgain')}</button>
        </> : <p role="status">{t('status.syncing')}</p>}
      </div>
    </Shell>;
  }
  return <Parcel linkId={linkId} entrance={entrance} state={state} view={state.view} onHome={home} />;
}

/** The page's frame: the name that leads home, the page's own controls, and the tab's title. */
function Shell({ title, onHome, controls, banner, brand, entrance, live, news, children }: {
  title: string;
  onHome: () => void;
  controls?: ReactNode;
  banner?: ReactNode;
  brand?: CSSProperties;
  entrance: 'reveal' | 'direct';
  live?: boolean;
  news?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  // When the page closes the tab is the app's: the title the page was loaded with was the parcel's.
  useTabTitle(title, `${t('app.title')} — ${t('app.tagline')}`);
  // A sheet hands the focus back to the button that opened it, in Safari too.
  return <div className="peekp" style={brand} onClickCapture={focusClickedButton}>
    {banner}
    <header className="peekp-header">
      <button type="button" className="peekp-home" aria-label={t('app.title')} onClick={onHome}><PeekLockup /></button>
      {controls && <div className="peekp-header__controls">{controls}</div>}
    </header>
    <main className="peekp-main" data-entrance={entrance} data-live={live || undefined} data-news={news || undefined}>{children}</main>
  </div>;
}

/**
 * A link that leads nowhere. Forgotten, expired and never made all look the
 * same; a link whose owner `stopped` sharing it says so, and that the parcel
 * can be followed again by its number.
 */
function Gone({ stopped = false, onHome }: { stopped?: boolean; onHome: () => void }) {
  const { t } = useI18n();
  const title = t(stopped ? 'share.stopped.title' : 'link.gone.title');
  return <Shell onHome={onHome} title={`${title} · ${t('app.title')}`} entrance="direct">
    <div className="peekp-gone" data-reason={stopped ? 'stopped' : 'gone'}>
      <div className="peekp-gone__pip" aria-hidden="true"><ParcelIllustration /></div>
      <h1>{title}</h1>
      <p>{t(stopped ? 'share.stopped.body' : 'link.gone.body')}</p>
      <button type="button" className="button button--primary" onClick={onHome}>{t('peek.title')}</button>
      {!stopped && <p className="peekp-gone__same">{t('link.gone.same')}</p>}
    </div>
  </Shell>;
}

type Word = { kind: 'own-link' | 'copied' | 'copy-failed' | 'calendar' | 'calendar-failed' };

function Parcel({ linkId, entrance, state, view, onHome }: {
  linkId: string;
  entrance: 'reveal' | 'direct';
  state: ParcelLinkState;
  view: ParcelLinkView;
  onHome: () => void;
}) {
  const { t, locale, languageTag } = useI18n();
  const session = usePeekSession();
  const leave = useContext(Leave);
  const { trouble, checking, live, refreshing, seenAt, news, unseen, previousEstimate, refresh, dismissNews, adopt } = state;
  const { parcel, numberHint, link } = view;
  const now = useNow();
  const wide = useWideLayout();
  const wording = { t, languageTag, now };

  const stage = parcelStage(parcel);
  const delivered = stage === 'delivered';
  const owner = link.role === 'owner';
  const sample = linkId === SAMPLE_LINK_ID;
  // The sample comes with a name; another one lasts as long as the page.
  const [renamed, setRenamed] = useState<{ name: string | null } | null>(null);
  // A gift, as its recipient sees it: wrapped while it is on its way, opened once it is delivered.
  const wrapped = isWrappedGift(view);
  const opened = link.gift === true && !owner && delivered;
  const present = wrapped || opened;
  // The recipient of a gift reads its name as what is inside, and only once it is there.
  const name = present ? null : sample ? (renamed ? renamed.name : parcel.label || null) : state.name;
  const displayed = carrierInfo(displayedCarrierId(parcel), locale);
  const moving = parcelHasCarrierUpdate(parcel);
  // No carrier has been found for the number yet: the card stays neutral.
  const carrierKnown = parcel.carrier !== 'unknown' || moving;
  const number = parcel.trackingNumber ? formatTrackingNumber(parcel.trackingNumber, parcel.carrier)
    : numberHint ? maskedNumber(numberHint) : null;
  const headline = wrapped ? t('share.gift.headline') : opened ? t('share.gift.here') : parcelHeadline(parcel, t);
  const detail = wrapped ? giftArrival(parcel, wording) : (opened ? giftDelivered(parcel, wording) : null) ?? parcelDetail(parcel, wording);
  const offline = useOffline() || trouble?.kind === 'offline';
  const failing = trouble && !offline ? trouble : null;
  // A number no carrier knows yet says so in its headline already.
  const flag = (carrierKnown ? parcelFlag(parcel, now) : null) ?? (failing ? 'sync_error' : null);
  const freshness = parcelFreshness({ parcel, checking, offline, trouble: !!failing, seenAt }, wording);
  // The carrier's own page would tell a gift's recipient where it comes from.
  const links = wrapped ? [] : carrierLinks(view, locale);
  const scan = currentEvent(parcel.events);

  const afterwards = journeyEndedBefore(parcel, now);
  // Later, a phone's card has no map: the page winds down.
  const { placed, route } = useParcelRoute(parcel, languageTag, !present && (wide || !afterwards));
  const beside = wide && placed && !present;
  const figure = present ? 'hero' : !wide && placed ? 'map' : delivered && !afterwards ? 'hero' : beside && !afterwards ? 'none' : 'kraft';
  const [mapOpen, setMapOpen] = useState(false);
  const openMap = () => { if (route) { trackAction('parcel-map-open'); setMapOpen(true); } };

  const activeCarrier = carrierInfo(activeTrackingCarrierId(parcel), locale);
  // Handed from one carrier to another, or about to be, the card carries both marks and says who delivers, as a parcel's
  // own card does. So does a gift's: its journey tells the country it comes from anyway, and the one who rings is news.
  const deliveringId = deliveringCarrierId(parcel);
  const delivering = carrierKnown && deliveringId ? carrierInfo(deliveringId, locale) : null;
  const deliveryNote = delivering ? t('parcel.deliveryCarrier', { carrier: delivering.name }) : null;
  const notes = present ? (deliveryNote ? [deliveryNote] : []) : !carrierKnown ? [number ? t('link.unknown.body', { number }) : t('link.unknown.bodyNoNumber')] : [
    previousEstimateLine(previousEstimate, parcel, wording),
    deliveryNote,
    !checking && (parcelIsUnannounced(parcel) || stage === 'registered') ? t('link.notScanned', { carrier: displayed.name }) : null,
  ].filter((note): note is string => !!note);

  // The reveal's last beat: the parcel's own link, offered once the card has settled.
  const [word, setWord] = useState<Word | null>(null);
  useEffect(() => {
    if (entrance !== 'reveal' || sample) return;
    const timer = setTimeout(() => setWord({ kind: 'own-link' }), OWN_LINK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [entrance, sample]);
  useEffect(() => {
    if (!word) return;
    const timer = setTimeout(() => setWord((current) => current === word ? null : current), word.kind === 'own-link' ? OWN_LINK_MS : TOAST_MS);
    return () => clearTimeout(timer);
  }, [word]);
  useEffect(() => {
    if (!news) return;
    const timer = setTimeout(dismissNews, NEWS_MS);
    return () => clearTimeout(timer);
  }, [news, dismissNews]);

  const address = parcelLinkURL(linkId);
  // Forgetting and changing what the link shows are the owner's alone: they need the key this device holds.
  const key = owner ? recentFor(linkId)?.key ?? null : null;
  const [sharing, setSharing] = useState(false);
  async function share() {
    // The owner chooses what the link shows; anyone else passes on the plain link.
    if (key) {
      setSharing(true);
      return;
    }
    const outcome = await shareParcelLink(address);
    if (outcome === 'copied') setWord({ kind: 'copied' });
    if (outcome === 'failed') setWord({ kind: 'copy-failed' });
  }
  async function copyLink() {
    const copied = await copyText(address);
    trackAction('parcel-link-share', copied ? 'success' : 'error');
    setWord({ kind: copied ? 'copied' : 'copy-failed' });
  }

  // What a manual check found, for a reader who cannot see the card change.
  const [checked, setChecked] = useState('');
  async function check() {
    setChecked(t('app.refreshing'));
    setChecked(t(await refresh() ? 'app.refreshComplete' : 'app.refreshUnchanged'));
  }

  // Keeping: a visitor signs in first; someone signed in adds the parcel with one tap.
  const signedIn = session.account === 'signed-in';
  const pendingId = usePendingKeep();
  // `email` when signing in was asked for the delivery email, which is then switched on with the parcel.
  const [keepSheet, setKeepSheet] = useState<'keep' | 'email' | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<MessageKey | null>(null);
  const followed = signedIn && parcel.trackingNumber
    ? session.deliveries?.find((own) => own.trackingNumber === parcel.trackingNumber) : undefined;

  function signInFor(email: boolean) {
    trackAction('parcel-link-sign-in');
    // The email row of "Notify me" is counted apart from every other way to sign in.
    if (email) trackAction('parcel-link-email');
    if (link.canKeep && session.signInWith?.configured) setKeepSheet(email ? 'email' : 'keep');
    else session.signIn(link.canKeep ? linkId : undefined, email);
  }
  const signInToKeep = () => signInFor(false);

  const stopListening = useRef<() => void>(() => undefined);
  const openDeliveries = session.openDeliveries;
  const settle = useCallback((outcome: KeepOutcome) => {
    setAdding(false);
    if (outcome.outcome !== 'kept' && outcome.outcome !== 'already') {
      setAddError(outcome.outcome === 'quota' ? 'linkapp.full' : outcome.outcome === 'unavailable' ? 'link.gone.title' : 'add.failed');
      return;
    }
    // The deliveries say how it ended: this page stops listening, so the word reaches them.
    stopListening.current();
    openDeliveries?.(outcome.outcome === 'already' ? outcome.packageId : undefined);
    announceKeepOutcome(outcome);
  }, [openDeliveries]);
  useEffect(() => {
    if (!signedIn) return;
    // A parcel noted before signing in is kept by the app's entry point; its outcome arrives here.
    const stop = onKeepOutcome((outcome) => queueMicrotask(() => settle(outcome)));
    stopListening.current = stop;
    return stop;
  }, [signedIn, settle]);

  async function add() {
    if (!session.keep || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      settle(await session.keep(linkId));
    } catch {
      settle({ id: linkId, outcome: 'failed', name });
    }
  }

  // Forgetting: the owner's alone, asked once.
  const [forgetting, setForgetting] = useState<false | 'asked' | 'arrived'>(false);
  async function forget() {
    if (!key) return;
    await forgetParcel(linkId, key);
    announceNotice('link.forget.done');
    leave();
  }
  const askToForget = key ? () => setForgetting('asked') : undefined;

  const final = !!stage && isFinal(stage);

  // Alerts and the calendar: for anyone with the link, until the journey is over.
  const alert = useLinkNote(linkId).alert;
  const [alerting, setAlerting] = useState(false);
  const openAlerts = () => { trackAction('parcel-link-alerts-open'); setAlerting(true); };
  useEffect(() => {
    // A browser that withdrew its permission has no alert, whatever it noted; a parcel that arrived has none left.
    if (!final) void deviceAlert(linkId);
    else if (linkNote(linkId).alert) noteLink(linkId, { alert: null });
  }, [linkId, final]);
  const estimate = parcelDeliveryEstimate(parcel, now);
  const slot = deliverySlot(parcel, now);
  const calendarWindow = slot && estimate ? capitalized(localizedDeliveryWindow(parcel.expectedDeliveryFrom, estimate, t, languageTag, now), languageTag) : null;
  function calendarFile(): boolean {
    return !!slot && downloadCalendar(deliveryCalendar({
      slot, title: name ?? headline, description: t('link.preview.follow'), url: address, uid: `${linkId}@peek`,
    }));
  }
  function addToCalendar() {
    const done = calendarFile();
    trackAction('parcel-link-calendar', done ? 'success' : 'error');
    setWord({ kind: done ? 'calendar' : 'calendar-failed' });
  }
  // Nothing scanned yet: being told is the one next step, and every scan is worth telling.
  const early = !moving || stage === 'registered';
  const canPing = !final && !checking;
  // A wrapped gift says little, and keeps its one button in its card; any other parcel has it among its actions.
  const ping: PingAction | undefined = canPing && !wrapped ? {
    label: t(alert ? 'alerts.action.on' : !carrierKnown ? 'alerts.action.found' : early ? 'alerts.action.moves' : 'alerts.action.ping'),
    long: !alert && owner && !early ? t('alerts.title') : undefined,
    prominent: !alert && early,
    onOpen: openAlerts,
  } : undefined;
  const bell = canPing && wrapped && <CardBell label={t(alert ? 'alerts.action.on' : 'alerts.action.ping')} on={!!alert} onOpen={openAlerts} />;
  const forgetOn = forgetDate(link.forgetAt, languageTag);
  const forgetLine = forgetOn ? t('link.forget.on', { date: forgetOn }) : null;
  // Someone the link was shared with reads above the card how long it works; the owner reads the date at the foot.
  const worksUntil = !owner && !present && final ? forgetOn : null;
  // Nothing of the sample is stored, so there is nothing to promise to forget.
  const promise = sample || worksUntil ? null : final ? forgetLine : link.kind === 'lookup' ? t('link.forget.promise') : null;

  const visitor = session.account === 'visitor';
  const visitorCanKeep = visitor && link.canKeep;
  const placedScans = sortEventsDesc(parcel.events).filter((event) => event.place);
  const origin = stampOrigin(parcel);
  // The journey ended in another country than the one it was first scanned in.
  const abroad = delivered && origin && placedScans[0]?.place?.country !== origin ? origin : null;

  const waitingAt = stage === 'ready_for_pickup' ? pickupPoint(parcel.pickupPoint) : null;
  const automatic = tracksAutomatically(activeCarrier.id);
  const brand = carrierBrand(displayed).style;
  const summary = [headline, detail].filter(Boolean).join(' · ');

  // The reader is asked whether the page is right, or who carries a parcel no carrier was found for. Not the one a
  // gift is for, who is shown little of it; not about the sample; and not before a first answer is on the page.
  const feedbackNotes = useMemo(() => linkFeedbackNotes(linkId), [linkId]);
  const feedback = useParcelFeedback({
    kind: sample || present || checking || offline || afterwards ? null
      : !carrierKnown ? 'unknown' : automatic || moving ? 'found' : null,
    scan: scanIdentity(parcel),
    carrier: displayed.name,
    busy: !!word || sharing || alerting || !!keepSheet || !!forgetting || mapOpen,
    notes: feedbackNotes,
    send: (answer) => sendLinkFeedback(linkId, answer, key),
  });

  const teaser = abroad && !afterwards && !present && visitor && <PassportTeaser parcel={parcel} origin={abroad} onStart={signInToKeep} />;
  // The sample's way back to the landing: at its own address for someone signed in, whose `/` is their deliveries.
  const landingPath = signedIn ? LANDING_PATH : '/';
  const toLanding = () => { if (signedIn) openLanding(); else leave(); };
  const invitation = sample && <SampleInvitation carrier={displayed} onTrack={onHome} onSignIn={visitor ? signInToKeep : undefined} />;
  const map = (shape: 'card' | 'tile', covered?: Rect | null, room?: number) =>
    <RouteMap route={route} parcel={parcel} stage={stage} shape={shape} pip={figure === 'map' || figure === 'none'} covered={covered} room={room} onOpen={openMap} />;

  return <Shell
    onHome={onHome}
    title={present ? `${unseen > 0 ? `(${unseen}) ` : ''}${headline} · ${t('app.title')}` : parcelTabTitle({ parcel, name, checking, unseen }, wording)}
    brand={brand}
    entrance={entrance}
    live={live}
    news={!!news}
    banner={offline && <p className="peekp-offline" role="status"><Glyph name="offline" />{t('link.offline', { time: momentLabel(scan?.occurredAt ?? seenAt ?? '', wording) })}</p>}
    controls={present ? undefined : <>
      <button type="button" className="icon-button" aria-label={t('app.trackAnother')} onClick={onHome}><Icon name="search" /></button>
      <button type="button" className="icon-button peekp-header__share" aria-label={t('link.shareAria')} onClick={() => void share()}><Icon name="share" /><span>{t('link.share')}</span></button>
      {/* The sample has its own invitation, at its foot. */}
      {visitor && !sample && <button type="button" className="peekp-header__signin" onClick={signInToKeep}>{t('arrival.signInTitle')}</button>}
    </>}
  >
    <div className="peekp-columns" data-beside={beside || undefined}>
      <div className="peekp-column">
        {followed && <AlreadyFollowed name={followed.label || t('common.parcel')} onOpen={() => { trackAction('parcel-link-open-existing'); openDeliveries?.(followed.id); }} />}
        {sample ? <SampleNote landingPath={landingPath} onLanding={toLanding} /> : !owner && !present && <SharedWithYou visitor={!signedIn} until={worksUntil} />}
        <LinkCard parcel={parcel} stage={stage} carrier={carrierKnown ? displayed : null} delivery={delivering}
          headline={headline} name={name} detail={detail} notes={notes} flag={flag} figure={figure} number={number} settled={entrance === 'reveal' && !checking}
          gift={wrapped ? 'wrapped' : opened ? 'opened' : link.gift ? 'own' : undefined}
          map={figure === 'map' ? (covered, room) => map('card', covered, room) : undefined}
          bell={bell} />
        <p className="sr-only" role="status">{checked}</p>
        {wrapped && <GiftSurprise />}
        {opened && <GiftNote note={state.words.note} from={state.words.from} inside={state.words.name ?? state.name} />}
        {owner && link.shared === false && <p className="peekp-shared"><Glyph name="info" />{t('share.stopped.owner')}</p>}
        {!carrierKnown && <p className="peekp-keeppage">{t('link.unknown.keep')}</p>}
        {signedIn && !followed && link.canKeep && <AddToDeliveries busy={adding || pendingId === linkId} error={addError && t(addError)} onAdd={() => void add()} />}
        {!afterwards && <Actions name={name} ping={ping}
          onHave={key && delivered && link.kind === 'lookup' ? () => setForgetting('arrived') : undefined}
          onCalendar={!owner && slot ? addToCalendar : undefined}
          onShare={owner ? () => void share() : undefined}
          onRename={present ? undefined : sample ? (next) => setRenamed({ name: next }) : (next) => renameParcel(linkId, next)} compactName={!owner} />}
        {carrierKnown && <Notes view={view} stage={stage} flag={flag} trouble={failing} carrier={displayed} />}
        {waitingAt && <PickupPointCard point={waitingAt} />}
        {!beside && teaser}
        {/* One invitation at a time: the passport's, on the day a parcel from abroad arrives, else the account's. */}
        {visitorCanKeep && !teaser && <AccountRow carrier={displayed} onSignIn={signInToKeep} />}
        {!wrapped && <NumberSection view={view} links={links} onVisit={(link) => feedback.visited(link.name)} />}
        <ShipmentFacts parcel={parcel} stage={stage} />
        {carrierKnown && (automatic || moving) && <section className="peekp-journal">
          <TrackingJournal events={wrapped ? collapseGiftRows(parcel.events) : parcel.events} syncing={checking} fold />
        </section>}
        {!final && freshness.kind !== 'live' && <FreshnessLine freshness={freshness} busy={refreshing} onCheck={() => void check()} />}
        <FeedbackQuestion feedback={feedback} />
        {/* The sample ends on the way to a parcel of one's own; any other page on the device's other parcels. */}
        {sample ? !beside && invitation
          : <OtherParcels linkId={linkId} visitor={visitor} over={afterwards} onTrackAnother={onHome} onSignIn={signInToKeep} />}
      </div>
      {beside && <div className="peekp-column">
        {map('tile')}
        {teaser}
        {invitation}
      </div>}
    </div>
    <ForgetFooter promise={promise} onForget={askToForget} />

    {news && <Toast place="top" tone mark={<Icon name="truck" />}>
      <strong>{t('link.updateToast')}</strong> · {localizedEventDescription(news.description, t) || stageLabel(t, news.stage)}
    </Toast>}
    {word?.kind === 'own-link' && <Toast tone mark={<Glyph name="link" />} action={<button type="button" onClick={() => void copyLink()}>{t('detail.copy')}</button>}>
      {t('link.own')}<small>{address.replace(/^https?:\/\//, '')}</small>
    </Toast>}
    {word?.kind === 'copied' && <Toast>{t('link.copied')}</Toast>}
    {word?.kind === 'copy-failed' && <Toast mark={<Glyph name="info" />}>{t('link.shareFailed')}</Toast>}
    {word?.kind === 'calendar' && <Toast>{t('alerts.calendar.done')}</Toast>}
    {word?.kind === 'calendar-failed' && <Toast mark={<Glyph name="info" />}>{t('alerts.calendar.failed')}</Toast>}
    {keepSheet && session.signInWith && <KeepSheet linkId={linkId} carrier={displayed} title={name ?? number ?? t('common.parcel')} summary={summary}
      email={keepSheet === 'email'} methods={session.signInWith} onClose={() => setKeepSheet(null)} />}
    {sharing && key && <LinkShareSheet linkId={linkId} ownerKey={key} view={view} name={name} onChanged={adopt}
      worksUntil={final ? forgetOn : null} onAccount={visitor ? signInToKeep : undefined} onClose={() => setSharing(false)} />}
    {alerting && <AlertsSheet linkId={linkId} ownerKey={key} alerts={link.alerts} initialPreset={early ? 'all' : 'important'}
      calendar={calendarWindow} onCalendar={calendarFile}
      onSignIn={session.account === 'visitor' && !sample ? signInFor : undefined} onClose={() => setAlerting(false)} />}
    {forgetting && <ForgetDialog arrived={forgetting === 'arrived' ? { forgetLine } : undefined} onForget={forget} onCancel={() => setForgetting(false)} />}
    {mapOpen && route && <ParcelMapSheet route={route} stage={stage ?? undefined} brand={brand} onClose={() => setMapOpen(false)} />}
    <FeedbackOverlays feedback={feedback} />
  </Shell>;
}
