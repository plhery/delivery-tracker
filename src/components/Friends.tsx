import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ApiFriendCard, ApiFriendProfile, ApiFriendsActionRequest, ApiFriendsActionResponse, ApiFriendsSnapshot, ApiFriendStamp } from '../generated/apiContract';
import { useI18n, type MessageKey } from '../i18n';
import { FriendsError, friendStamps, friendTone, ownFriendCard, type FriendsClient } from '../lib/friends';
import { useSheetDialog } from '../lib/modal';
import type { ParcelWithEvents } from '../types';
import { Icon, PostageStamp } from './Icon';

type Panel = 'settings' | 'invite' | 'accept' | 'disable' | ApiFriendCard | null;
export function Friends({ client, parcels, demo }: { client: FriendsClient; parcels: ParcelWithEvents[]; demo: boolean }) {
  const { t } = useI18n();
  const [data, setData] = useState<ApiFriendsSnapshot | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const generation = useRef(0);
  const working = useRef(false);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await client.load(parcels);
      if (current === generation.current) {
        setData(next); setError(null);
        setPanel((open) => typeof open === 'object' && open && !next.friends.some((friend) => friend.id === open.id) ? null : open);
      }
    } catch { if (current === generation.current) { setData(null); setPanel(null); setError('friends.unavailable'); } }
  }, [client, parcels]);
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
  }, [load, invalidate]);
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
  const close = () => { if (!busy) { setPanel(null); setError(null); } };
  const errorView = error && <p className="friends-error" role="alert">{t(error)}</p>;
  const total = [data?.ownCard, ...(data?.friends ?? [])].reduce((sum, friend) => sum + (friend?.stats?.stamps.length ?? 0), 0);
  const selected = typeof panel === 'object' && panel ? data?.friends.find((friend) => friend.id === panel.id) : null;
  return <div className="friends-page">
    {notice && <p role="status" className="friends-notice"><Icon name="check" />{t(notice)}</p>}
    {!panel && errorView}
    {!data ? <div className="friends-loading" role="status">{error ? <button className="button button--secondary" onClick={() => void load()}>{t('common.retry')}</button> : <div className="skeleton" aria-label={t('friends.title')} />}</div> : !data.profile ? <>
      <div className="friends-intro"><h2>{t('friends.joinTitle')}</h2><div className="friends-postage" aria-hidden="true"><PostageStamp icon="parcel" /><PostageStamp icon="friends" /></div></div>
      <FriendProfileForm profile={null} parcels={parcels} busy={busy} onSave={async (profile) => { await act({ action: 'save_profile', ...profile }); }} />
    </> : <>
      <button className="friends-own" aria-label={t('friends.settings')} onClick={() => setPanel('settings')}><span><span className="friend-avatar" aria-hidden="true">{Array.from(data.profile.nickname)[0]}</span>{data.profile.nickname}</span><Icon name="settings" /></button>
      {data.friends.length ? <section className="friends-cover"><div className="friends-cover__main"><div><strong>{total}</strong><span>{t('friends.collectionNote')}</span></div><div className="friends-postage" aria-hidden="true"><PostageStamp icon="parcel" /><PostageStamp icon="express" /></div></div></section> : <section className="friends-cover friends-empty"><div className="friends-postage" aria-hidden="true"><PostageStamp icon="parcel" /><PostageStamp icon="friends" /></div><h2>{t('friends.emptyTitle')}</h2></section>}
      <div className="friends-actions"><button className="button button--primary" onClick={() => setPanel('invite')}><Icon name="plus" />{t('friends.invite')}</button><button className="text-button friends-code-link" onClick={() => setPanel('accept')}>{t('friends.enterCode')}<Icon name="arrow" /></button></div>
      {!!data.friends.length && <section><div className="section-heading"><h2>{t('friends.circle')}</h2><span>{demo ? t('friends.demoPeople') : data.friends.length}</span></div>
        <div className="friends-grid">{data.friends.map((friend) => <button key={friend.id} className={`friend-card tone-${friendTone(friend.id)}`} onClick={() => setPanel(friend)}><FriendCardBody friend={friend} /><span className="friend-card__more"><Icon name="arrow" /></span></button>)}</div>
      </section>}
    </>}
    {panel && <FriendsSheet title={typeof panel === 'object' ? panel.nickname : t(panel === 'settings' ? 'friends.settings' : panel === 'disable' ? 'friends.disableTitle' : panel === 'accept' ? 'friends.enterCode' : 'friends.inviteTitle')} onClose={close}>
      {errorView}
      {panel === 'settings' && data?.profile && <><FriendProfileForm profile={data.profile} parcels={parcels} busy={busy} onSave={async (profile) => { if (await act({ action: 'save_profile', ...profile })) close(); }} /><button className="friends-remove" onClick={() => setPanel('disable')}>{t('friends.disable')}</button></>}
      {panel === 'disable' && <><p>{t('friends.disableDetail')}</p><button className="button button--primary" disabled={busy} onClick={async () => { if (await act({ action: 'disable' })) close(); }}>{t('friends.disable')}</button></>}
      {(panel === 'invite' || panel === 'accept') && (demo ? <p>{t('friends.demoInvites')}</p> : panel === 'invite' ? <FriendsInvite busy={busy} act={act} onClose={close} /> : <FriendsAccept busy={busy} act={act} onAccepted={() => { setPanel(null); setNotice('friends.accepted'); }} />)}
      {selected && <FriendDetails friend={selected} busy={busy} onRemove={async () => { if (await act({ action: 'remove_friend', friendId: selected.id })) close(); }} />}
    </FriendsSheet>}
  </div>;
}
function FriendCardBody({ friend }: { friend: ApiFriendCard }) {
  const { t } = useI18n();
  const days = friend.stats?.averageDays;
  return <><span className="friend-card__heading"><span className="friend-avatar" aria-hidden="true">{Array.from(friend.nickname)[0]}</span><strong>{friend.nickname}</strong></span>
    {friend.stats ? <><span className="friend-card__stats"><span><strong>{friend.stats.deliveredCount}</strong>{t('passport.delivered')}</span><span><strong>{days == null ? '—' : t(days === 1 ? 'friends.day' : 'friends.days', { count: days })}</strong>{t('passport.average')}</span></span><span className="friend-card__stamps" aria-label={t('friends.stamps')}>{friend.stats.stamps.map((stamp) => <span key={stamp} title={t(friendStamps[stamp].title)}><Icon name={friendStamps[stamp].icon} /></span>)}</span></> : <span className="friend-card__private"><Icon name="lock" />{t('friends.privateStats')}</span>}
    {friend.arrivedThisWeek && <span className="friend-card__arrival"><i />{t('friends.arrived')}</span>}</>;
}
function FriendProfileForm({ profile, parcels, busy, onSave }: { profile: ApiFriendProfile | null; parcels: ParcelWithEvents[]; busy: boolean; onSave: (value: ApiFriendProfile) => Promise<void> }) {
  const { t } = useI18n();
  const [name, setName] = useState(profile?.nickname ?? '');
  const [stats, setStats] = useState(profile?.shareStats ?? true);
  const [arrival, setArrival] = useState(profile?.shareArrival ?? false);
  const value = { nickname: name.trim(), shareStats: stats, shareArrival: arrival };
  return <form className="friends-profile" onSubmit={(event) => { event.preventDefault(); if (value.nickname) void onSave(value); }}>
    <label className="friends-name">{t('friends.nickname')}<input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} placeholder={t('friends.nicknamePlaceholder')} autoComplete="off" required disabled={busy} /></label>
    <div className="friends-sharing">
      <label className="friends-toggle"><span><strong>{t('friends.shareStats')}</strong><small>{t('friends.shareStatsDetail')}</small></span><input type="checkbox" role="switch" checked={stats} onChange={(event) => setStats(event.target.checked)} disabled={busy} /></label>
      <label className="friends-toggle"><span><strong>{t('friends.shareArrival')}</strong><small>{t('friends.shareArrivalDetail')}</small></span><input type="checkbox" role="switch" checked={arrival} onChange={(event) => setArrival(event.target.checked)} disabled={busy} /></label>
    </div>
    <details className="friends-preview"><summary>{t('friends.preview')}<Icon name="chevron" /></summary><div className="friend-card tone-blue"><FriendCardBody friend={ownFriendCard(parcels, { ...value, nickname: value.nickname || t('friends.you') })} /></div></details>
    <p className="friends-privacy"><Icon name="lock" />{t('friends.privacy')}</p><button className="button button--primary" disabled={busy || !value.nickname}>{t(profile ? 'friends.save' : 'friends.join')}</button>
  </form>;
}
function FriendsSheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  const [dialog, close] = useSheetDialog<HTMLDivElement>(true, onClose);
  return createPortal(<div className="sheet-backdrop" onClick={close}><div ref={dialog} className="sheet friends-sheet" role="dialog" aria-modal="true" aria-labelledby="friends-sheet-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}><div className="sheet__grabber" aria-hidden="true" /><div className="sheet__heading"><h2 id="friends-sheet-title" className="sheet__title">{title}</h2><button className="sheet__close" aria-label={t('common.close')} onClick={close}><Icon name="close" /></button></div>{children}</div></div>, document.body);
}
type Act = (action: ApiFriendsActionRequest) => Promise<ApiFriendsActionResponse | null>;
function FriendsInvite({ busy, act, onClose }: { busy: boolean; act: Act; onClose: () => void }) {
  const { t } = useI18n(); const [code, setCode] = useState<string | null>(null); const [copied, setCopied] = useState(false);
  return <div className="friends-invite"><p>{t('friends.inviteHint')}</p>{code ? <><label>{t('friends.code')}<input readOnly value={code} onFocus={(event) => event.target.select()} /></label><small>{t('friends.inviteExpiry')}</small><button className="button button--primary" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); } }}>{t(copied ? 'friends.copied' : 'friends.copyCode')}<Icon name={copied ? 'check' : 'copy'} /></button><button className="text-button" disabled={busy} onClick={async () => { if (await act({ action: 'revoke_invite' })) onClose(); }}>{t('friends.revoke')}</button></> : <button className="button button--primary" disabled={busy} onClick={async () => { const result = await act({ action: 'create_invite' }); if (result?.inviteCode) setCode(result.inviteCode); }}>{t('friends.invite')}</button>}</div>;
}
function FriendsAccept({ busy, act, onAccepted }: { busy: boolean; act: Act; onAccepted: () => void }) {
  const { t } = useI18n(); const [code, setCode] = useState(''); const [name, setName] = useState<string | null>(null);
  return <form className="friends-invite" onSubmit={async (event) => { event.preventDefault(); const result = await act({ action: 'preview_invite', code }); if (result?.previewNickname) setName(result.previewNickname); }}><label>{t('friends.code')}<input value={code} onChange={(event) => { setCode(event.target.value.replace(/\s/g, '').toLowerCase()); setName(null); }} placeholder={t('friends.codePlaceholder')} autoCapitalize="none" autoComplete="off" maxLength={64} disabled={busy} /></label>{name ? <><h3>{t('friends.invitedBy', { name })}</h3><p className="friends-privacy">{t('friends.privacy')}</p><button type="button" className="button button--primary" disabled={busy} onClick={async () => { if (await act({ action: 'accept_invite', code })) onAccepted(); }}>{t('friends.accept')}</button></> : <button className="button button--primary" disabled={busy || !/^[a-f0-9]{32}$/.test(code)}>{t('friends.checkCode')}</button>}</form>;
}
function FriendDetails({ friend, busy, onRemove }: { friend: ApiFriendCard; busy: boolean; onRemove: () => Promise<void> }) {
  const { t } = useI18n(); const [stamp, setStamp] = useState<ApiFriendStamp | null>(null); const [removing, setRemoving] = useState(false);
  return <div className="friend-details"><div className={`friend-card tone-${friendTone(friend.id)}`}><FriendCardBody friend={friend} /></div>{!!friend.stats?.stamps.length && <><p className="eyebrow">{t('friends.stampHint')}</p><div className="friends-stamp-album">{friend.stats.stamps.map((id) => <button key={id} aria-label={t(friendStamps[id].title)} aria-pressed={stamp === id} className={`tone-${friendStamps[id].tone}`} onClick={() => setStamp(id)}><PostageStamp icon={friendStamps[id].icon} /></button>)}</div>{stamp && <p className="friends-stamp-story" key={stamp} role="status"><strong>{t(friendStamps[stamp].title)}</strong>{t(friendStamps[stamp].explanation)}</p>}</>}{removing ? <div className="friends-remove-confirm"><h3>{t('friends.removeTitle', { name: friend.nickname })}</h3><p>{t('friends.removeDetail')}</p><button className="button button--secondary" disabled={busy} onClick={() => void onRemove()}>{t('friends.remove')}</button><button className="text-button" onClick={() => setRemoving(false)}>{t('common.cancel')}</button></div> : <button className="friends-remove" onClick={() => setRemoving(true)}>{t('friends.remove')}</button>}</div>;
}
