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
import { useDemoAddress, useEntryExperience } from './lib/experience';
import { MovedHost } from './lib/movedHost';
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

interface ApplicationProps {
  invitationRoute?: boolean;
  /** The link id of the parcel page the server rendered, at `/p/<id>`. */
  parcelLinkId?: string | null;
  /** The server rendered the demo's address, `/demo`. */
  demoRoute?: boolean;
  initialLocale?: Locale;
  initialMessages?: Messages;
}

export function ClientApplication({ movedTo, ...props }: ApplicationProps & {
  /** The origin the site moved to, when the server rendered the page on a host it has left. */
  movedTo?: string;
}) {
  // On a host the site has left, nothing of the app starts until it is known to stay there.
  return movedTo ? <MovedHost to={movedTo}><Application {...props} /></MovedHost> : <Application {...props} />;
}

function Application({ invitationRoute = false, parcelLinkId = null, demoRoute = false, initialLocale, initialMessages }: ApplicationProps) {
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
      {demoRepo ? <DemoApplication repo={demoRepo} invitationRoute={invitationRoute} parcelLinkId={parcelLinkId} demoRoute={demoRoute} /> : (
        <AuthProvider config={authConfig}>
          <ApiApplication invitationRoute={invitationRoute} parcelLinkId={parcelLinkId} demoRoute={demoRoute} />
        </AuthProvider>
      )}
      </AppearanceProvider>
    </I18nProvider>
  );
}

/** A build without an API: everyone is a visitor, and the demo stands in for an account. */
export function DemoApplication({ repo, invitationRoute = false, parcelLinkId = null, demoRoute = false }: {
  repo: ParcelRepo;
  invitationRoute?: boolean;
  parcelLinkId?: string | null;
  demoRoute?: boolean;
}) {
  const invitation = usePendingInvitation(invitationRoute);
  const experience = useEntryExperience(demoRoute);
  const demoAddress = useDemoAddress(demoRoute);
  const linkId = useParcelLinkRoute(parcelLinkId);
  const session = useVisitorSession('visitor');
  const signIn = { configured: false, googleEnabled: false, emailOtpEnabled: false, sendCode: async () => undefined, verifyCode: async () => undefined };

  // A parcel's address shows the parcel, whatever this browser was doing before.
  if (linkId || (!invitation.pending && experience.screen === 'welcome')) {
    return <PeekRoot session={session} serverLinkId={parcelLinkId} />;
  }
  // The demo's address shows the demo; an invitation waiting in this tab comes back after it.
  if (invitation.pending && !demoAddress) {
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
