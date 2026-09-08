import { useCallback, useMemo, type ComponentProps } from 'react';
import App from './App';
import { useAuth } from './auth/AuthContext';
import { ArrivalScreen } from './components/ArrivalScreen';
import { ParcelIllustration } from './components/Icon';
import { useEntryExperience } from './lib/experience';
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

export function ApiApplication({ invitationRoute = false }: { invitationRoute?: boolean }) {
  const { t } = useI18n();
  const auth = useAuth();
  const experience = useEntryExperience();
  const invitation = usePendingInvitation(invitationRoute);
  const demoRepo = useMemo(() => createDemoRepo(), []);
  const signOut = auth.signOut;
  const navigate = experience.navigate;
  const storage = browserStorage();
  const sessionAuth = useMemo(
    () => auth.user ? {
      userId: auth.user.id,
      getAccessToken: auth.getAccessToken,
      signal: auth.signal,
    } : undefined,
    [auth.user, auth.getAccessToken, auth.signal],
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
    configured: auth.status !== 'unconfigured', googleEnabled: auth.googleEnabled, emailOtpEnabled: auth.emailOtpEnabled,
    signInWithGoogle: auth.signInWithGoogle, sendCode: auth.sendCode, verifyCode: auth.verifyCode,
  };
  if (auth.status === 'loading') {
    return <div className="auth-loading" role="status"><ParcelIllustration /><span>{t('auth.loading')}</span></div>;
  }
  if (auth.status === 'unconfigured' || auth.status === 'anonymous') {
    if (invitation.pending) return <FriendInvitation key={invitation.pending.code ?? 'invalid'} {...invitationProps} />;
    if (experience.screen === 'demo') return <ParcelsProvider key="demo" repo={demoRepo}>
      <App onExitDemo={() => experience.navigate('welcome')} />
    </ParcelsProvider>;
    return (
      <ArrivalScreen
        screen={experience.screen}
        onNavigate={experience.navigate}
        configured={auth.status !== 'unconfigured'}
        googleEnabled={auth.googleEnabled}
        emailOtpEnabled={auth.emailOtpEnabled}
        signInWithGoogle={auth.signInWithGoogle}
        sendCode={auth.sendCode}
        verifyCode={auth.verifyCode}
      />
    );
  }
  if (!repo) return null;
  return (
    <ParcelsProvider key={auth.user?.id} repo={repo}>
      {invitation.pending ? <AuthenticatedInvitation key={invitation.pending.code ?? 'invalid'} {...invitationProps} client={friendsClient} /> : <App
        accountEmail={auth.user?.email ?? t('native.account')}
        onSignOut={handleSignOut}
        onExportAccount={handleExport}
        onDeleteAccount={handleDelete}
        apiAuth={apiAuth}
      />}
    </ParcelsProvider>
  );
}

function AuthenticatedInvitation(props: ComponentProps<typeof FriendInvitation>) {
  const { parcels } = useParcels();
  return <FriendInvitation {...props} parcels={parcels} />;
}
