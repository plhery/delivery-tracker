import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ApiFriendCard, ApiFriendProfile, ApiFriendsActionRequest, ApiFriendsActionResponse, ApiFriendsSnapshot, ApiFriendStamp } from '../generated/apiContract';
import { useI18n, type MessageKey } from '../i18n';
import { FriendsError, friendStamps, friendTone, ownFriendCard, type FriendsClient } from '../lib/friends';
import { invitationCode, invitationURL, openPendingInvitation } from '../lib/friendInvites';
import { useSheetDialog } from '../lib/modal';
import type { ParcelWithEvents } from '../types';
import { Icon, PostageStamp } from './Icon';
import { useFriendsActivity } from './FriendsActivity';

type Panel = 'settings' | 'invite' | 'accept' | 'disable' | ApiFriendCard | null;
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
  const [invite, setInvite] = useState<{ code: string; previewId?: string } | null>(null);
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
    if (result?.inviteCode) setInvite({ code: result.inviteCode, previewId: result.previewId });
  }
  const close = () => { if (!busy) { setPanel(null); setError(null); } };
  const errorView = error && <p className="friends-error" role="alert">{t(error)}</p>;
  const total = [data?.ownCard, ...(data?.friends ?? [])].reduce((sum, friend) => sum + (friend?.stats?.stamps.length ?? 0), 0);
  const selected = typeof panel === 'object' && panel ? data?.friends.find((friend) => friend.id === panel.id) : null;
  const featured = data?.friends.find((friend) => friend.id === focusId);
  const remainingFriends = data?.friends.filter((friend) => friend.id !== featured?.id) ?? [];
  const friendButton = (friend: ApiFriendCard) => <button key={friend.id} ref={friend.id === focusId ? arrivalCard : undefined} data-arriving={friend.id === focusId ? (landed ? 'landed' : 'waiting') : undefined} className={`friend-card tone-${friendTone(friend.id)}`} onClick={() => setPanel(friend)}><FriendCardBody friend={friend} /><span className="friend-card__more"><Icon name="arrow" /></span></button>;
  return <div className="friends-page" data-empty={!!data?.profile && !data.friends.length}>
    {data && focusId && checkedFocusId === focusId && !focusReady && <p className="friends-notice" role="status">{t('friends.friendUnavailable')}</p>}
    {notice && <p role="status" className="friends-notice"><Icon name="check" />{t(notice)}</p>}
    {!panel && errorView}
    {!data ? <div className="friends-loading" role="status">{error ? <button className="button button--secondary" onClick={() => void load()}>{t('common.retry')}</button> : <div className="skeleton" aria-label={t('friends.title')} />}</div> : !data.profile ? <>
      <div className="friends-intro"><h2>{t('friends.joinTitle')}</h2><div className="friends-postage" aria-hidden="true"><PostageStamp icon="parcel" /><PostageStamp icon="friends" /></div></div>
      <FriendProfileForm profile={null} parcels={parcels} busy={busy} onSave={async (profile) => { await act({ action: 'save_profile', ...profile }); }} />
    </> : <>
      {featured && <div className="friends-received-card">{friendButton(featured)}</div>}
      <div className="friends-summary"><button className="friends-own friend-card tone-blue" aria-label={t('friends.settings')} onClick={() => setPanel('settings')}><FriendCardBody friend={data.ownCard ?? ownFriendCard(parcels, data.profile)} showSharingStatus /><span className="friend-card__more"><Icon name="settings" /></span></button>
      {!!data.friends.length && <section className="friends-cover"><div className="friends-cover__main"><div><strong>{total}</strong><span>{t('friends.collectionNote')}</span></div><div className="friends-postage" aria-hidden="true"><PostageStamp icon="parcel" /><PostageStamp icon="express" /></div></div></section>}</div>
      {!data.friends.length && <h2 className="friends-empty-title">{t('friends.emptyTitle')}</h2>}
      <div className="friends-actions"><button className="button button--primary" disabled={busy} onClick={() => void inviteFriend()}><Icon name="plus" />{t('friends.invite')}</button><button className="text-button friends-code-link" onClick={() => setPanel('accept')}>{t('friends.enterCode')}<Icon name="arrow" /></button></div>
      {!!remainingFriends.length && <section><div className="section-heading"><h2>{t('friends.circle')}</h2><span>{demo ? t('friends.demoPeople') : data.friends.length}</span></div>
        <div className="friends-grid">{remainingFriends.map(friendButton)}</div>
      </section>}
    </>}
    {panel && <FriendsSheet title={typeof panel === 'object' ? panel.nickname : t(panel === 'settings' ? 'friends.settings' : panel === 'disable' ? 'friends.disableTitle' : panel === 'accept' ? 'friends.enterCode' : 'friends.inviteTitle')} onClose={close} busy={busy}>
      {errorView}
      {panel === 'settings' && data?.profile && <><FriendProfileForm profile={data.profile} parcels={parcels} busy={busy} onSave={async (profile) => { if (await act({ action: 'save_profile', ...profile })) close(); }} /><button className="friends-remove" onClick={() => setPanel('disable')}>{t('friends.disable')}</button></>}
      {panel === 'disable' && <><p>{t('friends.disableDetail')}</p><button className="button button--primary" disabled={busy} onClick={async () => { if (await act({ action: 'disable' })) close(); }}>{t('friends.disable')}</button></>}
      {(panel === 'invite' || panel === 'accept') && (demo ? <>
        <p>{t('friends.demoInvites')}</p>
        {onExitDemo && <button className="button button--primary" onClick={() => { close(); onExitDemo(); }}>{t('welcome.signInInstead')}</button>}
      </> : panel === 'invite' ? <FriendsInvite code={invite?.code ?? null} previewId={invite?.previewId} busy={busy} act={act} onRetry={inviteFriend} onClose={close} /> : <FriendsAccept onOpen={() => setPanel(null)} />)}
      {selected && <FriendDetails friend={selected} busy={busy} onRemove={async () => { if (await act({ action: 'remove_friend', friendId: selected.id })) close(); }} />}
    </FriendsSheet>}
  </div>;
}
function FriendCardBody({ friend, showSharingStatus = false, magic = 0 }: { friend: ApiFriendCard; showSharingStatus?: boolean; magic?: number }) {
  const { t } = useI18n();
  const days = friend.stats?.averageDays;
  return <><span className="friend-card__heading"><span className="friend-avatar" aria-hidden="true" key={magic}><span className="postage-stamp"><span className="postage-stamp__print">{Array.from(friend.nickname)[0]}</span></span><span className="friend-avatar__spark">✦</span></span><span className="friend-card__name"><small aria-hidden="true">{t('passport.title')}</small><strong>{friend.nickname}</strong></span></span>
    <span className="friend-card__collection">{friend.stats ? <><span className="friend-card__stats"><span><strong>{friend.stats.deliveredCount}</strong>{t('passport.delivered')}</span><span><strong>{days == null ? '—' : t(days === 1 ? 'friends.day' : 'friends.days', { count: days })}</strong>{t('passport.average')}</span></span><span className="friend-card__stamps" aria-label={t('friends.stamps')}>{friend.stats.stamps.map((stamp) => <span key={stamp} title={t(friendStamps[stamp].title)}><PostageStamp icon={friendStamps[stamp].icon} /></span>)}</span></> : <span className="friend-card__private"><Icon name="lock" />{t('friends.privateStats')}</span>}</span>
    {(friend.arrivedThisWeek || showSharingStatus) && <span className={`friend-card__arrival${friend.arrivedThisWeek ? '' : ' friend-card__arrival--quiet'}`}><Icon name={friend.arrivedThisWeek == null ? 'lock' : 'parcel'} />{t(friend.arrivedThisWeek ? 'friends.arrived' : friend.arrivedThisWeek === false ? 'friends.noArrival' : 'friends.privateArrival')}</span>}</>;
}
export function FriendProfileForm({ profile, parcels, busy, onSave, submitKey }: { profile: ApiFriendProfile | null; parcels: ParcelWithEvents[]; busy: boolean; onSave: (value: ApiFriendProfile) => Promise<void>; submitKey?: MessageKey }) {
  const { t } = useI18n();
  const [name, setName] = useState(profile?.nickname ?? '');
  const [stats, setStats] = useState(profile?.shareStats ?? true);
  const [arrival, setArrival] = useState(profile?.shareArrival ?? true);
  const [magic, setMagic] = useState(0);
  const [nameFocused, setNameFocused] = useState(false);
  const [settledName, setSettledName] = useState<string | null>(null);
  const previewId = useId();
  const value = { nickname: name.trim(), shareStats: stats, shareArrival: arrival };
  const attention = profile || busy ? undefined : !value.nickname ? (nameFocused ? undefined : 'name') : settledName === value.nickname ? 'create' : undefined;
  useEffect(() => {
    if (profile || busy || !name.trim()) return;
    const timer = window.setTimeout(() => setSettledName(name.trim()), 900);
    return () => window.clearTimeout(timer);
  }, [name, profile, busy]);
  return <form className="friends-profile" data-attention={attention} onSubmit={(event) => { event.preventDefault(); if (value.nickname) void onSave(value); }}>
    <label className="friends-name">{t('friends.nickname')}<span className="friends-name__field"><input value={name} onChange={(event) => { setName(event.target.value); setSettledName(null); }} onFocus={() => setNameFocused(true)} onBlur={() => setNameFocused(false)} maxLength={24} placeholder={t('friends.nicknamePlaceholder')} autoComplete="off" required disabled={busy} /><span className="friends-attention" aria-hidden="true" /></span></label>
    <section className="friends-preview" aria-labelledby={previewId}><p id={previewId}>{t('friends.preview')}</p><button type="button" className="friend-card tone-blue" disabled={busy} onClick={() => setMagic((value) => value + 1)}><FriendCardBody friend={ownFriendCard(parcels, { ...value, nickname: value.nickname || t('friends.you') })} showSharingStatus magic={magic} /></button></section>
    <div className="friends-sharing">
      <label className="friends-toggle"><input type="checkbox" role="switch" checked={stats} onChange={(event) => { setStats(event.target.checked); setMagic((value) => value + 1); }} disabled={busy} /><span>{t('friends.shareStats')}</span></label>
      <label className="friends-toggle"><input type="checkbox" role="switch" checked={arrival} onChange={(event) => { setArrival(event.target.checked); setMagic((value) => value + 1); }} disabled={busy} /><span>{t('friends.shareArrival')}</span></label>
    </div>
    <p className="friends-privacy"><Icon name="lock" />{t('friends.privacy')}</p><button className="button button--primary friends-join" disabled={busy || !value.nickname}>{t(submitKey ?? (profile ? 'friends.save' : 'friends.join'))}<span className="friends-attention" aria-hidden="true" /></button>
  </form>;
}
export function FriendsSheet({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const { t } = useI18n();
  const [dialog, close] = useSheetDialog<HTMLDivElement>(true, onClose, undefined, undefined, busy);
  return createPortal(<div className="sheet-backdrop" onClick={close}><div ref={dialog} className="sheet friends-sheet" role="dialog" aria-modal="true" aria-labelledby="friends-sheet-title" aria-busy={busy} tabIndex={-1} onClick={(event) => event.stopPropagation()}><div className="sheet__grabber" aria-hidden="true" /><div className="sheet__heading"><h2 id="friends-sheet-title" className="sheet__title">{title}</h2><button className="sheet__close" aria-label={t('common.close')} disabled={busy} onClick={close}><Icon name="close" /></button></div>{children}</div></div>, document.body);
}
type Act = (action: ApiFriendsActionRequest) => Promise<ApiFriendsActionResponse | null>;
function FriendsInvite({ code, previewId, busy, act, onRetry, onClose }: { code: string | null; previewId?: string; busy: boolean; act: Act; onRetry: () => Promise<void>; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
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
    try { await navigator.clipboard.writeText(link); setCopied(true); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  }
  return <div className="friends-invite">{link ? <>
    <label>{t('friends.link')}<input readOnly value={link} onFocus={(event) => event.target.select()} /></label>
    <small>{t('friends.inviteExpiry')}</small>
    {typeof navigator.share === 'function' && <button className="button button--primary" onClick={async () => { try { await navigator.share({ url: link }); } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) await copy(); } }}>{t('friends.shareLink')}<Icon name="arrow" /></button>}
    <button className={typeof navigator.share === 'function' ? 'text-button' : 'button button--primary'} onClick={() => void copy()}>{t(copied ? 'friends.copied' : 'friends.copyLink')}<Icon name={copied ? 'check' : 'copy'} /></button>
    {copyFailed && <p className="friends-error" role="alert">{t('friends.actionFailed')}</p>}
    <button className="text-button" disabled={busy} onClick={async () => { if (await act({ action: 'revoke_invite' })) onClose(); }}>{t('friends.revoke')}</button>
  </> : busy || code ? <div className="friends-invite__loading" role="status" aria-label={t('friends.link')}><Icon name="refresh" className="spin" /></div> : <button className="button button--primary" onClick={() => void onRetry()}>{t('common.retry')}</button>}</div>;
}
function FriendsAccept({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n(); const [link, setLink] = useState('');
  return <form className="friends-invite" onSubmit={(event) => { event.preventDefault(); if (invitationCode(link)) { onOpen(); openPendingInvitation(link); } }}>
    <label>{t('friends.link')}<input type="url" value={link} onChange={(event) => setLink(event.target.value)} placeholder={t('friends.linkPlaceholder')} autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={2048} /></label>
    <button className="button button--primary" disabled={!invitationCode(link)}>{t('friends.openLink')}</button>
  </form>;
}
function FriendDetails({ friend, busy, onRemove }: { friend: ApiFriendCard; busy: boolean; onRemove: () => Promise<void> }) {
  const { t } = useI18n(); const [stamp, setStamp] = useState<ApiFriendStamp | null>(null); const [removing, setRemoving] = useState(false);
  return <div className="friend-details"><div className={`friend-card tone-${friendTone(friend.id)}`}><FriendCardBody friend={friend} /></div>{!!friend.stats?.stamps.length && <><p className="eyebrow">{t('friends.stampHint')}</p><div className="friends-stamp-album">{friend.stats.stamps.map((id) => <button key={id} aria-label={t(friendStamps[id].title)} aria-pressed={stamp === id} className={`tone-${friendStamps[id].tone}`} onClick={() => setStamp(id)}><PostageStamp icon={friendStamps[id].icon} /></button>)}</div>{stamp && <p className="friends-stamp-story" key={stamp} role="status"><strong>{t(friendStamps[stamp].title)}</strong>{t(friendStamps[stamp].explanation)}</p>}</>}{removing ? <div className="friends-remove-confirm"><h3>{t('friends.removeTitle', { name: friend.nickname })}</h3><p>{t('friends.removeDetail')}</p><button className="button button--secondary" disabled={busy} onClick={() => void onRemove()}>{t('friends.remove')}</button><button className="text-button" onClick={() => setRemoving(false)}>{t('common.cancel')}</button></div> : <button className="friends-remove" onClick={() => setRemoving(true)}>{t('friends.remove')}</button>}</div>;
}
