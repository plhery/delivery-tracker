import { trackAction } from '../lib/analytics';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ApiFriendCard, ApiFriendProfile, ApiFriendsActionRequest, ApiFriendsActionResponse, ApiFriendsSnapshot } from '../generated/apiContract';
import { useI18n, type MessageKey } from '../i18n';
import { FriendsError, friendTone, ownFriendCard, type FriendsClient } from '../lib/friends';
import { invitationURL } from '../lib/friendInvites';
import { useSheetDialog } from '../lib/modal';
import type { ParcelWithEvents } from '../types';
import { Icon } from './Icon';
import { InvitationParcel } from './InvitationParcel';
import { FriendStampCollection } from './FriendStampCollection';
import './Friends.css';
import { useFriendsActivity } from './FriendsActivity';

type Panel = 'settings' | 'create' | 'invite' | ApiFriendCard | null;
export function Friends({ client, parcels, demo, onExitDemo }: { client: FriendsClient; parcels: ParcelWithEvents[]; demo: boolean; onExitDemo?: () => void }) {
  const { t } = useI18n();
  const activity = useFriendsActivity();
  const [data, setData] = useState<ApiFriendsSnapshot | null>(() => activity?.arrival?.snapshot ?? null);
  const [featuredId, setFeaturedId] = useState<string | null>(() => activity?.arrival?.friendId ?? new URLSearchParams(window.location.search).get('friend'));
  const [landed, setLanded] = useState(false);
  const [checkedFocusId, setCheckedFocusId] = useState<string | null>(null);
  const arrivalCard = useRef<HTMLButtonElement>(null);
  const presented = useRef<number | string | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [invite, setInvite] = useState<{ code: string; previewId?: string; previousInviteCount?: number } | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const generation = useRef(0);
  const working = useRef(false);
  const focusId = activity?.arrival?.friendId ?? featuredId;
  const focusReady = data?.friends.some((friend) => friend.id === focusId);
  const arrivalKey = activity?.arrival?.key ?? featuredId;
  useEffect(() => {
    if (!focusReady || !focusId || presented.current === arrivalKey || (!activity?.arrival && presented.current != null)) return;
    setFeaturedId(focusId); setLanded(false);
    let reveal = 0;
    let settled: ReturnType<typeof setTimeout>;
    const position = requestAnimationFrame(() => {
      arrivalCard.current?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
      reveal = requestAnimationFrame(() => {
        presented.current = arrivalKey; setLanded(true);
        settled = setTimeout(() => {
          if (typeof arrivalKey === 'number') activity?.consumeArrival(arrivalKey);
          const url = new URL(window.location.href);
          if (url.searchParams.get('friend') === focusId) { url.searchParams.delete('friend'); window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash); }
        }, 650);
      });
    });
    void activity?.acknowledge(focusId);
    return () => { cancelAnimationFrame(position); cancelAnimationFrame(reveal); clearTimeout(settled); };
  }, [focusReady, focusId, arrivalKey, activity]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await client.load(parcels);
      if (current === generation.current) {
        setData(next); setError(null); setCheckedFocusId(focusId);
        setPanel((open) => typeof open === 'object' && open && !next.friends.some((friend) => friend.id === open.id) ? null : open);
      }
    } catch { if (current === generation.current) { setData(null); setPanel(null); setError('friends.unavailable'); } }
  }, [client, parcels, focusId]);
  useEffect(() => {
    const current = generation.current;
    void Promise.resolve().then(() => { if (current === generation.current) void load(); });
    const visibility = () => {
      if (document.hidden) { generation.current++; setData(null); setPanel(null); }
      else void load();
    };
    document.addEventListener('visibilitychange', visibility);
    const timer = window.setInterval(() => { if (!document.hidden && !working.current) void load(); }, 60_000);
    return () => { invalidate(); clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [load, invalidate, activity?.arrival?.key]);
  async function act(action: ApiFriendsActionRequest): Promise<ApiFriendsActionResponse | null> {
    if (working.current) return null;
    working.current = true; setBusy(true); setError(null); setNotice(null);
    const current = ++generation.current;
    try {
      const result = await client.action(action, parcels);
      if (generation.current !== current) return null;
      if (result.snapshot) setData(result.snapshot);
      return result;
    } catch (reason) {
      if (generation.current === current) setError(reason instanceof FriendsError ? reason.key : 'friends.actionFailed');
      return null;
    } finally { working.current = false; setBusy(false); }
  }
  async function inviteFriend() {
    if (working.current) return;
    setInvite(null); setPanel('invite');
    if (demo) return;
    const result = await act({ action: 'create_invite' });
    if (result?.inviteCode) setInvite({ code: result.inviteCode, previewId: result.previewId, previousInviteCount: result.previousInviteCount });
  }
  const close = () => { if (!busy) { setPanel(null); setError(null); } };
  const errorView = error && <p className="friends-error" role="alert">{t(error)}</p>;
  const selected = typeof panel === 'object' && panel ? data?.friends.find((friend) => friend.id === panel.id) : null;
  const featured = data?.friends.find((friend) => friend.id === focusId);
  const remainingFriends = data?.friends.filter((friend) => friend.id !== featured?.id) ?? [];
  const friendButton = (friend: ApiFriendCard) => <button key={friend.id} ref={friend.id === focusId ? arrivalCard : undefined} data-arriving={friend.id === focusId ? (landed ? 'landed' : 'waiting') : undefined} className={`friend-card tone-${friendTone(friend.id)}`} onClick={() => { setPanel(friend); trackAction('friend-open'); }}><FriendCardBody friend={friend} /></button>;
  return <div className="friends-page" data-empty={!!data?.profile && !data.friends.length}>
    {data && focusId && checkedFocusId === focusId && !focusReady && <p className="friends-notice" role="status">{t('friends.friendUnavailable')}</p>}
    {notice && <p role="status" className="friends-notice"><Icon name="check" />{t(notice)}</p>}
    {!panel && errorView}
    {!data ? <div className="friends-loading" role="status">{error ? <button className="button button--secondary" onClick={() => void load()}>{t('common.retry')}</button> : <div className="skeleton" aria-label={t('friends.title')} />}</div> : !data.profile ? <div className="friends-start">
      <FriendsPostagePair /><h2>{t('friends.title')}</h2><p>{t('friends.introSummary')}</p>
      <button className="button button--primary" onClick={() => setPanel('create')}>{t('friends.join')}</button>
    </div> : <>
      <button className="friends-own-row tone-blue" aria-label={t('friends.settings')} onClick={() => setPanel('settings')}>
        <FriendAvatar name={data.profile.nickname} /><span><strong>{t('friends.yourSharing')}</strong><small>{t(data.profile.shareStats ? 'friends.shareStats' : 'friends.privateStats')}{data.profile.shareArrival && <> · {t('friends.shareArrival')}</>}</small></span><Icon name="settings" />
      </button>
      {data.friends.length ? <section><div className="section-heading friends-circle-heading"><h2>{t('friends.circle')} <span>{data.friends.length}</span></h2><button className="friends-invite-trigger" disabled={busy} onClick={() => void inviteFriend()}><Icon name="plus" />{t('friends.invite')}</button></div>
        <div className="friends-grid">{featured && friendButton(featured)}{remainingFriends.map(friendButton)}</div>
      </section> : <div className="friends-empty"><FriendsPostagePair /><h2>{t('friends.emptyTitle')}</h2><button className="button button--primary" disabled={busy} onClick={() => void inviteFriend()}><Icon name="plus" />{t('friends.invite')}</button></div>}
    </>}
    {panel && <FriendsSheet kind={panel === 'invite' ? 'invite' : 'page'} title={typeof panel === 'object' ? t('passport.title') : t(panel === 'settings' ? 'friends.settings' : panel === 'create' ? 'friends.join' : 'friends.inviteTitle')} onClose={close} busy={busy}>
      {errorView}
      {(panel === 'settings' || panel === 'create') && <FriendProfileForm profile={data?.profile ?? null} parcels={parcels} busy={busy} onSave={async (profile) => { if (await act({ action: 'save_profile', ...profile })) close(); }} />}
      {panel === 'invite' && (demo ? <><InvitationParcel nickname={data?.profile?.nickname ?? t('friends.you')} /><p>{t('friends.demoInvites')}</p>{onExitDemo && <button className="button button--primary" onClick={() => { close(); onExitDemo(); }}>{t('welcome.signInInstead')}</button>}</> : <FriendsInvite nickname={data?.profile?.nickname ?? t('friends.you')} code={invite?.code ?? null} previewId={invite?.previewId} previousInviteCount={invite?.previousInviteCount ?? 0} busy={busy} act={act} onRetry={inviteFriend} onClose={close} />)}
      {selected && <FriendDetails friend={selected} busy={busy} onRemove={async () => { if (await act({ action: 'remove_friend', friendId: selected.id })) close(); }} />}
    </FriendsSheet>}
  </div>;
}
export function FriendAvatar({ name }: { name: string }) { return <span className="friend-avatar" aria-hidden="true"><span className="postage-stamp"><span className="postage-stamp__print">{Array.from(name)[0]}</span></span></span>; }
function FriendsPostagePair() { return <div className="friends-postage-pair" aria-hidden="true"><span className="tone-blue"><FriendAvatar name="A" /></span><span className="tone-lilac"><FriendAvatar name="M" /></span></div>; }
function FriendCardBody({ friend }: { friend: ApiFriendCard }) {
  const { t } = useI18n();
  return <><FriendAvatar name={friend.nickname} /><span className="friend-card__copy"><strong>{friend.nickname}</strong><span className="friend-card__summary">{friend.stats ? t('friends.stampCount', { count: friend.stats.stamps.length }) : t('friends.privateStats')}</span>{friend.arrivedThisWeek && <span className="friend-card__arrival">{t('friends.arrived')}</span>}</span></>;
}
export function FriendSharingPreview({ friend }: { friend: ApiFriendCard }) {
  const { t } = useI18n();
  return <div className="friend-sharing-preview tone-blue"><div><strong>{friend.nickname}</strong><FriendAvatar name={friend.nickname} /></div><p className="friend-sharing-preview__stats">{friend.stats ? <>{friend.stats.deliveredCount} {t('passport.delivered', { count: friend.stats.deliveredCount }).toLocaleLowerCase()} · {friend.stats.averageDays == null ? '—' : t(friend.stats.averageDays === 1 ? 'friends.day' : 'friends.days', { count: friend.stats.averageDays })} · {t('friends.stampCount', { count: friend.stats.stamps.length })}</> : t('friends.privateStats')}</p><p className="friend-sharing-preview__arrival" data-shared={friend.arrivedThisWeek !== null} aria-hidden={friend.arrivedThisWeek === null}>{t(friend.arrivedThisWeek ? 'friends.arrived' : 'friends.noArrival')}</p></div>;
}
export function FriendPostcard({ nickname, arrivedThisWeek }: { nickname: string; arrivedThisWeek?: boolean | null }) {
  const { t } = useI18n();return <div className="friend-postcard tone-lilac"><div><h2>{nickname}</h2>{arrivedThisWeek && <span className="friend-card__arrival">{t('friends.arrived')}</span>}</div><FriendAvatar name={nickname} /></div>;
}
export function FriendProfileForm({ profile, parcels, busy, onSave, submitKey }: { profile: ApiFriendProfile | null; parcels: ParcelWithEvents[]; busy: boolean; onSave: (value: ApiFriendProfile) => Promise<void>; submitKey?: MessageKey }) {
  const { t } = useI18n();
  const [name, setName] = useState(profile?.nickname ?? '');
  const [stats, setStats] = useState(profile?.shareStats ?? true);
  const [arrival, setArrival] = useState(profile?.shareArrival ?? true);
  const previewId = useId();
  const value = { nickname: name.trim(), shareStats: stats, shareArrival: arrival };
  return <form className="friends-profile" onSubmit={(event) => { event.preventDefault(); if (value.nickname) void onSave(value); }}>
    <label className="friends-name">{t('friends.nickname')}<span className="friends-name__field"><input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} placeholder={t('friends.nicknamePlaceholder')} autoComplete="off" required disabled={busy} /></span></label>
    <section className="friends-preview" aria-labelledby={previewId}><p id={previewId}>{t('friends.preview')}</p><FriendSharingPreview friend={ownFriendCard(parcels, { ...value, nickname: value.nickname || t('friends.you') })} /></section>
    <div className="friends-sharing">
      <label className="friends-toggle"><input type="checkbox" role="switch" aria-label={t('friends.shareStats')} checked={stats} onChange={(event) => { setStats(event.target.checked); }} disabled={busy} /><span>{t('friends.shareStats')}<small>{t('friends.sharedStatsSummary')}</small></span></label>
      <label className="friends-toggle"><input type="checkbox" role="switch" aria-label={t('friends.shareArrival')} checked={arrival} onChange={(event) => { setArrival(event.target.checked); }} disabled={busy} /><span>{t('friends.shareArrival')}</span></label>
    </div>
    <p className="friends-privacy"><Icon name="lock" />{t('friends.privacy')}</p><button className="button button--primary friends-join" disabled={busy || !value.nickname}>{t(submitKey ?? (profile ? 'friends.save' : 'friends.join'))}</button>
  </form>;
}
export function FriendsSheet({ title, children, onClose, busy = false, kind = 'page' }: { kind?: 'page' | 'invite'; title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const { t } = useI18n();
  const [dialog, close] = useSheetDialog<HTMLDivElement>(true, onClose, undefined, undefined, busy);
  return createPortal(<div className={`sheet-backdrop friends-backdrop friends-backdrop--${kind}`} onClick={close}><div ref={dialog} className={`sheet friends-sheet friends-sheet--${kind}`} role="dialog" aria-modal="true" aria-labelledby="friends-sheet-title" aria-busy={busy} tabIndex={-1} onClick={(event) => event.stopPropagation()}><div className="sheet__grabber" aria-hidden="true" /><div className="sheet__heading"><h2 id="friends-sheet-title" className="sheet__title">{title}</h2><button className="sheet__close" aria-label={t('common.close')} disabled={busy} onClick={close}><Icon name="close" /></button></div>{children}</div></div>, document.body);
}
type Act = (action: ApiFriendsActionRequest) => Promise<ApiFriendsActionResponse | null>;
function FriendsInvite({ nickname, code, previewId, previousInviteCount, busy, act, onRetry, onClose }: { nickname: string; code: string | null; previewId?: string; previousInviteCount: number; busy: boolean; act: Act; onRetry: () => Promise<void>; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [cancelledForCode, setCancelledForCode] = useState<string | null>(null);
  const previousCancelled = !!code && cancelledForCode === code;
  const previousCount = previousCancelled ? 0 : previousInviteCount;
  const [prepared, setPrepared] = useState<{ code: string; previewId?: string; link: string } | null>(null);
  const link = prepared?.code === code && prepared?.previewId === previewId ? prepared.link : null;
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    void invitationURL(code, previewId).then((url) => { if (!cancelled) setPrepared({ code, previewId, link: url }); });
    return () => { cancelled = true; };
  }, [code, previewId]);
  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); trackAction('friend-invite-copy', 'success'); setCopied(true); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  }
  return <div className="friends-invite">{link ? <>
    <p className="friends-invite__expiry">{t('friends.inviteExpiry')}</p><InvitationParcel nickname={nickname} /><label className="friends-invite__url"><span className="sr-only">{t('friends.link')}</span><input readOnly value={link} onFocus={(event) => event.target.select()} /></label>
    {typeof navigator.share === 'function' && <button className="button button--primary" disabled={busy} onClick={async () => { try { await navigator.share({ url: link }); trackAction('friend-invite-share', 'success'); } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) await copy(); } }}><Icon name="share" />{t('friends.shareLink')}</button>}
    <button className={typeof navigator.share === 'function' ? 'text-button' : 'button button--primary'} disabled={busy} onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} />{t(copied ? 'friends.copied' : 'friends.copyLink')}</button>
    {copyFailed && <p className="friends-error" role="alert">{t('friends.actionFailed')}</p>}
    {previousCancelled && <p className="friends-notice" role="status"><Icon name="check" />{t('friends.previousRevoked')}</p>}
    <details className="friends-invite__cancellations"><summary>{t('friends.manageLinks')}</summary>
      <button className="text-button friends-invite__cancel" disabled={busy} onClick={async () => { if (code && await act({ action: 'revoke_invite', code })) onClose(); }}>{t('friends.revoke')}</button>
      {previousCount > 0 && <button className="text-button friends-invite__cancel" disabled={busy} onClick={async () => {
        if (code && await act({ action: 'revoke_previous_invites', code })) setCancelledForCode(code);
      }}>{t('friends.cancelPrevious', { count: previousCount })}</button>}
    </details>
  </> : busy || code ? <div className="friends-invite__loading" role="status" aria-label={t('friends.link')}><Icon name="refresh" className="spin" /></div> : <button className="button button--primary" onClick={() => void onRetry()}>{t('common.retry')}</button>}</div>;
}
function FriendDetails({ friend, busy, onRemove }: { friend: ApiFriendCard; busy: boolean; onRemove: () => Promise<void> }) {
  const { t } = useI18n(); const [removing, setRemoving] = useState(false);
  return <div className="friend-details"><FriendPostcard nickname={friend.nickname} arrivedThisWeek={friend.arrivedThisWeek} />{friend.stats ? <><div className="friend-details__metrics"><div><strong>{friend.stats.deliveredCount}</strong><span>{t('passport.delivered', { count: friend.stats.deliveredCount })}</span></div><div><strong>{friend.stats.averageDays == null ? '—' : t(friend.stats.averageDays === 1 ? 'friends.day' : 'friends.days', { count: friend.stats.averageDays })}</strong><span>{t('passport.average')}</span></div></div><FriendStampCollection stats={friend.stats} /></> : <p className="friends-privacy"><Icon name="lock" />{t('friends.privateStats')}</p>}
  <details className="friends-manage"><summary>{t('friends.manageFriendship')}</summary>{removing ? <div className="friends-remove-confirm"><h3>{t('friends.removeTitle', { name: friend.nickname })}</h3><p>{t('friends.removeDetail')}</p><button className="button button--secondary" disabled={busy} onClick={() => void onRemove()}>{t('friends.remove')}</button><button className="text-button" disabled={busy} onClick={() => setRemoving(false)}>{t('common.cancel')}</button></div> : <button className="friends-remove" disabled={busy} onClick={() => setRemoving(true)}>{t('friends.remove')}</button>}</details></div>;
}
