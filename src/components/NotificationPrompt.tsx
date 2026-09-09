import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useI18n } from '../i18n';
import type { ApiAuth } from '../lib/apiClient';
import { trackAction } from '../lib/analytics';
import {
  dismissNotificationInvitation,
  notificationInvitationDismissed,
  subscribeToNotificationInvitation,
} from '../lib/notificationInvitation';
import { enablePushNotifications, inspectPushState, type PushState } from '../lib/pushNotifications';
import { Icon } from './Icon';
import './NotificationPrompt.css';

/** A nonmodal invitation: no automatic permission request or focus change. */
export function NotificationPrompt({ apiAuth, eligible }: { apiAuth: ApiAuth; eligible: boolean }) {
  const { t, locale } = useI18n();
  const dismissed = useSyncExternalStore(
    subscribeToNotificationInvitation,
    () => notificationInvitationDismissed(apiAuth.userId),
    () => true,
  );
  const [closed, setClosed] = useState(false);
  const [state, setState] = useState<PushState | null>(null);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const revision = useRef(0);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!eligible || dismissed || closed) return;
    let cancelled = false;
    const inspect = () => {
      if (document.visibilityState === 'hidden' || inFlight.current) return;
      const current = ++revision.current;
      void inspectPushState(apiAuth).then((next) => {
        if (!cancelled && revision.current === current) setState(next);
      }).catch(() => {
        if (!cancelled && revision.current === current) setState(null);
      });
    };
    inspect();
    window.addEventListener('focus', inspect);
    document.addEventListener('visibilitychange', inspect);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', inspect);
      document.removeEventListener('visibilitychange', inspect);
    };
  }, [apiAuth, eligible, dismissed, closed]);

  function dismiss() {
    // Return focus only when it would otherwise be stranded in the removed popup.
    if (panel.current?.contains(document.activeElement)) {
      document.querySelector<HTMLButtonElement>('.account-trigger')?.focus({ preventScroll: true });
    }
    dismissNotificationInvitation(apiAuth.userId);
    setClosed(true);
  }

  async function enable() {
    if (state?.kind !== 'prompt' || inFlight.current) return;
    inFlight.current = true;
    ++revision.current;
    setBusy(true);
    setFailed(false);
    try {
      // Keep this call directly in the click handler for browser user activation.
      await enablePushNotifications(state.publicKey, apiAuth, locale);
      trackAction('notifications-enable', 'success');
      if (alive.current) dismiss();
    } catch {
      trackAction('notifications-enable', 'error');
      if (!alive.current) return;
      if (Notification.permission !== 'granted') dismiss();
      else setFailed(true);
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  if (!eligible || dismissed || closed || (state?.kind !== 'prompt' && state?.kind !== 'install')) return null;
  const install = state.kind === 'install';

  return (
    <section
      ref={panel}
      className="notification-prompt"
      aria-labelledby="notification-prompt-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) { event.stopPropagation(); dismiss(); }
      }}
    >
      <button className="notification-prompt__close" type="button" aria-label={t('common.close')} disabled={busy} onClick={dismiss}>
        <Icon name="close" />
      </button>
      <h2 id="notification-prompt-title">{t(help ? 'notifications.prompt.installTitle' : 'notifications.prompt.title')}</h2>
      {help ? (
        <ol>
          <li>{t('notifications.prompt.installShare')}</li>
          <li>{t('notifications.prompt.installAdd')}</li>
          <li>{t('notifications.prompt.installOpen')}</li>
        </ol>
      ) : <p>{t(install ? 'notifications.prompt.installDescription' : 'notifications.prompt.description')}</p>}
      {failed && <p className="notification-prompt__error" role="alert">{t('notifications.error.enable')}</p>}
      <div className="notification-prompt__actions">
        <button className="button button--primary" type="button" disabled={busy} aria-busy={busy} onClick={help ? dismiss : install ? () => setHelp(true) : () => void enable()}>
          {t(help ? 'notifications.prompt.gotIt' : install ? 'notifications.prompt.showHow' : busy ? 'notifications.enabling' : failed ? 'common.retry' : 'notifications.enable')}
        </button>
        {!help && <button className="notification-prompt__later" type="button" disabled={busy} onClick={dismiss}>{t('onboarding.notifications.notNow')}</button>}
      </div>
    </section>
  );
}
