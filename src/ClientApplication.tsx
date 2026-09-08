'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import App from './App';
import { ApiApplication } from './ApiApplication';
import { AuthProvider } from './auth/AuthContext';
import { authConfigFromEnvironment } from './auth/authConfig';
import { I18nProvider } from './i18n';
import { enableAppBadgeClearing } from './lib/pushNotifications';
import { enablePwaLiveReload, registerPwaServiceWorker } from './lib/pwaUpdates';
import { createDemoRepo } from './store/demoRepo';
import { ParcelsProvider } from './store/ParcelsContext';
import { AppearanceProvider } from './lib/appearance';
import { useEntryExperience } from './lib/experience';
import { ArrivalScreen } from './components/ArrivalScreen';
import { FriendInvitation } from './components/FriendInvitation';
import { usePendingInvitation } from './lib/friendInvites';

export function shouldUseDemoRepository(
  nodeEnvironment: string | undefined,
  apiSetting: string | undefined,
): boolean {
  const normalizedSetting = apiSetting?.trim().toLowerCase();
  if (normalizedSetting === 'true') return false;
  if (normalizedSetting === 'false') return true;
  return nodeEnvironment === 'development';
}

const useDemo = shouldUseDemoRepository(
  process.env.NODE_ENV,
  process.env.NEXT_PUBLIC_USE_API,
);

const authConfig = authConfigFromEnvironment({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  googleEnabled: process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED,
  emailOtpEnabled: process.env.NEXT_PUBLIC_AUTH_EMAIL_OTP_ENABLED,
});

export function ClientApplication({ invitationRoute = false }: { invitationRoute?: boolean }) {
  const demoRepo = useMemo(
    () => useDemo ? createDemoRepo() : null,
    [],
  );
  const experience = useEntryExperience();

  useEffect(() => {
    const disableReload = enablePwaLiveReload();
    if (process.env.NODE_ENV === 'production') {
      void registerPwaServiceWorker().catch(() => undefined);
    }
    const disableBadgeClearing = enableAppBadgeClearing();
    return () => {
      disableReload();
      disableBadgeClearing();
    };
  }, []);

  return (
    <I18nProvider>
      <AppearanceProvider>
      {demoRepo ? <DemoInvitation invitationRoute={invitationRoute}>
        {(
        experience.screen === 'demo' ? (
          <ParcelsProvider repo={demoRepo}>
            <App onExitDemo={() => experience.navigate('welcome')} />
          </ParcelsProvider>
        ) : <ArrivalScreen screen={experience.screen} onNavigate={experience.navigate}
          configured={false} googleEnabled={false} emailOtpEnabled={false}
          sendCode={async () => undefined} verifyCode={async () => undefined} />
      )}</DemoInvitation> : (
        <AuthProvider config={authConfig}>
          <ApiApplication invitationRoute={invitationRoute} />
        </AuthProvider>
      )}
      </AppearanceProvider>
    </I18nProvider>
  );
}

function DemoInvitation({ children, invitationRoute }: { children: ReactNode; invitationRoute: boolean }) {
  const invitation = usePendingInvitation(invitationRoute);
  const experience = useEntryExperience();
  return invitation.pending ? <FriendInvitation key={invitation.pending.code ?? 'invalid'} invitation={invitation}
    onDismiss={() => { invitation.clear(); experience.navigate('welcome'); }}
    configured={false} googleEnabled={false} emailOtpEnabled={false}
    sendCode={async () => undefined} verifyCode={async () => undefined} /> : children;
}
