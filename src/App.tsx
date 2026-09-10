import './components/Deliveries.css';
import { trackAction, trackScreen } from './lib/analytics';
import { focusClickedButton } from './lib/modal';
import { userErrorMessage } from './lib/userMessages';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AddParcelSheet } from './components/AddParcelSheet';
import { ParcelAddedBurst } from './components/ParcelAddedBurst';
import { AccountMenu } from './components/AccountMenu';
import { NotificationPrompt } from './components/NotificationPrompt';
import { AppNavigation, type AppTab } from './components/AppNavigation';
import { ParcelCard } from './components/ParcelCard';
import { ParcelDetail } from './components/ParcelDetail';
import { Passport } from './components/Passport';
import { Friends } from './components/Friends';
import { createFriendsClient } from './lib/friends';
import { captureCardOrigin, type CardOrigin } from './lib/cardTransition';
import { Icon, ParcelIllustration } from './components/Icon';
import { ParcelViewControls } from './components/ParcelViewControls';
import {
  type MessageKey,
  useI18n,
} from './i18n';
import type { ApiAuth } from './lib/apiClient';
import {
  isActiveParcel,
  nextPriorityParcel,
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
  readSharedParcelInput,
  type SharedParcelInput,
} from './lib/shareTarget';
import { currentStage, isDelivered } from './lib/stages';
import { useParcels } from './store/ParcelsContext';
import type { CarrierId, ParcelWithEvents } from './types';

const DETAIL_HISTORY_KEY = 'parcelPostDetail';
const PARCEL_VIEW_CONTROLS_ID = 'parcel-view-controls';

function ToastMark({ kind }: { kind: 'archive' | 'success' }) {
  return (
    <span className={`toast-mark toast-mark--${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        {kind === 'success' ? (
          <path d="m7.5 12.5 3 3 6-7" />
        ) : (
          <>
            <path d="M5 8h14v11H5z" />
            <path d="M4 5h16v3H4zM9 12h6" />
          </>
        )}
      </svg>
    </span>
  );
}

const ATTENTION_LABELS: Record<ParcelAttention, MessageKey> = {
  sync_error: 'attention.sync_error',
  failed_attempt: 'attention.failed_attempt',
  ready_for_pickup: 'attention.ready_for_pickup',
  customs: 'attention.customs',
  stalled: 'attention.stalled',
  not_announced: 'attention.not_announced',
};

export default function App({
  accountEmail,
  onSignOut,
  onExportAccount,
  onDeleteAccount,
  apiAuth,
  onExitDemo,
}: {
  accountEmail?: string;
  onSignOut?: () => Promise<void>;
  onExportAccount?: () => Promise<void>;
  onDeleteAccount?: (confirmation: string) => Promise<void>;
  apiAuth?: ApiAuth;
  onExitDemo?: () => void;
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
    removeParcel,
    restoreParcel,
    deleteParcel,
    refresh,
    refreshParcel,
    retryLoad,
    resetDemoData,
  } = useParcels();
  const [sharedParcelInput, setSharedParcelInput] = useState<SharedParcelInput | null>(null);
  const [adding, setAdding] = useState(false);
  const [parcelBurst, setParcelBurst] = useState<string | null>(null);
  const finishParcelBurst = useCallback(() => setParcelBurst(null), []);
  const [undoParcel, setUndoParcel] = useState<ParcelWithEvents | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ParcelStatusFilter>('all');
  const [carrierFilter, setCarrierFilter] = useState<CarrierId | ''>('');
  const [sort, setSort] = useState<ParcelSort>('priority');
  const [viewControlsOpen, setViewControlsOpen] = useState(false);
  const searchToggle = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    let active = true;
    if (new URLSearchParams(window.location.search).get('share-target') !== '1') return;
    void readSharedParcelInput().then((input) => {
      if (active && input) {
        trackAction('parcel-share-received');
        setSharedParcelInput(input);
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
    if (!refreshNotice || refreshing) return;
    const timeout = window.setTimeout(() => setRefreshNotice(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [refreshNotice, refreshing]);

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

  const visibleParcels = useMemo(
    () => viewParcels(parcels, {
      query,
      status: statusFilter,
      carrier: carrierFilter || undefined,
      sort,
      now: viewNow,
    }),
    [parcels, query, statusFilter, carrierFilter, sort, viewNow],
  );
  const availableCarriers = useMemo(
    () => [...new Set(parcels.map((parcel) => parcel.carrier))]
      .sort((first, second) => first.localeCompare(second)),
    [parcels],
  );
  const hasCustomView = query.trim().length > 0
    || statusFilter !== 'all'
    || carrierFilter !== ''
    || sort !== 'priority';

  const activeParcels = useMemo(
    () => visibleParcels.filter(isActiveParcel),
    [visibleParcels],
  );
  const nextParcel = useMemo(() => hasCustomView ? null : nextPriorityParcel(parcels, viewNow), [parcels, viewNow, hasCustomView]);
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
  const lastDpdPostcode = useMemo(
    () => [...parcels]
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
      .find((parcel) => parcel.carrier === 'dpd' && parcel.dpdPostcode)
      ?.dpdPostcode,
    [parcels],
  );

  async function handleArchive(parcel: ParcelWithEvents) {
    await removeParcel(parcel.id);
    if (openParcelId === parcel.id) closeParcelDetail();
    setUndoError(null);
    setUndoing(false);
    setUndoParcel(parcel);
  }

  async function handleDelete(parcel: ParcelWithEvents) {
    await deleteParcel(parcel.id);
    if (openParcelId === parcel.id) closeParcelDetail();
    setUndoParcel((current) => current?.id === parcel.id ? null : current);
    setRefreshNotice(t('app.deletedToast', {
      name: parcel.label || t('common.parcel'),
    }));
  }

  function clearView() {
    setQuery('');
    setStatusFilter('all');
    setCarrierFilter('');
    setSort('priority');
  }

  async function handleRestore(parcel: ParcelWithEvents) {
    await restoreParcel(parcel.id);
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

  async function refreshAll() {
    setRefreshNotice(null);
    try {
      await refresh((progress) => setRefreshNotice(t(`sync.${progress}`)));
      setRefreshNotice(t('sync.completed'));
    } catch {
      setRefreshNotice(null);
      // The shared error banner contains the actionable failure message.
    }
  }

  async function resetDemo() {
    await resetDemoData();
    setUndoParcel(null); setUndoError(null); setRefreshNotice(null);
    setParcelBurst(null); setOpenParcelId(null); setDetailOrigin(null);
    setQuery(''); setStatusFilter('all'); setCarrierFilter('');
    setViewNow(Date.now());
  }

  const remainingDeliveries = [...prioritized.arrivingToday, ...prioritized.onTheWay];
  const allArrived = !hasCustomView && parcels.length > 0
    && parcels.every((parcel) => isDelivered(parcel.events));
  const onTheWayCards = remainingDeliveries.length > 0 ? (
    <div className="parcel-grid">
      {remainingDeliveries.map((parcel) => (
        <ParcelCard
          key={parcel.id}
          parcel={parcel}
          onOpen={(p, source) => openParcelDetail(p.id, source)}
          onArchive={handleArchive}
        />
      ))}
    </div>
  ) : null;
  const nextCard = nextParcel && <div className="delivery-next"><ParcelCard parcel={nextParcel} variant="hero" onOpen={(parcel, source) => openParcelDetail(parcel.id, source)} onArchive={handleArchive} /></div>;

  return (
    <div className={`app${tab === 'deliveries' ? ' app--deliveries' : ''}`} onClickCapture={focusClickedButton}>
      <a className="skip-link" href="#main-content">{t('web.skipContent')}</a>
      <header className="app__header">
        <div className="app__masthead">
          <button type="button" className="app__add-button" aria-label={t('app.addParcelAria')} onClick={() => setAdding(true)}><Icon name="plus" /><span>{t('app.addParcel')}</span></button>
          <h1 className="app__title">{t(tab === 'deliveries' ? 'native.deliveries' : tab === 'passport' ? 'passport.title' : 'friends.title')}</h1>
          <AppNavigation selected={tab} onSelect={switchTab} />
          <AccountMenu email={accountEmail} onExport={onExportAccount} onDelete={onDeleteAccount} onSignOut={onSignOut} onExitDemo={onExitDemo} onResetDemo={mode === 'demo' ? resetDemo : undefined} apiAuth={apiAuth} />
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

        <div className="deliveries-page" hidden={tab !== 'deliveries'}>
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
              onClick={() => { if (!viewControlsOpen) trackAction('filters-open'); setViewControlsOpen((open) => !open); }}
            >
              <Icon name="search" />
              {hasCustomView && <><i className="delivery-search__dot" aria-hidden="true" /><span className="sr-only" id="parcel-view-active">{t('view.customized')}</span></>}
            </button>}
            <button type="button" className="icon-button" aria-label={refreshing ? t('app.refreshing') : t('app.refresh')} aria-busy={refreshing} disabled={refreshing} onClick={() => void refreshAll()}><Icon name="refresh" className={refreshing ? 'spin' : undefined} /></button>
          </div>
        </div>
        {!loading && parcels.length > 0 && viewControlsOpen && (
          <div className="parcel-view-shell" onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            setViewControlsOpen(false);
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

        {!loading && prioritized.attention.length > 0 && (
          <section className="delivery-notices" aria-labelledby="attention-parcels-title">
            <h2 id="attention-parcels-title" className="sr-only">{t('app.needsAttention')}</h2>
            <div className="parcel-grid">
              {prioritized.attention.map(({ parcel, reason }) => (
                <ParcelCard key={parcel.id} parcel={parcel} variant="notice"
                  notice={t(ATTENTION_LABELS[reason])}
                  onOpen={(p, source) => openParcelDetail(p.id, source)} onArchive={handleArchive} />
              ))}
            </div>
          </section>
        )}
        {!loading && nextCard}
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
        {tab === 'passport' && <Passport parcels={parcels} loading={loading} />}
        {tab === 'friends' && <Friends key={apiAuth?.userId ?? 'demo'} client={friendsClient} parcels={parcels} demo={mode === 'demo'} onExitDemo={onExitDemo} />}
      </main>

      {adding && (
        <AddParcelSheet
          apiAuth={apiAuth}
          onAdd={addParcel}
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            if (!visibleParcels.some((parcel) => parcel.id === id)) clearView();
            setViewControlsOpen(false);
            switchTab('deliveries');
            setParcelBurst(id);
          }}
          onOpenParcel={(parcelId) => openParcelDetail(parcelId)}
          lastDpdPostcode={lastDpdPostcode}
          initialLabel={sharedParcelInput?.label}
          initialTrackingInput={sharedParcelInput?.trackingInput}
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
          onSetNotificationsMuted={(p, muted) =>
            setParcelNotificationsMuted(p.id, muted)}
          onRefresh={(p, onProgress) => refreshParcel(p.id, onProgress)}
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
          <ToastMark kind="success" />
          <span>{refreshNotice}</span>
        </div>
      )}
    </div>
  );
}
