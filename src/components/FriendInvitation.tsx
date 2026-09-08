import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import type { ApiFriendProfile, ApiFriendsSnapshot } from '../generated/apiContract';
import { FriendsError, type FriendsClient } from '../lib/friends';
import { previewInvitation, type PendingInvitationState } from '../lib/friendInvites';
import type { ParcelWithEvents } from '../types';
import { ArrivalScreen } from './ArrivalScreen';
import { FriendProfileForm } from './Friends';
import type { SignInScreen } from './SignInScreen';

type Props = ComponentProps<typeof SignInScreen> & {
  invitation: PendingInvitationState;
  onDismiss: () => void;
  client?: FriendsClient;
  parcels?: ParcelWithEvents[];
};
const emptyParcels: ParcelWithEvents[] = [];

export function FriendInvitation({ invitation, onDismiss, client, parcels = emptyParcels, ...signIn }: Props) {
  const { t } = useI18n();
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
  const title = nickname ? t('friends.invitationTitle', { name: nickname }) : t('friends.invitationGeneric');
  const failure = !code ? 'friends.inviteUnavailable' : error;
  const notice = failure ? <div className="invitation-notice" role="alert"><p>{t(failure)}</p>{failure !== 'friends.inviteUnavailable' && <button className="text-button" onClick={() => setRetry((value) => value + 1)}>{t('common.retry')}</button>}</div> : !nickname ? <p className="invitation-notice" role="status">{t('auth.loading')}</p> : undefined;
  const ios = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  return <ArrivalScreen {...signIn} title={title} subtitle={t('friends.signInToAccept')} showConfigurationHelp={false}
    screen={invitation.pending?.opened ? 'sign-in' : 'welcome'}
    onNavigate={(screen) => invitation.setOpened(screen === 'sign-in')}
    invitation={{ title, subtitle: nickname ? t('friends.invitationSubtitle') : undefined, canOpen: !!nickname,
      onDismiss, notice, appURL: ios && code ? `swissdeliverytracker://invite#${code}` : undefined,
      afterOpen: !nickname ? <section className="auth-flow"><div className="auth-flow__heading"><h1 tabIndex={-1}>{title}</h1></div>{notice}</section>
        : client && code ? <InvitationAcceptance key={code} title={title} code={code} client={client} parcels={parcels} onAccepted={() => invitation.clear(true)} /> : undefined,
    }} />;
}

function InvitationAcceptance({ title, code, client, parcels, onAccepted }: { title: string; code: string; client: FriendsClient; parcels: ParcelWithEvents[]; onAccepted: () => void }) {
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
    try {
      if (profile) {
        const saved = await client.action({ action: 'save_profile', ...profile }, parcels);
        if (generation.current !== current) return;
        if (!saved.snapshot?.profile) throw new FriendsError('friends.actionFailed');
        setSnapshot(saved.snapshot);
      }
      await client.action({ action: 'accept_invite', code }, parcels);
      // A committed acceptance can finish while the preview is backgrounded.
      // The pending-link store checks the token before clearing a newer link.
      onAccepted();
    } catch (reason) {
      if (generation.current === current) setError(reason instanceof FriendsError ? reason.key : 'friends.actionFailed');
    } finally { working.current = false; if (generation.current === current) setBusy(false); }
  }
  return <section className="auth-flow invitation-accept" aria-labelledby="invite-title">
    <div className="auth-flow__heading"><h1 id="invite-title" tabIndex={-1}>{title}</h1><p>{t('friends.invitationSubtitle')}</p></div>
    {error && <div className="invitation-notice" role="alert"><p>{t(error)}</p>{!snapshot && <button className="text-button" onClick={() => setRetry((value) => value + 1)}>{t('common.retry')}</button>}</div>}
    {!snapshot ? !error && <p role="status">{t('auth.loading')}</p> : creating
      ? <FriendProfileForm profile={null} parcels={parcels} busy={busy} submitKey="friends.joinAndAccept" onSave={accept} />
      : <button className="button button--primary" disabled={busy || error === 'friends.inviteUnavailable'} onClick={() => snapshot.profile ? void accept() : setCreating(true)}>{t('friends.accept')}</button>}
  </section>;
}
