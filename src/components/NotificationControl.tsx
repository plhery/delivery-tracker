import { trackAction, trackOverlay } from '../lib/analytics';
import { userErrorMessage } from '../lib/userMessages';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ALL_NOTIFICATION_STAGES,
  DELIVERY_DAY_NOTIFICATION_STAGES,
  disablePushNotifications,
  enablePushNotifications,
  IMPORTANT_NOTIFICATION_STAGES,
  inspectPushState,
  type NotificationStage,
  type PushState,
} from '../lib/pushNotifications';
import type { ApiAuth } from '../lib/apiClient';
import { useSheetDialog } from '../lib/modal';
import { dismissNotificationInvitation } from '../lib/notificationInvitation';
import {
  loadNotificationPreferences,
  saveEmailOnDelivery,
  saveNotificationStages,
  useDeliveryEmail,
  useNotificationPreferences,
} from '../store/notificationPreferences';
import { type MessageKey, type Translate, useI18n } from '../i18n';
import { Icon } from './Icon';
import './Settings.css';

type EventPreset = 'all' | 'important' | 'delivery-day';

const PRESET_STAGES: Record<EventPreset, NotificationStage[]> = {
  all: ALL_NOTIFICATION_STAGES,
  important: IMPORTANT_NOTIFICATION_STAGES,
  'delivery-day': DELIVERY_DAY_NOTIFICATION_STAGES,
};

export function NotificationControl({ apiAuth, email, variant = 'icon' }: {
  apiAuth?: ApiAuth;
  /** The address the account signs in with: the delivery email goes there. */
  email?: string;
  variant?: 'icon' | 'row';
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) return trackOverlay('notifications'); }, [open]);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The saved preferences are the account's shared copy; the radios hold a draft until it is saved.
  const preferences = useNotificationPreferences(apiAuth);
  const [draft, setDraft] = useState<EventPreset | null>(null);
  const preset = draft ?? (preferences ? presetFor(preferences.enabledStages) : 'all');
  const [preferencesBusy, setPreferencesBusy] = useState(false);
  const [preferencesNotice, setPreferencesNotice] = useState<string | null>(null);
  const deliveryEmail = useDeliveryEmail(apiAuth, email);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailFailed, setEmailFailed] = useState(false);
  const enabled = state?.kind === 'enabled';
  const closeButton = useRef<HTMLButtonElement>(null);
  const [dialog, close] = useSheetDialog<HTMLElement>(open, () => setOpen(false), closeButton);

  useEffect(() => {
    void inspectPushState(apiAuth).then(setState).catch((reason: unknown) => {
      setError(userErrorMessage(reason, t, 'notifications.error.unavailable'));
    });
  }, [apiAuth, t]);

  useEffect(() => {
    if (!apiAuth) return;
    void loadNotificationPreferences(apiAuth).catch((reason: unknown) => {
      setError(userErrorMessage(reason, t, 'notifications.error.preferences'));
    });
  }, [apiAuth, t]);

  async function enable() {
    if (!state || state.kind !== 'prompt') return;
    setBusy(true);
    setError(null);
    try {
      const testSent = await enablePushNotifications(state.publicKey, apiAuth, locale);
      if (apiAuth) dismissNotificationInvitation(apiAuth.userId);
      trackAction('notifications-enable', 'success');
      setState({ kind: 'enabled', publicKey: state.publicKey });
      if (!testSent) setError(t('notifications.error.welcome'));
    } catch (reason) {
      trackAction('notifications-enable', 'error');
      setError(userErrorMessage(reason, t, 'notifications.error.enable'));
      setState(await inspectPushState(apiAuth));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (apiAuth) dismissNotificationInvitation(apiAuth.userId);
    setBusy(true);
    setError(null);
    try {
      await disablePushNotifications(apiAuth);
      trackAction('notifications-disable', 'success');
      const next = await inspectPushState(apiAuth);
      setState(next.kind === 'enabled' ? { kind: 'prompt', publicKey: next.publicKey } : next);
    } catch (reason) {
      setError(userErrorMessage(reason, t, 'notifications.error.disable'));
    } finally {
      setBusy(false);
    }
  }

  async function savePreferences() {
    if (!apiAuth || preferencesBusy || emailBusy) return;
    setPreferencesBusy(true);
    setPreferencesNotice(null);
    setError(null);
    try {
      await saveNotificationStages(PRESET_STAGES[preset], apiAuth);
      // The radios follow what the server kept.
      setDraft(null);
      setPreferencesNotice(t('notifications.saved'));
    } catch (reason) {
      setError(userErrorMessage(reason, t, 'notifications.error.save'));
    } finally {
      setPreferencesBusy(false);
    }
  }

  // The email switch saves at once and on its own: the radios' draft is not sent along.
  async function switchEmail() {
    if (!apiAuth || !deliveryEmail || emailBusy || preferencesBusy) return;
    setEmailBusy(true);
    setEmailFailed(false);
    try {
      await saveEmailOnDelivery(deliveryEmail.choice !== true, apiAuth);
      trackAction('email-delivery-change', 'success');
    } catch {
      trackAction('email-delivery-change', 'error');
      setEmailFailed(true);
    } finally {
      setEmailBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`${variant === 'row' ? 'settings-row' : 'icon-button'} notification-button${enabled ? ' notification-button--enabled' : ''}`}
        aria-label={enabled ? t('notifications.enabledButton') : t('notifications.button')}
        onClick={() => setOpen(true)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {variant === 'row' && <><span>{t('settings.deliveryUpdates')}</span><span className="settings-value">{enabled && preferences ? t(presetTitleKey(preferences.enabledStages)) : state?.kind === 'prompt' ? t('settings.off') : ''}</span><span className="settings-chevron" aria-hidden="true">›</span></>}
      </button>

      {open && createPortal(
        <div className="sheet-backdrop" role="presentation" onMouseDown={close}>
          <section
            ref={dialog}
            className="sheet notification-sheet refined-settings"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notifications-title"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="sheet__grabber" />
            <div className="sheet__heading">
              <div>
                <h2 className="sheet__title" id="notifications-title">{t('settings.deliveryUpdates')}</h2>
              </div>
              <button ref={closeButton} className="sheet__close" type="button" aria-label={t('common.close')} onClick={close}>×</button>
            </div>

            <div className={`notification-status${enabled ? ' notification-status--enabled' : ''}`}>
              <span className="notification-status__mark" aria-hidden="true" />
              <div>
                <strong>{enabled ? t('notifications.enabledTitle') : t('notifications.disabledTitle')}</strong>
                <p>{copyFor(state, Boolean(error), t)}</p>
              </div>
            </div>

            {(state?.kind === 'prompt' || enabled) && <div className="settings-box settings-device-control"><button className="settings-row" type="button" role="switch" aria-checked={enabled} aria-label={t('settings.deliveryUpdates')} disabled={busy} onClick={() => void (enabled ? disable() : enable())}><span>{t('settings.deliveryUpdates')}</span><span className="settings-switch" aria-hidden="true" /></button></div>}
            {error && <p className="sheet__error" role="alert">{error}</p>}

            {apiAuth && preferences && (
              <div className="notification-preferences">
                <fieldset disabled={preferencesBusy || emailBusy}>
                  <legend>{t('notifications.preferencesTitle')}</legend>
                  <PreferenceOption
                    value="all"
                    selected={preset}
                    onChange={setDraft}
                    title={t('notifications.preset.all')}
                    description={t('notifications.preset.allDescription')}
                  />
                  <PreferenceOption
                    value="important"
                    selected={preset}
                    onChange={setDraft}
                    title={t('notifications.preset.important')}
                    description={t('notifications.preset.importantDescription')}
                  />
                  <PreferenceOption
                    value="delivery-day"
                    selected={preset}
                    onChange={setDraft}
                    title={t('notifications.preset.deliveryDay')}
                    description={t('notifications.preset.deliveryDayDescription')}
                  />
                </fieldset>

                {preferencesNotice && (
                  <p className="notification-preferences__saved" role="status">
                    {preferencesNotice}
                  </p>
                )}
                <button
                  className="button button--primary notification-action"
                  type="button"
                  disabled={preferencesBusy || emailBusy}
                  onClick={() => void savePreferences()}
                >
                  {preferencesBusy ? t('notifications.saving') : t('notifications.save')}
                </button>
              </div>
            )}

            {deliveryEmail && (
              <section className="notification-email" aria-labelledby="notification-email-title">
                <div className="settings-box">
                  <h3 className="notification-email__title" id="notification-email-title">
                    {t('email.section')}{' '}<span className="settings-new">{t('email.new')}</span>
                  </h3>
                  <button
                    className="settings-row notification-email__switch"
                    type="button"
                    role="switch"
                    aria-checked={deliveryEmail.choice === true}
                    aria-labelledby="notification-email-label"
                    aria-describedby="notification-email-hint"
                    aria-busy={emailBusy || undefined}
                    disabled={emailBusy || preferencesBusy}
                    onClick={() => void switchEmail()}
                  >
                    <Icon name="mail" />
                    <span className="notification-email__text">
                      <strong id="notification-email-label">{t('email.setting.title')}</strong>
                      <small id="notification-email-hint">{t('email.setting.body', { email: deliveryEmail.address })}</small>
                    </span>
                    <span className="settings-switch" aria-hidden="true" />
                  </button>
                </div>
                {emailFailed && <p className="sheet__error" role="alert">{t('email.setting.failed')}</p>}
                <p className="notification-email__links">
                  <a href={`/email/example?lang=${locale}`} target="_blank" rel="noopener" onClick={() => trackAction('email-example-open')}>{t('email.setting.example')}</a>
                  <a href="/privacy.html" onClick={() => trackAction('privacy-open')}>{t('auth.privacyLink')}</a>
                </p>
              </section>
            )}

            <p className="notification-schedule">{t('notifications.schedule')}</p>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}

function sameStages(left: readonly NotificationStage[], right: readonly NotificationStage[]) {
  return left.length === right.length && left.every((stage) => right.includes(stage));
}

function presetFor(stages: readonly NotificationStage[]): EventPreset {
  if (sameStages(stages, DELIVERY_DAY_NOTIFICATION_STAGES)) return 'delivery-day';
  if (sameStages(stages, IMPORTANT_NOTIFICATION_STAGES)) return 'important';
  return 'all';
}

function PreferenceOption({
  value,
  selected,
  onChange,
  title,
  description,
}: {
  value: EventPreset;
  selected: EventPreset;
  onChange: (value: EventPreset) => void;
  title: string;
  description: string;
}) {
  return (
    <label className="notification-preferences__option">
      <input
        type="radio"
        name="notification-preset"
        value={value}
        checked={selected === value}
        onChange={() => onChange(value)}
      />
      <span><strong>{title}</strong><small>{description}</small></span>
    </label>
  );
}

function copyFor(state: PushState | null, hasError: boolean, t: Translate): string {
  if (hasError) return t('notifications.state.retry');
  switch (state?.kind) {
    case 'enabled': return t('notifications.state.enabled');
    case 'install':
    case 'unsupported': return t('notifications.state.unsupported');
    case 'unavailable': return t('notifications.state.unavailable');
    case 'blocked': return t('notifications.state.blockedBrowser');
    case 'prompt': return t('notifications.state.prompt');
    default: return t('notifications.state.checking');
  }
}

const PRESET_TITLES: Record<EventPreset, MessageKey> = {
  all: 'notifications.preset.all',
  important: 'notifications.preset.important',
  'delivery-day': 'notifications.preset.deliveryDay',
};

/** What Settings calls the preset a list of events stands for. */
export function presetTitleKey(stages: readonly NotificationStage[]): MessageKey {
  return PRESET_TITLES[presetFor(stages)];
}
