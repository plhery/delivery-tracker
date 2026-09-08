import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import type { ApiFriendProfile, ApiFriendsActionResponse, ApiFriendsSnapshot } from '../generated/apiContract';
import { FriendsError, type FriendsClient } from '../lib/friends';
import { previewInvitation, type PendingInvitationState } from '../lib/friendInvites';
import type { ParcelWithEvents } from '../types';
import { ArrivalScreen } from './ArrivalScreen';
import { FriendProfileForm, FriendsSheet } from './Friends';
import type { SignInScreen } from './SignInScreen';
import { useFriendsActivity } from './FriendsActivity';

type Props = ComponentProps<typeof SignInScreen> & {
  invitation: PendingInvitationState;
  onDismiss: () => void;
  client?: FriendsClient;
  parcels?: ParcelWithEvents[];
};
const emptyParcels: ParcelWithEvents[] = [];

export function FriendInvitation({ invitation, onDismiss, client, parcels = emptyParcels, ...signIn }: Props) {
  const { t } = useI18n();
  const activity = useFriendsActivity();
  const [receipt, setReceipt] = useState<ApiFriendsActionResponse | null>(null);
  const alive = useRef(true);
  const receiptCallbacks = useRef({ invitation, activity });
  useEffect(() => { receiptCallbacks.current = { invitation, activity }; }, [invitation, activity]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!receipt) return;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const current = receiptCallbacks.current;
      if (receipt.acceptedFriend) current.activity?.prepareArrival(receipt.acceptedFriend, document.hidden ? undefined : receipt.snapshot);
      current.invitation.clear(true);
    };
    const onVisibility = () => { if (document.hidden) finish(); };
    const timer = setTimeout(finish, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 300 : 950);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [receipt]);
  function received(result: ApiFriendsActionResponse) {
    if (!alive.current || document.hidden) { invitation.clear(true); return; }
    if (invitation.markAccepted()) setReceipt(result);
  }
  const code = invitation.pending?.code;
  const [nickname, setNickname] = useState<string | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let controller: AbortController | null = null;
    let disposed = false;
    async function load() {
      controller?.abort();
      const current = new AbortController(); controller = current;
      setNickname(null); setError(null);
      if (!code || document.hidden) return;
      try {
        const name = await previewInvitation(code, current.signal);
        if (!disposed && !current.signal.aborted) setNickname(name);
      } catch (reason) {
        if (!disposed && !current.signal.aborted) setError(reason instanceof FriendsError ? reason.key : 'friends.unavailable');
      }
    }
    void load();
    document.addEventListener('visibilitychange', load);
    return () => { disposed = true; controller?.abort(); document.removeEventListener('visibilitychange', load); };
  }, [code, retry]);
  const [beforeName, afterName] = t('friends.invitationTitle').split('{{name}}');
  const title = nickname ? <>{beforeName}<em className="invitation-name">{nickname}</em>{afterName}</> : t('friends.invitationGeneric');
  const failure = !code ? 'friends.inviteUnavailable' : error;
  const notice = failure ? <div className="invitation-notice" role="alert"><p>{t(failure)}</p>{failure !== 'friends.inviteUnavailable' && <button className="text-button" onClick={() => setRetry((value) => value + 1)}>{t('common.retry')}</button>}</div> : !nickname ? <p className="invitation-notice" role="status">{t('auth.loading')}</p> : undefined;
  const ios = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  return <ArrivalScreen {...signIn} title={title} subtitle={t('friends.signInToAccept')} showConfigurationHelp={false}
    screen={invitation.pending?.opened ? 'sign-in' : 'welcome'}
    onNavigate={(screen) => invitation.setOpened(screen === 'sign-in')}
    invitation={{ title, canOpen: !!nickname, received: !!receipt,
      onDismiss, notice, appURL: ios && code ? `swissdeliverytracker://invite#${code}` : undefined,
      afterOpen: receipt ? <section className="auth-flow friendship-received" role="status"><div className="auth-flow__heading"><h1 tabIndex={-1}>{t('friends.friendshipDelivered')}</h1></div></section>
        : !nickname ? <section className="auth-flow"><div className="auth-flow__heading"><h1 tabIndex={-1}>{title}</h1></div>{notice}</section>
        : client && code ? <InvitationAcceptance key={code} title={title} code={code} client={client} parcels={parcels} onAccepted={received} /> : undefined,
    }} />;
}

function InvitationAcceptance({ title, code, client, parcels, onAccepted }: { title: ReactNode; code: string; client: FriendsClient; parcels: ParcelWithEvents[]; onAccepted: (result: ApiFriendsActionResponse) => void }) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<ApiFriendsSnapshot | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const working = useRef(false);
  const generation = useRef(0);
  const latestParcels = useRef(parcels);
  useEffect(() => { latestParcels.current = parcels; }, [parcels]);
  useEffect(() => {
    const current = ++generation.current;
    void client.load(latestParcels.current).then((data) => { if (generation.current === current) { setSnapshot(data); setError(null); } }, () => { if (generation.current === current) setError('friends.unavailable'); });
    return () => { generation.current = current + 1; };
  }, [client, retry]);
  async function accept(profile?: ApiFriendProfile) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null);
    const current = generation.current;
    let enabled = !!snapshot?.profile;
    try {
      if (profile) {
        const saved = await client.action({ action: 'save_profile', ...profile }, parcels);
        if (generation.current !== current) return;
        if (!saved.snapshot?.profile) throw new FriendsError('friends.actionFailed');
        setSnapshot(saved.snapshot);
        enabled = true;
      }
      const result = await client.action({ action: 'accept_invite', code }, parcels);
      // A committed acceptance can finish while the preview is backgrounded.
      // The pending-link store checks the token before clearing a newer link.
      onAccepted(result);
    } catch (reason) {
      if (generation.current === current) setError(reason instanceof FriendsError ? reason.key : 'friends.actionFailed');
    } finally {
      working.current = false;
      if (generation.current === current) {
        setBusy(false);
        // Keep a saved profile and its choices if only the acceptance needs a retry.
        if (enabled) setCreating(false);
      }
    }
  }
  return <section className="auth-flow invitation-accept" aria-labelledby="invite-title">
    <div className="auth-flow__heading"><h1 id="invite-title" tabIndex={-1}>{title}</h1></div>
    {error && !creating && <div className="invitation-notice" role="alert"><p>{t(error)}</p>{!snapshot && <button className="text-button" onClick={() => setRetry((value) => value + 1)}>{t('common.retry')}</button>}</div>}
    {!snapshot ? !error && <p role="status">{t('auth.loading')}</p>
      : <button className="button button--primary" disabled={busy || error === 'friends.inviteUnavailable'} aria-busy={busy} onClick={() => { if (snapshot.profile) void accept(); else { setError(null); setCreating(true); } }}>{t(snapshot.profile ? 'friends.accept' : 'friends.enableToAccept')}</button>}
    {creating && <FriendsSheet title={t('friends.enable')} busy={busy} onClose={() => { setCreating(false); setError(null); }}>
      {error && <p className="friends-error" role="alert">{t(error)}</p>}
      <FriendProfileForm profile={null} parcels={parcels} busy={busy} submitKey="friends.joinAndAccept" onSave={accept} />
    </FriendsSheet>}
  </section>;
}
