import { useCallback, useEffect, useMemo, type ComponentProps } from 'react';
import App from './App';
import type { useAuth } from './auth/AuthContext';
import { ArrivalScreen } from './components/ArrivalScreen';
import { endSignInStep, type EntryScreen, type useEntryExperience } from './lib/experience';
import { createDemoRepo } from './store/demoRepo';
import { deleteAccount, downloadAccountExport, exportAccount } from './lib/account';
import {
  disablePushNotifications,
  unsubscribePushNotificationsLocally,
} from './lib/pushNotifications';
import { browserStorage, clearApiCache, createApiRepo } from './store/apiRepo';
import { ParcelsProvider } from './store/ParcelsContext';
import { useI18n } from './i18n';
import type { PendingInvitationState } from './lib/friendInvites';
import { createFriendsClient } from './lib/friends';
import { restoreRequestedParcel } from './lib/requestedParcel';
import { FriendInvitation } from './components/FriendInvitation';
import { useParcels } from './store/ParcelsContext';
import { FriendsActivityProvider } from './components/FriendsActivity';
import type { ApiAuth } from './lib/apiClient';
import { KeepPendingInDemo, KeepPendingParcel } from './peek/KeepPending';
import { BringAlongInDemo, BringAlongParcels } from './peek/parcel/BringAlong';
import { PeekRoot } from './peek/PeekRoot';
import { keepParcelLink } from './peek/pending';
import { leaveParcelLink, openLanding } from './peek/route';
import type { PeekSession } from './peek/session';
import type { ParcelRepo } from './types';

/**
 * Everything behind the front door in a build with accounts: the deliveries
 * of someone signed in, the sign-in step, an invitation, and the demo. The
 * page fetches this file when one of them is about to show (`accountCode`),
 * and `ApiApplication` says which.
 */
export function ApiAccount({ auth, experience, invitation, demoAddress, linkId, landingAddress, parcelLinkId, leaveSignIn }: {
  auth: ReturnType<typeof useAuth>;
  experience: ReturnType<typeof useEntryExperience>;
  invitation: PendingInvitationState;
  /** The page is at the demo's address. */
  demoAddress: boolean;
  /** The parcel link the address names. */
  linkId: string | null;
  /** The page is at the landing's own address. */
  landingAddress: boolean;
  /** The link id of the parcel page the server rendered. */
  parcelLinkId: string | null;
  /** The sign-in step's own navigation. */
  leaveSignIn: (next: EntryScreen) => void;
}) {
  const { t } = useI18n();
  const demoRepo = useMemo(() => createDemoRepo(), []);
  const signOut = auth.signOut;
  const navigate = experience.navigate;
  const storage = browserStorage();
  const userId = auth.user?.id;
  const sessionAuth = useMemo(
    () => userId ? {
      userId,
      getAccessToken: auth.getAccessToken,
      signal: auth.signal,
    } : undefined,
    [userId, auth.getAccessToken, auth.signal],
  );
  const handleSignOut = useCallback(async () => {
    if (sessionAuth) {
      void disablePushNotifications(sessionAuth).catch(() => undefined);
      clearApiCache(storage, sessionAuth.userId);
    }
    const completion = signOut();
    navigate('welcome');
    await completion;
  }, [sessionAuth, signOut, storage, navigate]);
  const apiAuth = useMemo(
    () => sessionAuth ? {
      ...sessionAuth,
      onAuthenticationFailure: handleSignOut,
    } : undefined,
    [sessionAuth, handleSignOut],
  );
  const handleExport = useCallback(async () => {
    if (!apiAuth) return;
    const result = await exportAccount(apiAuth);
    apiAuth.signal?.throwIfAborted();
    downloadAccountExport(result);
  }, [apiAuth]);
  const handleDelete = useCallback(async (confirmation: string) => {
    if (!apiAuth) return;
    await deleteAccount(apiAuth, confirmation);
    apiAuth.signal?.throwIfAborted();
    void unsubscribePushNotificationsLocally().catch(() => undefined);
    clearApiCache(storage, apiAuth.userId);
    await signOut();
    navigate('welcome');
  }, [apiAuth, signOut, storage, navigate]);
  const repo = useMemo(
    () => apiAuth ? createApiRepo(
      30_000,
      1_000,
      storage,
      apiAuth,
    ) : null,
    [apiAuth, storage],
  );
  const friendsClient = useMemo(() => createFriendsClient(false, apiAuth), [apiAuth]);
  // Signed in after a round trip to a sign-in provider: the parcel the address asked for before it opens now.
  useEffect(() => {
    if (!userId) return;
    endSignInStep();
    restoreRequestedParcel();
  }, [userId]);
  const invitationProps: ComponentProps<typeof FriendInvitation> = {
    invitation, onDismiss: () => { invitation.clear(); if (!auth.user) experience.navigate('welcome'); },
    configured: auth.status !== 'unconfigured', googleEnabled: auth.googleEnabled, appleEnabled: auth.appleEnabled, emailOtpEnabled: auth.emailOtpEnabled,
    signInWithGoogle: auth.signInWithGoogle, signInWithApple: auth.signInWithApple, sendCode: auth.sendCode, verifyCode: auth.verifyCode,
  };
  // Someone signed in has the landing at its own address; a visitor's is `/`, where leaving the demo leads.
  const demo = <ParcelsProvider key="demo" repo={demoRepo}>
    <App onExitDemo={() => experience.navigate('welcome')} onOpenLanding={auth.user ? openLanding : () => experience.navigate('welcome')} />
  </ParcelsProvider>;
  // The demo's address shows the demo to anyone at once, signed in or not. Leaving the demo returns to `/`.
  if (demoAddress) return demo;
  if (auth.status === 'unconfigured' || auth.status === 'anonymous') {
    if (invitation.pending) return <FriendInvitation key={invitation.pending.code ?? 'invalid'} {...invitationProps} />;
    if (experience.screen === 'demo') return demo;
    return (
      <ArrivalScreen
        screen="sign-in"
        onNavigate={leaveSignIn}
        configured={auth.status !== 'unconfigured'}
        googleEnabled={auth.googleEnabled}
        appleEnabled={auth.appleEnabled}
        emailOtpEnabled={auth.emailOtpEnabled}
        signInWithGoogle={auth.signInWithGoogle}
        signInWithApple={auth.signInWithApple}
        sendCode={auth.sendCode}
        verifyCode={auth.verifyCode}
      />
    );
  }
  if (!repo) return null;
  return (
    <FriendsActivityProvider key={auth.user?.id} auth={apiAuth!} paused={!!invitation.pending}>
    <ParcelsProvider key={auth.user?.id} repo={repo}>
      <KeepPendingParcel auth={apiAuth!} />
      {linkId || landingAddress ? <SignedInPeek auth={apiAuth!} email={auth.user?.email} serverLinkId={parcelLinkId} />
        : invitation.pending ? <AuthenticatedInvitation key={invitation.pending.code ?? 'invalid'} {...invitationProps} client={friendsClient} /> : <><App
        accountEmail={auth.user?.email ?? t('native.account')}
        onSignOut={handleSignOut}
        onExportAccount={handleExport}
        onDeleteAccount={handleDelete}
        onOpenLanding={openLanding}
        apiAuth={apiAuth}
      /><BringAlongParcels auth={apiAuth!} /></>}
    </ParcelsProvider>
    </FriendsActivityProvider>
  );
}

function AuthenticatedInvitation(props: ComponentProps<typeof FriendInvitation>) {
  const { parcels } = useParcels();
  return <FriendInvitation {...props} parcels={parcels} />;
}

/**
 * A parcel page opened by someone signed in: it can join their deliveries
 * without leaving the page. The landing at its own address shows them the way
 * back to their deliveries.
 */
function SignedInPeek({ auth, email, serverLinkId }: { auth: ApiAuth; email?: string; serverLinkId: string | null }) {
  const { parcels, loading, retryLoad } = useParcels();
  const session = useMemo<PeekSession>(() => ({
    account: 'signed-in',
    email,
    signIn: () => undefined,
    async keep(linkId) {
      const outcome = await keepParcelLink(linkId, auth);
      if (outcome.outcome === 'kept' || outcome.outcome === 'already') void retryLoad();
      return outcome;
    },
    deliveries: loading ? undefined : parcels,
    openDeliveries: (parcelId) => {
      leaveParcelLink(parcelId ? `/?parcel=${encodeURIComponent(parcelId)}` : '/');
      // The deliveries open at their top, wherever on the page the way to them stood.
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
  }), [auth, email, parcels, loading, retryLoad]);
  return <PeekRoot session={session} serverLinkId={serverLinkId} />;
}

const NO_SIGN_IN = { configured: false, googleEnabled: false, emailOtpEnabled: false, sendCode: async () => undefined, verifyCode: async () => undefined };

/**
 * The same in a build without an API, where the demo stands in for an
 * account: an invitation, the demo deliveries, and the sign-in step that
 * leads to them. `DemoApplication` says which.
 */
export function DemoAccount({ repo, experience, invitation, demoAddress, leaveSignIn }: {
  repo: ParcelRepo;
  experience: ReturnType<typeof useEntryExperience>;
  invitation: PendingInvitationState;
  /** The page is at the demo's address. */
  demoAddress: boolean;
  /** The sign-in step's own navigation. */
  leaveSignIn: (next: EntryScreen) => void;
}) {
  // The demo's address shows the demo; an invitation waiting in this tab comes back after it.
  if (invitation.pending && !demoAddress) {
    return <FriendInvitation key={invitation.pending.code ?? 'invalid'} invitation={invitation}
      onDismiss={() => { invitation.clear(); experience.navigate('welcome'); }} {...NO_SIGN_IN} />;
  }
  if (experience.screen === 'demo') {
    return <ParcelsProvider repo={repo}>
      <KeepPendingInDemo repo={repo} />
      {/* Without accounts the landing is at `/`: its link leaves the demo for it. */}
      <App onExitDemo={() => experience.navigate('welcome')} onOpenLanding={() => experience.navigate('welcome')} />
      <BringAlongInDemo repo={repo} />
    </ParcelsProvider>;
  }
  return <ArrivalScreen screen="sign-in" onNavigate={leaveSignIn} {...NO_SIGN_IN} />;
}
