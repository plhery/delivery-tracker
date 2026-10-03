import { useCallback, useMemo, type ComponentProps } from 'react';
import App from './App';
import { useAuth } from './auth/AuthContext';
import { ArrivalScreen } from './components/ArrivalScreen';
import { ParcelIllustration } from './components/Icon';
import { useEntryHint } from './lib/entryHint';
import { useDemoAddress, useEntryExperience } from './lib/experience';
import { createDemoRepo } from './store/demoRepo';
import { deleteAccount, downloadAccountExport, exportAccount } from './lib/account';
import {
  disablePushNotifications,
  unsubscribePushNotificationsLocally,
} from './lib/pushNotifications';
import { browserStorage, clearApiCache, createApiRepo } from './store/apiRepo';
import { ParcelsProvider } from './store/ParcelsContext';
import { useI18n } from './i18n';
import { usePendingInvitation } from './lib/friendInvites';
import { createFriendsClient } from './lib/friends';
import { FriendInvitation } from './components/FriendInvitation';
import { useParcels } from './store/ParcelsContext';
import { FriendsActivityProvider } from './components/FriendsActivity';
import type { ApiAuth } from './lib/apiClient';
import { KeepPendingParcel } from './peek/KeepPending';
import { BringAlongParcels } from './peek/parcel/BringAlong';
import { PeekRoot } from './peek/PeekRoot';
import { keepParcelLink } from './peek/pending';
import { leaveParcelLink, useParcelLinkRoute } from './peek/route';
import type { PeekSession } from './peek/session';
import { useVisitorSession } from './peek/visitor';

export function ApiApplication({ invitationRoute = false, parcelLinkId = null, demoRoute = false, deliveryEmails = false }: {
  invitationRoute?: boolean;
  /** The link id of the parcel page the server rendered, at `/p/<id>`. */
  parcelLinkId?: string | null;
  /** The server rendered the demo's address, `/demo`. */
  demoRoute?: boolean;
  /** The server emails accounts when a parcel is delivered: the landing says so. */
  deliveryEmails?: boolean;
}) {
  const { t } = useI18n();
  const auth = useAuth();
  const experience = useEntryExperience(demoRoute);
  const demoAddress = useDemoAddress(demoRoute);
  const invitation = usePendingInvitation(invitationRoute);
  const linkId = useParcelLinkRoute(parcelLinkId);
  const visitor = useVisitorSession(auth.status === 'loading' ? 'checking' : 'visitor');
  // A browser that holds a sign-in says so before the first paint: it waits for its deliveries, not at the landing.
  const restoring = useEntryHint(auth.status !== 'loading') === 'app';
  // On a parcel page a visitor signs in without leaving it; the ways to do so come from here.
  const visitorSession = useMemo<PeekSession>(() => ({
    ...visitor,
    signInWith: {
      configured: auth.status !== 'unconfigured', googleEnabled: auth.googleEnabled, appleEnabled: auth.appleEnabled, emailOtpEnabled: auth.emailOtpEnabled,
      signInWithGoogle: auth.signInWithGoogle, signInWithApple: auth.signInWithApple, sendCode: auth.sendCode, verifyCode: auth.verifyCode,
    },
    deliveryEmails,
  }), [visitor, deliveryEmails, auth.status, auth.googleEnabled, auth.appleEnabled, auth.emailOtpEnabled, auth.signInWithGoogle, auth.signInWithApple, auth.sendCode, auth.verifyCode]);
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
  const invitationProps: ComponentProps<typeof FriendInvitation> = {
    invitation, onDismiss: () => { invitation.clear(); if (!auth.user) experience.navigate('welcome'); },
    configured: auth.status !== 'unconfigured', googleEnabled: auth.googleEnabled, appleEnabled: auth.appleEnabled, emailOtpEnabled: auth.emailOtpEnabled,
    signInWithGoogle: auth.signInWithGoogle, signInWithApple: auth.signInWithApple, sendCode: auth.sendCode, verifyCode: auth.verifyCode,
  };
  const demo = <ParcelsProvider key="demo" repo={demoRepo}>
    <App onExitDemo={() => experience.navigate('welcome')} />
  </ParcelsProvider>;
  // The demo's address shows the demo to anyone at once, signed in or not. Leaving the demo returns to `/`.
  if (demoAddress) return demo;
  // A parcel's address shows the parcel to anyone at once, while a saved sign-in is still being restored.
  // Without one, a visitor arrives at the front door: the server draws it for everyone, since it cannot see a saved
  // sign-in, and so does a browser that holds none while it makes sure.
  const landing = !linkId && !invitation.pending && experience.screen === 'welcome' && !(auth.status === 'loading' && restoring);
  if (auth.status !== 'authenticated' && (linkId || landing)) {
    return <>
      <PeekRoot session={visitorSession} serverLinkId={parcelLinkId} />
      {/* For the browser that does hold a sign-in: what it shows, in place of the landing, until the page is live. */}
      {landing && auth.status === 'loading' && <div className="auth-loading entry-splash" aria-hidden="true"><ParcelIllustration /><span>{t('auth.loading')}</span></div>}
    </>;
  }
  if (auth.status === 'loading') {
    return <div className="auth-loading" role="status"><ParcelIllustration /><span>{t('auth.loading')}</span></div>;
  }
  if (auth.status === 'unconfigured' || auth.status === 'anonymous') {
    if (invitation.pending) return <FriendInvitation key={invitation.pending.code ?? 'invalid'} {...invitationProps} />;
    if (experience.screen === 'demo') return demo;
    return (
      <ArrivalScreen
        screen="sign-in"
        onNavigate={visitor.leaveSignIn}
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
      {linkId ? <SignedInPeek auth={apiAuth!} serverLinkId={parcelLinkId} />
        : invitation.pending ? <AuthenticatedInvitation key={invitation.pending.code ?? 'invalid'} {...invitationProps} client={friendsClient} /> : <><App
        accountEmail={auth.user?.email ?? t('native.account')}
        onSignOut={handleSignOut}
        onExportAccount={handleExport}
        onDeleteAccount={handleDelete}
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

/** A parcel page opened by someone signed in: it can join their deliveries without leaving the page. */
function SignedInPeek({ auth, serverLinkId }: { auth: ApiAuth; serverLinkId: string | null }) {
  const { parcels, loading, retryLoad } = useParcels();
  const session = useMemo<PeekSession>(() => ({
    account: 'signed-in',
    signIn: () => undefined,
    async keep(linkId) {
      const outcome = await keepParcelLink(linkId, auth);
      if (outcome.outcome === 'kept' || outcome.outcome === 'already') void retryLoad();
      return outcome;
    },
    deliveries: loading ? undefined : parcels,
    openDeliveries: (parcelId) => leaveParcelLink(parcelId ? `/?parcel=${encodeURIComponent(parcelId)}` : '/'),
  }), [auth, parcels, loading, retryLoad]);
  return <PeekRoot session={session} serverLinkId={serverLinkId} />;
}
