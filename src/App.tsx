import './components/Deliveries.css';
import { trackAction, trackScreen } from './lib/analytics';
import { focusClickedButton } from './lib/modal';
import { glideNextListChange } from './lib/listGlide';
import { useDeliveredHold } from './lib/deliveredHold';
import { takeResumedScreen, type ResumedScreen } from './lib/pwaUpdates';
import { REFRESH_MESSAGES, refreshOutcome, userErrorMessage } from './lib/userMessages';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AddParcelSheet } from './components/AddParcelSheet';
import { ParcelAddedBurst } from './components/ParcelAddedBurst';
import { AccountMenu } from './components/AccountMenu';
import { AppFoot } from './components/AppFoot';
import { NotificationPrompt } from './components/NotificationPrompt';
import { AppNavigation, type AppTab } from './components/AppNavigation';
import { ParcelCard } from './components/ParcelCard';
import { ParcelDetail } from './components/ParcelDetail';
import { Passport } from './components/Passport';
import { Friends } from './components/Friends';
import { createFriendsClient } from './lib/friends';
import { captureCardOrigin, type CardOrigin } from './lib/cardTransition';
import { Icon, ParcelIllustration } from './components/Icon';
import { PeekLockup, PeekMark } from './components/PeekMark';
import { ParcelViewControls } from './components/ParcelViewControls';
import { PullToRefresh } from './components/PullToRefresh';
import { ToastMark } from './components/ToastMark';
import { useRefreshAnimation } from './lib/useRefreshAnimation';
import {
  type MessageKey,
  useI18n,
} from './i18n';
import type { ApiAuth } from './lib/apiClient';
import { carrierInfo } from './lib/carriers';
import { usePostcodeMemory } from './lib/postcodeMemory';
import { usedCarrierIds } from './lib/carrierPicker';
import {
  isActiveParcel,
  nextPriorityParcel,
  parcelAttention,
  prioritizeActiveParcels,
  type ParcelAttention,
} from './lib/parcelPriority';
import {
  parcelComparator,
  sortPastParcels,
  viewParcels,
  type ParcelSort,
  type ParcelStatusFilter,
} from './lib/parcelView';
import {
  clearSharedParcelInput,
  readSharedParcel,
  type ShareFailure,
  type SharedParcel,
} from './lib/shareTarget';
import { currentStage, isDelivered } from './lib/stages';
import { loadNotificationPreferences } from './store/notificationPreferences';
import { useParcels } from './store/ParcelsContext';
import { onKeepOutcome, type KeepOutcome } from './peek/pending';
import type { CarrierId, ParcelWithEvents } from './types';

const DETAIL_HISTORY_KEY = 'parcelPostDetail';
const PARCEL_VIEW_CONTROLS_ID = 'parcel-view-controls';

const ATTENTION_LABELS: Record<ParcelAttention, MessageKey> = {
  sync_error: 'attention.sync_error',
  failed_attempt: 'attention.failed_attempt',
  ready_for_pickup: 'attention.ready_for_pickup',
  exception: 'attention.exception',
  customs: 'attention.customs',
  stalled: 'attention.stalled',
  not_announced: 'attention.not_announced',
};

/** How keeping a parcel from its link ended, as the deliveries say it. */
const KEEP_MESSAGES = {
  kept: 'link.kept',
  already: 'link.already.title',
  quota: 'linkapp.full',
  unavailable: 'link.gone.title',
  failed: 'add.failed',
} as const satisfies Record<KeepOutcome['outcome'], MessageKey>;
/** The same, for someone who signed in to be emailed and now is. */
const KEEP_EMAIL_MESSAGES: Partial<Record<KeepOutcome['outcome'], MessageKey>> = {
  kept: 'link.keptEmail',
  already: 'link.alreadyEmail',
};

/** Why something shared to the installed app did not come through, as the add sheet says it. */
const SHARE_FAILURE_MESSAGES = {
  'too-large': 'add.shareTooLarge',
  failed: 'add.shareFailed',
} as const satisfies Record<ShareFailure, MessageKey>;

export default function App({
  accountEmail,
  onSignOut,
  onExportAccount,
  onDeleteAccount,
  apiAuth,
  onExitDemo,
  onOpenLanding,
}: {
  accountEmail?: string;
  onSignOut?: () => Promise<void>;
  onExportAccount?: () => Promise<void>;
  onDeleteAccount?: (confirmation: string) => Promise<void>;
  apiAuth?: ApiAuth;
  onExitDemo?: () => void;
  /** Shows the landing: at its own address for an account, at `/` for the demo of a visitor. */
  onOpenLanding?: () => void;
} = {}) {
  const { t } = useI18n();
  const {
    parcels,
    loading,
    refreshing,
    error,
    authenticationRequired,
    usingCachedData,
    mode,
    addParcel,
    renameParcel,
    changeParcelCarrier,
    setParcelNotificationsMuted,
    setParcelEmailMuted,
    removeParcel,
    restoreParcel,
    deleteParcel,
    refresh,
    refreshParcel,
    retryLoad,
    resetDemoData,
  } = useParcels();
  // What was shared to the installed app, handed to the add sheet it opens.
  const [shared, setShared] = useState<SharedParcel | null>(null);
  const [adding, setAdding] = useState(false);
  const [parcelBurst, setParcelBurst] = useState<string | null>(null);
  const finishParcelBurst = useCallback(() => setParcelBurst(null), []);
  const [undoParcel, setUndoParcel] = useState<ParcelWithEvents | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  // Working notices report a refresh in progress and stay until it ends.
  const [refreshNotice, setRefreshNotice] = useState<{ text: string; mark: 'pending' | 'success'; working?: boolean } | null>(null);
  const { icon: refreshIcon, busy: refreshAnimating, run: animateRefresh } = useRefreshAnimation();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ParcelStatusFilter>('all');
  const [carrierFilter, setCarrierFilter] = useState<CarrierId | ''>('');
  const [sort, setSort] = useState<ParcelSort>('priority');
  const [viewControlsOpen, setViewControlsOpen] = useState(false);
  const searchToggle = useRef<HTMLButtonElement>(null);
  const searchShell = useRef<HTMLDivElement>(null);
  // Search folds shut before it goes, and the list rises with it.
  function closeViewControls() {
    const shell = searchShell.current;
    if (!shell?.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setViewControlsOpen(false); return; }
    if (shell.dataset.leaving) return;
    shell.dataset.leaving = 'true';
    const { height, marginBottom } = getComputedStyle(shell);
    void shell.animate([{ height, marginBottom, opacity: 1 }, { height: '0px', marginBottom: '0px', opacity: 0 }],
      { duration: 220, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' }).finished.catch(() => undefined).then(() => setViewControlsOpen(false));
  }
  const deliveriesPage = useRef<HTMLDivElement>(null);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [viewNow, setViewNow] = useState(() => Date.now());
  const [openParcelId, setOpenParcelId] = useState<string | null>(null);
  const [detailOrigin, setDetailOrigin] = useState<CardOrigin | null>(null);
  const [tab, setTab] = useState<AppTab>('deliveries');
  const scrollPositions = useRef({ deliveries: 0, passport: 0, friends: 0 });

  useEffect(() => {
    trackScreen(adding ? 'add-parcel' : openParcelId ? 'parcel' : tab, mode === 'demo' ? 'demo' : 'account');
  }, [adding, openParcelId, tab, mode]);
  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(() => trackAction('search'), 800);
    return () => clearTimeout(timer);
  }, [query]);

  const friendsClient = useMemo(() => createFriendsClient(mode === 'demo', apiAuth), [mode, apiAuth]);

  // An account's notification preferences are read once per sign-in: a parcel's alerts
  // and the email offer show them without asking again. Settings reads them when it opens.
  useEffect(() => {
    if (mode === 'api' && apiAuth) void loadNotificationPreferences(apiAuth, { once: true }).catch(() => undefined);
  }, [mode, apiAuth]);

  // A share opens the add sheet: filled in with what came, or saying why nothing did.
  useEffect(() => {
    let active = true;
    void readSharedParcel().then((received) => {
      if (active && received) {
        if ('input' in received) trackAction('parcel-share-received');
        setShared(received);
        setAdding(true);
      }
    }).finally(() => clearSharedParcelInput());
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!undoParcel || undoing || undoError) return;
    const timeout = window.setTimeout(() => setUndoParcel(null), 7_000);
    return () => window.clearTimeout(timeout);
  }, [undoParcel, undoing, undoError]);

  useEffect(() => {
    if (!refreshNotice || refreshNotice.working) return;
    const timeout = window.setTimeout(() => setRefreshNotice(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [refreshNotice]);

  // A parcel kept from its link joins the list: say how that ended, once.
  const [keptParcelId, setKeptParcelId] = useState<string | null>(null);
  useEffect(() => onKeepOutcome(({ outcome, packageId, email }) => {
    if (outcome === 'kept' && packageId) setKeptParcelId(packageId);
    // The parcel was in the account already: open it, unless the address already does.
    if (outcome === 'already' && packageId && new URLSearchParams(window.location.search).get('parcel') !== packageId) {
      window.history.pushState(window.history.state, '', `?parcel=${encodeURIComponent(packageId)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    setRefreshNotice({
      mark: outcome === 'kept' || outcome === 'already' ? 'success' : 'pending',
      text: t((email && KEEP_EMAIL_MESSAGES[outcome]) || KEEP_MESSAGES[outcome]),
    });
  }), [t]);
  // The kept parcel's card celebrates once the list has it.
  if (keptParcelId && parcels.some((parcel) => parcel.id === keptParcelId)) {
    setKeptParcelId(null);
    setParcelBurst(keptParcelId);
  }

  useEffect(() => {
    const interval = window.setInterval(() => setViewNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useLayoutEffect(() => {
    const onPopState = () => {
      setDetailOrigin(null);
      const params = new URLSearchParams(window.location.search);
      setOpenParcelId(params.get('parcel'));
      setTab(params.get('view') === 'friends' ? 'friends' : params.get('view') === 'passport' ? 'passport' : 'deliveries');
    };
    onPopState();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function switchTab(next: AppTab) {
    if (next === tab) return;
    scrollPositions.current[tab] = window.scrollY;
    const url = new URL(window.location.href);
    url.searchParams.delete('friend');
    if (next !== 'deliveries') url.searchParams.set('view', next);
    else url.searchParams.delete('view');
    window.history.pushState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    setTab(next);
    requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.current[next], behavior: 'instant' }));
  }

  function openParcelDetail(packageId: string, source?: HTMLElement) {
    setDetailOrigin(captureCardOrigin(source));
    const url = new URL(window.location.href);
    url.searchParams.set('parcel', packageId);
    const currentState = typeof window.history.state === 'object' && window.history.state
      ? window.history.state
      : {};
    window.history.pushState(
      { ...currentState, [DETAIL_HISTORY_KEY]: packageId },
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
    setOpenParcelId(packageId);
  }

  function closeParcelDetail() {
    setDetailOrigin(null);
    if (window.history.state?.[DETAIL_HISTORY_KEY] === openParcelId) {
      setOpenParcelId(null);
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('parcel');
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
    setOpenParcelId(null);
  }

  const openParcel = useMemo(
    () => parcels.find((p) => p.id === openParcelId || p.originalParcelId === openParcelId) ?? null,
    [parcels, openParcelId],
  );

  // An update reload comes back to the same place: the address reopens the tab
  // and parcel, and the saved screen restores both scroll positions before the
  // first paint, without entrance motion.
  const resumed = useRef<ResumedScreen | null | undefined>(undefined);
  const parcelOpen = Boolean(openParcel);
  useLayoutEffect(() => {
    if (loading) return;
    if (resumed.current === undefined) {
      const screen = resumed.current = takeResumedScreen();
      if (screen) {
        const root = document.documentElement;
        root.dataset.resumed = '';
        window.scrollTo({ top: screen.top, behavior: 'instant' });
        window.setTimeout(() => { delete root.dataset.resumed; }, 1_000);
      }
    }
    const screen = resumed.current;
    const detail = parcelOpen && screen?.detailTop ? document.querySelector<HTMLElement>('.detail') : null;
    if (detail && screen) {
      detail.scrollTop = screen.detailTop;
      screen.detailTop = 0;
    }
  }, [loading, parcelOpen]);

  const hasCustomView = query.trim().length > 0
    || statusFilter !== 'all'
    || carrierFilter !== ''
    || sort !== 'priority';
  // A parcel delivered since the list was last shown keeps its place until its card leaves for the past deliveries.
  const delivered = useDeliveredHold(parcels, tab === 'deliveries' && !loading && !openParcelId && !adding && !hasCustomView, deliveriesPage);
  const listed = delivered.arranged;
  const visibleParcels = useMemo(
    () => viewParcels(listed, {
      query,
      status: statusFilter,
      carrier: carrierFilter || undefined,
      sort,
      now: viewNow,
    }),
    [listed, query, statusFilter, carrierFilter, sort, viewNow],
  );
  const availableCarriers = useMemo(
    () => [...new Set(parcels.map((parcel) => parcel.carrier))]
      .sort((first, second) => first.localeCompare(second)),
    [parcels],
  );

  const activeParcels = useMemo(
    () => visibleParcels.filter(isActiveParcel),
    [visibleParcels],
  );
  const nextParcel = useMemo(() => hasCustomView ? null : nextPriorityParcel(listed, viewNow), [listed, viewNow, hasCustomView]);
  const prioritized = useMemo(
    () => prioritizeActiveParcels(activeParcels.filter((parcel) => parcel.id !== nextParcel?.id), viewNow, parcelComparator(sort)),
    [activeParcels, nextParcel, sort, viewNow],
  );
  const deliveredParcels = useMemo(
    () => sortPastParcels(visibleParcels.filter((p) => !p.archivedAt && isDelivered(p.events))),
    [visibleParcels],
  );
  const returnedParcels = useMemo(
    () => sortPastParcels(visibleParcels.filter(
      (parcel) => !parcel.archivedAt && currentStage(parcel.events) === 'returned',
    )),
    [visibleParcels],
  );
  const archivedParcels = useMemo(
    () => sortPastParcels(
      visibleParcels.filter((parcel) => Boolean(parcel.archivedAt)),
    ),
    [visibleParcels],
  );
  const usedCarriers = useMemo(
    () => usedCarrierIds(parcels, (carrier) => carrierInfo(carrier).capabilities.selectable),
    [parcels],
  );
  const devicePostcodes = usePostcodeMemory();
  // The account's own postcodes first, then the ones this device gave without it.
  const givenPostcodes = useMemo(
    () => [
      ...[...parcels]
        .filter((parcel) => parcel.dpdPostcode)
        .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
        .map(({ carrier, dpdPostcode }) => ({ carrier, postcode: dpdPostcode })),
      ...devicePostcodes,
    ],
    [parcels, devicePostcodes],
  );

  // The other cards glide into place when a parcel leaves or returns.
  async function changeList(change: () => Promise<void>) {
    const stopGlide = glideNextListChange(deliveriesPage.current);
    try {
      await change();
    } catch (reason) {
      stopGlide();
      throw reason;
    }
  }

  async function handleArchive(parcel: ParcelWithEvents) {
    await changeList(() => removeParcel(parcel.id));
    if (openParcelId === parcel.id) closeParcelDetail();
    setUndoError(null);
    setUndoing(false);
    setUndoParcel(parcel);
  }

  async function handleDelete(parcel: ParcelWithEvents) {
    await changeList(() => deleteParcel(parcel.id));
    if (openParcelId === parcel.id) closeParcelDetail();
    setUndoParcel((current) => current?.id === parcel.id ? null : current);
    setRefreshNotice({ mark: 'success', text: t('app.deletedToast', {
      name: parcel.label || t('common.parcel'),
    }) });
  }

  function clearView() {
    setQuery('');
    setStatusFilter('all');
    setCarrierFilter('');
    setSort('priority');
  }

  async function handleRestore(parcel: ParcelWithEvents) {
    await changeList(() => restoreParcel(parcel.id));
    setUndoParcel((current) => current?.id === parcel.id ? null : current);
    if (openParcelId === parcel.id) closeParcelDetail();
  }

  async function undoArchive() {
    if (!undoParcel || undoing) return;
    setUndoing(true);
    setUndoError(null);
    try {
      await handleRestore(undoParcel);
    } catch (reason) {
      setUndoError(userErrorMessage(reason, t, 'detail.restoreFailed'));
    } finally {
      setUndoing(false);
    }
  }

  // The pull indicator shows its own result; the button reports through the toast.
  // A failure's reason is in the shared error banner.
  function refreshWithButton() {
    return animateRefresh(async () => {
      setRefreshNotice({ text: t('app.refreshing'), mark: 'pending', working: true });
      const outcome = await refreshOutcome(refresh());
      setRefreshNotice(outcome === 'failed' ? null
        : { text: t(REFRESH_MESSAGES[outcome]), mark: outcome === 'pending' ? 'pending' : 'success' });
    });
  }

  async function resetDemo() {
    await resetDemoData();
    setUndoParcel(null); setUndoError(null); setRefreshNotice(null);
    setParcelBurst(null); setOpenParcelId(null); setDetailOrigin(null);
    setQuery(''); setStatusFilter('all'); setCarrierFilter('');
    setViewNow(Date.now());
  }

  // A card held where it stood is flagged for what its parcel needs now, which may be nothing.
  const noticeFor = (parcel: ParcelWithEvents, reason: ParcelAttention) => {
    const now = listed === parcels ? reason : parcelAttention(parcel, viewNow);
    return now ? t(ATTENTION_LABELS[now]) : undefined;
  };
  const remainingDeliveries = [...prioritized.arrivingToday, ...prioritized.onTheWay];
  const allArrived = !hasCustomView && listed.length > 0
    && listed.every((parcel) => isDelivered(parcel.events));
  const onTheWayCards = remainingDeliveries.length > 0 ? (
    <div className="parcel-grid">
      {remainingDeliveries.map((parcel) => (
        <ParcelCard
          key={parcel.id}
          parcel={delivered.current(parcel)}
          arrived={delivered.arrived(parcel)}
          onOpen={(p, source) => openParcelDetail(p.id, source)}
          onArchive={handleArchive}
        />
      ))}
    </div>
  ) : null;
  const nextCard = nextParcel && <div className="delivery-next"><ParcelCard key={nextParcel.id} parcel={delivered.current(nextParcel)} arrived={delivered.arrived(nextParcel)} variant="hero" onOpen={(parcel, source) => openParcelDetail(parcel.id, source)} onArchive={handleArchive} /></div>;

  // The landing opens at its top: the links to it stand at the foot of the list and of Settings.
  const openLanding = onOpenLanding && (() => {
    onOpenLanding();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });

  return (
    <div className={`app${tab === 'deliveries' ? ' app--deliveries' : ''}`} onClickCapture={focusClickedButton}>
      <a className="skip-link" href="#main-content">{t('web.skipContent')}</a>
      <header className="app__header">
        <div className="app__masthead">
          <span className="app__brand"><PeekMark size={30} /><PeekLockup /></span>
          <h1 className="app__title">{t(tab === 'deliveries' ? 'native.deliveries' : tab === 'passport' ? 'passport.title' : 'friends.title')}</h1>
          <div className="app__actions">
            <button type="button" className="app__add-button" aria-label={t('app.addParcelAria')} onClick={() => setAdding(true)}><Icon name="plus" /><span>{t('app.addParcel')}</span></button>
            <AccountMenu email={accountEmail} onExport={onExportAccount} onDelete={onDeleteAccount} onSignOut={onSignOut} onExitDemo={onExitDemo} onResetDemo={mode === 'demo' ? resetDemo : undefined} onOpenLanding={openLanding} apiAuth={apiAuth} />
          </div>
          <AppNavigation selected={tab} onSelect={switchTab} />
        </div>
      </header>
      {mode === 'demo' && <div className="demo-banner"><span>{t('app.demo')}</span>{onExitDemo && <button type="button" onClick={onExitDemo}>{t('native.exitDemo')}<Icon name="close" /></button>}</div>}
      <main className="app__content" id="main-content">
        {error && (
          <div className="error-banner" role="alert">
            <strong>
              {authenticationRequired ? t('app.signInNeeded') : t('app.trackingBreak')}
            </strong>
            {!authenticationRequired && <span>{userErrorMessage(new Error(error), t, 'app.loadFailed')}</span>}
            {usingCachedData && <span>{t('app.cachedData')}</span>}
            {authenticationRequired && (
              // Reloading clears the expired client session before authentication restarts.
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a className="error-banner__action" href="/">
                {t('app.signInAgain')}
              </a>
            )}
            {!authenticationRequired && (
              <button
                className="error-banner__action"
                type="button"
                onClick={() => void retryLoad()}
              >
                {t('app.tryAgain')}
              </button>
            )}
          </div>
        )}

        <PullToRefresh hidden={tab !== 'deliveries'} enabled={!loading && !refreshing && !refreshAnimating && !adding && !openParcelId} onRefresh={() => refreshOutcome(refresh())}>
        <div ref={deliveriesPage} className="deliveries-page">
        <div className="delivery-active" role={activeParcels.length ? 'region' : undefined} aria-labelledby={activeParcels.length ? 'active-parcels-title' : undefined}>
        <div className="delivery-overview">
          {activeParcels.length > 0 && <div className="parcel-section__heading"><h2 id="active-parcels-title">{t('app.onTheWaySection')}</h2><span>{activeParcels.length}</span></div>}
          <div className="delivery-overview__actions">
            {!loading && parcels.length > 0 && <button
              ref={searchToggle}
              type="button"
              className="icon-button delivery-search"
              aria-label={viewControlsOpen ? t('view.hideControls') : t('view.showControls')}
              title={viewControlsOpen ? t('view.hideControls') : t('view.showControls')}
              aria-expanded={viewControlsOpen}
              aria-controls={PARCEL_VIEW_CONTROLS_ID}
              aria-describedby={hasCustomView ? 'parcel-view-active' : undefined}
              onClick={() => { if (viewControlsOpen) closeViewControls(); else { trackAction('filters-open'); setViewControlsOpen(true); } }}
            >
              <Icon name="search" />
              {hasCustomView && <><i className="delivery-search__dot" aria-hidden="true" /><span className="sr-only" id="parcel-view-active">{t('view.customized')}</span></>}
            </button>}
            <button type="button" className="icon-button delivery-refresh" aria-label={refreshing ? t('app.refreshing') : t('app.refresh')} aria-busy={refreshing || refreshAnimating} disabled={refreshing || refreshAnimating} data-refreshing={refreshAnimating || undefined} onClick={() => void refreshWithButton()}><span ref={refreshIcon} className="refresh-glyph"><Icon name="refresh" /></span></button>
          </div>
        </div>
        {!loading && parcels.length > 0 && viewControlsOpen && (
          <div ref={searchShell} className="parcel-view-shell" onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            closeViewControls();
            searchToggle.current?.focus({ preventScroll: true });
          }}>
            <ParcelViewControls
              id={PARCEL_VIEW_CONTROLS_ID}
              query={query}
              status={statusFilter}
              carrier={carrierFilter}
              sort={sort}
              carriers={availableCarriers}
              count={visibleParcels.length}
              advancedOpen={advancedFiltersOpen}
              hasCustomView={hasCustomView}
              onQueryChange={setQuery}
              onStatusChange={(value) => { setStatusFilter(value); trackAction('filter-status'); }}
              onCarrierChange={(value) => { setCarrierFilter(value); trackAction('filter-carrier'); }}
              onSortChange={(value) => { setSort(value); trackAction('sort-change'); }}
              onToggleAdvanced={() => setAdvancedFiltersOpen((open) => !open)}
              onClearAll={clearView}
            />
          </div>
        )}
        {loading && (
          <div className="parcel-grid" aria-label={t('app.loadingParcels')}>
            <div className="parcel-card parcel-card--skeleton" />
            <div className="parcel-card parcel-card--skeleton" />
          </div>
        )}

        {!loading && !error && parcels.length === 0 && (
          <div className="empty-state">
            <ParcelIllustration className="empty-state__parcel" />
            <p className="empty-state__eyebrow">{t('app.emptyEyebrow')}</p>
            <h2>{t('app.emptyTitle')}</h2>
            <p>{t('app.emptyDescription')}</p>
            <button className="button button--primary" type="button" onClick={() => setAdding(true)}><Icon name="plus" />{t('app.addParcel')}</button>
          </div>
        )}

        {!loading && parcels.length > 0 && visibleParcels.length === 0 && (
          <div className="empty-state empty-state--filtered">
            <p className="empty-state__eyebrow">{t('view.search')}</p>
            <h2>{t('view.noResultsTitle')}</h2>
            <p>{t('view.noResultsDescription')}</p>
            <button
              type="button"
              className="button button--secondary"
              onClick={clearView}
            >
              {t('view.clear')}
            </button>
          </div>
        )}

        {!loading && nextCard}
        {!loading && prioritized.attention.length > 0 && (
          <section className="delivery-attention" aria-labelledby="attention-parcels-title">
            <h2 id="attention-parcels-title" className="sr-only">{t('app.needsAttention')}</h2>
            <div className="parcel-grid">
              {prioritized.attention.map(({ parcel, reason }) => (
                <ParcelCard key={parcel.id} parcel={delivered.current(parcel)} arrived={delivered.arrived(parcel)}
                  notice={noticeFor(delivered.current(parcel), reason)}
                  onOpen={(p, source) => openParcelDetail(p.id, source)} onArchive={handleArchive} />
              ))}
            </div>
          </section>
        )}
        {!loading && onTheWayCards}
        {!loading && !error && allArrived && (
          <div className="delivery-arrived">
            <Icon name="check" />
            <h2>{t('app.allArrived')}</h2>
            <p>{t('app.allArrivedDescription')}</p>
            <button type="button" className="button button--primary" onClick={() => setAdding(true)}>{t('app.trackAnother')}</button>
          </div>
        )}
        </div>
        <div className="parcel-sections">
        {!loading && deliveredParcels.length > 0 && (
          <section
            className="parcel-section parcel-section--past"
            aria-labelledby="past-parcels-title"
          >
            <div className="parcel-section__heading">
              <h2 id="past-parcels-title">{t('app.pastDeliveries')}</h2>
              <span>{deliveredParcels.length}</span>
            </div>
            <div className="parcel-grid">
              {deliveredParcels.map((parcel) => (
                <ParcelCard
                  key={parcel.id}
                  parcel={parcel}
                  onOpen={(p, source) => openParcelDetail(p.id, source)}
                  onArchive={handleArchive}
                />
              ))}
            </div>
          </section>
        )}

        {!loading && returnedParcels.length > 0 && (
          <section
            className="parcel-section parcel-section--past"
            aria-labelledby="returned-parcels-title"
          >
            <div className="parcel-section__heading">
              <h2 id="returned-parcels-title">{t('app.returned')}</h2>
              <span>{returnedParcels.length}</span>
            </div>
            <div className="parcel-grid">
              {returnedParcels.map((parcel) => (
                <ParcelCard
                  key={parcel.id}
                  parcel={parcel}
                  onOpen={(p, source) => openParcelDetail(p.id, source)}
                  onArchive={handleArchive}
                />
              ))}
            </div>
          </section>
        )}

        {!loading && archivedParcels.length > 0 && (
          <section
            className="parcel-section archived-section"
            aria-labelledby="archived-parcels-title"
          >
            <details onToggle={(event) => { if (event.currentTarget.open) trackAction('archive-open'); }}>
              <summary>
                <Icon name="archive" /><span id="archived-parcels-title">{t('app.archived')}</span>
                <span className="archived-section__count">{archivedParcels.length}</span>
                <Icon name="chevron" className="archived-section__chevron" />
              </summary>
              <div className="parcel-grid">
                {archivedParcels.map((parcel) => (
                  <ParcelCard
                    key={parcel.id}
                    parcel={parcel}
                    onOpen={(p, source) => openParcelDetail(p.id, source)}
                  />
                ))}
              </div>
            </details>
          </section>
        )}
        </div>
        </div>
        {/* The foot ends the deliveries and moves with them when they are pulled. */}
        {openLanding && <AppFoot onOpenLanding={openLanding} />}
        </PullToRefresh>
        {tab === 'passport' && <Passport parcels={parcels} loading={loading} />}
        {tab === 'friends' && <Friends key={apiAuth?.userId ?? 'demo'} client={friendsClient} parcels={parcels} demo={mode === 'demo'} onExitDemo={onExitDemo} />}
      </main>

      {adding && (
        <AddParcelSheet
          apiAuth={apiAuth}
          onAdd={addParcel}
          onClose={() => {
            setAdding(false);
            setShared(null);
          }}
          onAdded={(id) => {
            if (!visibleParcels.some((parcel) => parcel.id === id)) clearView();
            setViewControlsOpen(false);
            switchTab('deliveries');
            setParcelBurst(id);
          }}
          onOpenParcel={(parcelId) => openParcelDetail(parcelId)}
          postcodes={givenPostcodes}
          usedCarriers={usedCarriers}
          initialLabel={shared && 'input' in shared ? shared.input.label : undefined}
          initialTrackingInput={shared && 'input' in shared ? shared.input.trackingInput : undefined}
          shareError={shared && 'failure' in shared ? t(SHARE_FAILURE_MESSAGES[shared.failure]) : undefined}
        />
      )}

      {mode === 'api' && apiAuth && (
        <NotificationPrompt
          key={apiAuth.userId}
          apiAuth={apiAuth}
          eligible={tab === 'deliveries' && parcels.length > 0 && !loading && !error
            && !authenticationRequired && !adding && !openParcelId && !parcelBurst
            && !undoParcel && !refreshNotice}
        />
      )}

      {parcelBurst && <ParcelAddedBurst key={parcelBurst} parcelId={parcelBurst} onFinished={finishParcelBurst} />}

      {openParcel && (
        <ParcelDetail
          key={openParcel.id}
          onExitDemo={onExitDemo}
          parcel={openParcel}
          openingOrigin={detailOrigin}
          onBack={closeParcelDetail}
          onRename={(p, label) => renameParcel(p.id, label)}
          onChangeCarrier={(p, input) => changeParcelCarrier(p.id, input)}
          usedCarriers={usedCarriers}
          apiAuth={apiAuth}
          accountEmail={mode === 'api' ? accountEmail : undefined}
          onSetNotificationsMuted={(p, muted) =>
            setParcelNotificationsMuted(p.id, muted)}
          onSetEmailMuted={mode === 'api' ? (p, muted) => setParcelEmailMuted(p.id, muted) : undefined}
          onRefresh={(p) => refreshParcel(p.id)}
          onRestore={(p) => handleRestore(p)}
          onArchive={(p) => handleArchive(p)}
          onDelete={(p) => handleDelete(p)}
        />
      )}

      {undoParcel && (
        <div className="undo-toast" role="status">
          <ToastMark kind="archive" />
          <span className="undo-toast__message">
            <span>{t('app.archivedToast', { name: undoParcel.label || t('common.parcel') })}</span>
            {undoError && <small role="alert">{undoError}</small>}
          </span>
          <button type="button" disabled={undoing} onClick={() => void undoArchive()}>
            {undoing ? t('common.restoring') : undoError ? t('common.retry') : t('app.undo')}
          </button>
        </div>
      )}

      {refreshNotice && !undoParcel && (
        <div className="action-toast" role="status">
          <ToastMark kind={refreshNotice.mark} />
          <span>{refreshNotice.text}</span>
        </div>
      )}
    </div>
  );
}
