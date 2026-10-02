'use client';

import { startAnalytics } from './lib/analytics';
import { useEffect, useMemo } from 'react';
import App from './App';
import { ApiApplication } from './ApiApplication';
import { AuthProvider } from './auth/AuthContext';
import { authConfigFromEnvironment } from './auth/authConfig';
import { I18nProvider, type Locale, type Messages } from './i18n';
import { isDemoBuild } from './lib/buildMode';
import { enableAppBadgeClearing } from './lib/pushNotifications';
import { checkForUpdatesOnResume, enablePwaLiveReload, registerPwaServiceWorker } from './lib/pwaUpdates';
import { createDemoRepo } from './store/demoRepo';
import { ParcelsProvider } from './store/ParcelsContext';
import { AppearanceProvider } from './lib/appearance';
import { useEntryExperience } from './lib/experience';
import { ArrivalScreen } from './components/ArrivalScreen';
import { FriendInvitation } from './components/FriendInvitation';
import { usePendingInvitation } from './lib/friendInvites';
import { KeepPendingInDemo } from './peek/KeepPending';
import { PeekRoot } from './peek/PeekRoot';
import { useParcelLinkRoute } from './peek/route';
import { useVisitorSession } from './peek/visitor';
import type { ParcelRepo } from './types';

export { shouldUseDemoRepository } from './lib/buildMode';

const authConfig = authConfigFromEnvironment({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  googleEnabled: process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED,
  appleEnabled: process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED,
  emailOtpEnabled: process.env.NEXT_PUBLIC_AUTH_EMAIL_OTP_ENABLED,
});

export function ClientApplication({ invitationRoute = false, parcelLinkId = null, initialLocale, initialMessages }: {
  invitationRoute?: boolean;
  /** The link id of the parcel page the server rendered, at `/p/<id>`. */
  parcelLinkId?: string | null;
  initialLocale?: Locale;
  initialMessages?: Messages;
}) {
  const demoRepo = useMemo(
    () => isDemoBuild ? createDemoRepo() : null,
    [],
  );

  useEffect(() => {
    void startAnalytics();
    const disableReload = enablePwaLiveReload();
    let disposed = false;
    let disableUpdateChecks = () => {};
    if (process.env.NODE_ENV === 'production') {
      void registerPwaServiceWorker().then((registration) => {
        if (registration && !disposed) disableUpdateChecks = checkForUpdatesOnResume(registration);
      }).catch(() => undefined);
    }
    const disableBadgeClearing = enableAppBadgeClearing();
    return () => {
      disposed = true;
      disableReload();
      disableUpdateChecks();
      disableBadgeClearing();
    };
  }, []);

  return (
    <I18nProvider initialLocale={initialLocale} initialMessages={initialMessages}>
      <AppearanceProvider>
      {demoRepo ? <DemoApplication repo={demoRepo} invitationRoute={invitationRoute} parcelLinkId={parcelLinkId} /> : (
        <AuthProvider config={authConfig}>
          <ApiApplication invitationRoute={invitationRoute} parcelLinkId={parcelLinkId} />
        </AuthProvider>
      )}
      </AppearanceProvider>
    </I18nProvider>
  );
}

/** A build without an API: everyone is a visitor, and the demo stands in for an account. */
export function DemoApplication({ repo, invitationRoute = false, parcelLinkId = null }: {
  repo: ParcelRepo;
  invitationRoute?: boolean;
  parcelLinkId?: string | null;
}) {
  const invitation = usePendingInvitation(invitationRoute);
  const experience = useEntryExperience();
  const linkId = useParcelLinkRoute(parcelLinkId);
  const session = useVisitorSession('visitor');
  const signIn = { configured: false, googleEnabled: false, emailOtpEnabled: false, sendCode: async () => undefined, verifyCode: async () => undefined };

  // A parcel's address shows the parcel, whatever this browser was doing before.
  if (linkId || (!invitation.pending && experience.screen === 'welcome')) {
    return <PeekRoot session={session} serverLinkId={parcelLinkId} />;
  }
  if (invitation.pending) {
    return <FriendInvitation key={invitation.pending.code ?? 'invalid'} invitation={invitation}
      onDismiss={() => { invitation.clear(); experience.navigate('welcome'); }} {...signIn} />;
  }
  if (experience.screen === 'demo') {
    return <ParcelsProvider repo={repo}>
      <KeepPendingInDemo repo={repo} />
      <App onExitDemo={() => experience.navigate('welcome')} />
    </ParcelsProvider>;
  }
  return <ArrivalScreen screen="sign-in" onNavigate={session.leaveSignIn} {...signIn} />;
}
