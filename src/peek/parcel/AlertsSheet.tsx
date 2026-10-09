import { useEffect, useState } from 'react';
import { HomeScreenSteps } from '../../components/HomeScreenSteps';
import { Icon } from '../../components/Icon';
import { useI18n, type MessageKey } from '../../i18n';
import { trackAction } from '../../lib/analytics';
import { AlertError, alertSupport, deviceAlert, turnOffAlert, turnOnAlert, type AlertSupport } from '../alerts';
import { useLinkNote } from '../deviceNotes';
import { PARCEL_ALERT_PRESETS, ParcelLinkError, parcelLinkErrorKey, type ParcelAlertPreset, type ParcelAlerts } from '../links';
import { Glyph } from './glyphs';
import { Sheet } from './Sheet';

const PRESET_LABELS: Record<ParcelAlertPreset, MessageKey> = {
  all: 'alerts.preset.all',
  important: 'alerts.preset.important',
  delivery: 'alerts.preset.delivery',
};

/** Why notifications cannot be turned on here, in the reader's words. */
const SUPPORT_GUIDANCE: Partial<Record<AlertSupport, MessageKey>> = {
  blocked: 'alerts.blocked',
  unsupported: 'alerts.unsupported',
  unavailable: 'notifications.state.unavailable',
};

function failureKey(error: unknown): MessageKey {
  if (error instanceof AlertError) {
    return error.kind === 'blocked' ? 'alerts.blocked' : error.kind === 'dismissed' ? 'alerts.dismissed'
      : error.kind === 'unsupported' ? 'alerts.unsupported' : 'notifications.error.enable';
  }
  if (error instanceof ParcelLinkError && ['full', 'unconfigured', 'stopped', 'unavailable', 'burst', 'offline'].includes(error.kind)) return parcelLinkErrorKey(error);
  return 'notifications.error.enable';
}

function Presets({ value, disabled, onChange }: { value: ParcelAlertPreset; disabled: boolean; onChange: (preset: ParcelAlertPreset) => void }) {
  const { t } = useI18n();
  return <>
    <p className="peeks__label" id="peeks-presets">{t('alerts.presets')}</p>
    <div className="peeks-presets" role="group" aria-labelledby="peeks-presets">
      {PARCEL_ALERT_PRESETS.map((preset) => <button key={preset} type="button" aria-pressed={value === preset} disabled={disabled}
        onClick={() => { if (value !== preset) onChange(preset); }}>{t(PRESET_LABELS[preset])}</button>)}
    </div>
  </>;
}

/**
 * "Notify me": this browser's notifications for the parcel, or the delivery
 * window as a calendar file. The browser is asked for nothing until someone
 * chooses "Turn on". An iPhone outside a Home Screen app gets the steps to
 * put Peek there, instead of a button that cannot work, after the email that
 * signing in brings, which needs no Home Screen.
 */
export function AlertsSheet({ linkId, ownerKey, alerts, initialPreset, calendar, onCalendar, onSignIn, onClose }: {
  linkId: string;
  /** The owner key, when this device holds it. */
  ownerKey: string | null;
  alerts: ParcelAlerts | undefined;
  /** What a first alert announces unless the reader chooses otherwise. */
  initialPreset: ParcelAlertPreset;
  /** The delivery window in words, when the parcel has an estimate. */
  calendar: string | null;
  /** Hands the calendar file to the browser, and says whether it could. */
  onCalendar: () => boolean;
  /** Offered to a visitor: an account alerts every device they sign in on. `email` when the email was what they asked for. */
  onSignIn?: (email: boolean) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const noted = useLinkNote(linkId).alert;
  const [support, setSupport] = useState<AlertSupport>(() => alertSupport(alerts));
  // What the browser itself says about the noted alert; until it answers, the note is believed.
  const [checked, setChecked] = useState(false);
  const [choice, setChoice] = useState<'browser' | 'calendar'>(() => alertSupport(alerts) === 'ready' || !calendar ? 'browser' : 'calendar');
  const [preset, setPreset] = useState<ParcelAlertPreset>(noted?.preset ?? initialPreset);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [said, setSaid] = useState<MessageKey | null>(null);
  const on = noted ?? null;
  const demo = !!alerts?.available && !alerts.vapidPublicKey;

  useEffect(() => {
    let disposed = false;
    void deviceAlert(linkId).finally(() => { if (!disposed) setChecked(true); });
    return () => { disposed = true; };
  }, [linkId]);

  async function turnOn(next: ParcelAlertPreset, changing: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaid(null);
    try {
      await turnOnAlert({ linkId, key: ownerKey, alerts, preset: next, locale });
      setPreset(next);
      if (changing) setSaid('notifications.saved');
      else trackAction('parcel-link-alerts', 'success');
    } catch (reason) {
      if (!changing) trackAction('parcel-link-alerts', 'error');
      setError(failureKey(reason));
      setSupport(alertSupport(alerts));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaid(null);
    try {
      await turnOffAlert(linkId);
      trackAction('parcel-link-alerts-off', 'success');
    } catch {
      trackAction('parcel-link-alerts-off', 'error');
      setError('notifications.error.disable');
    } finally {
      setBusy(false);
    }
  }

  function addToCalendar() {
    const done = onCalendar();
    trackAction('parcel-link-calendar', done ? 'success' : 'error');
    setError(done ? null : 'alerts.calendar.failed');
    setSaid(done ? 'alerts.calendar.done' : null);
  }

  // Where the server emails accounts, that is what signing in adds to a browser's alerts.
  const emails = alerts?.email === true;
  const account = (dismiss: () => void) => onSignIn && <div className="peeks-account">
    <span aria-hidden="true"><Icon name={emails ? 'mail' : 'account'} /></span>
    <span><strong>{t(emails ? 'alerts.email.title' : 'alerts.account.title')}</strong><small>{t(emails ? 'alerts.email.body' : 'alerts.account.body')}</small></span>
    <button type="button" onClick={() => { dismiss(); onSignIn(emails); }}>{t('arrival.signInTitle')}</button>
  </div>;
  const feedback = <>
    {error && <p className="sheet__error" role="alert">{t(error)}</p>}
    <p className="peeks__said" role="status" data-empty={!said || undefined}>{said && <><Icon name="check" />{t(said)}</>}</p>
  </>;

  if (support === 'install') {
    // The email needs no Home Screen: where signing in brings it, it is offered before the steps.
    const emailFirst = emails && !!onSignIn;
    const signIn = !emailFirst && onSignIn;
    return <Sheet title={t('alerts.iphone.title')} intro={emailFirst ? undefined : t('alerts.iphone.body')} className="peeks-alerts" onClose={onClose}>{(dismiss) => <>
      {emailFirst && <>{account(dismiss)}<p className="peeks__intro">{t('alerts.iphone.body')}</p></>}
      <HomeScreenSteps then="ping" cards />
      {feedback}
      {(calendar || signIn) && <div className="peeks__actions">
        {calendar && <button type="button" className="button button--secondary" onClick={addToCalendar}><Glyph name="calendar" /><span>{t('alerts.calendar.or')}</span></button>}
        {signIn && <button type="button" className="button button--secondary" onClick={() => { dismiss(); signIn(false); }}><Icon name="account" /><span>{t('alerts.iphone.signIn')}</span></button>}
      </div>}
    </>}</Sheet>;
  }

  if (on) {
    return <Sheet title={t('alerts.title')} className="peeks-alerts" onClose={onClose}>{(dismiss) => <>
      <div className="peeks-on" aria-busy={!checked || undefined}>
        <span aria-hidden="true"><Icon name="bell" /></span>
        <span><strong>{t('alerts.on.title')}</strong><small>{t(demo ? 'alerts.demo' : 'alerts.on.body')}</small></span>
      </div>
      <Presets value={on.preset} disabled={busy} onChange={(next) => void turnOn(next, true)} />
      {feedback}
      <div className="peeks__actions">
        {calendar && <button type="button" className="button button--secondary" onClick={addToCalendar}><Glyph name="calendar" /><span>{t('alerts.calendar.action')}</span></button>}
        <button type="button" className="peeks__quiet" disabled={busy} onClick={() => void turnOff()}>{t('alerts.turnOff')}</button>
      </div>
      {account(dismiss)}
    </>}</Sheet>;
  }

  const ready = support === 'ready';
  const guidance = SUPPORT_GUIDANCE[support];
  const chosen = choice === 'calendar' && calendar ? 'calendar' : ready ? 'browser' : calendar ? 'calendar' : null;
  return <Sheet title={t('alerts.title')} className="peeks-alerts" onClose={onClose}>{(dismiss) => <>
    <div className="peeks-options" role="radiogroup" aria-label={t('alerts.title')}>
      <label className="peeks-option" data-selected={chosen === 'browser' || undefined} data-disabled={!ready || undefined}>
        <input type="radio" name="peeks-alert" checked={chosen === 'browser'} disabled={!ready} onChange={() => setChoice('browser')} />
        <span aria-hidden="true"><Icon name="bell" /></span>
        <span><strong>{t('alerts.browser.title')}</strong><small>{guidance ? t(guidance) : t('alerts.browser.body')}</small></span>
      </label>
      {calendar && <label className="peeks-option" data-selected={chosen === 'calendar' || undefined}>
        <input type="radio" name="peeks-alert" checked={chosen === 'calendar'} onChange={() => setChoice('calendar')} />
        <span aria-hidden="true"><Glyph name="calendar" /></span>
        <span><strong>{t('alerts.calendar.title')}</strong><small>{t('alerts.calendar.body', { window: calendar })}</small></span>
      </label>}
    </div>
    {account(dismiss)}
    {chosen === 'browser' && <Presets value={preset} disabled={busy} onChange={setPreset} />}
    {demo && chosen === 'browser' && <p className="peeks__promise">{t('alerts.demo')}</p>}
    {feedback}
    {chosen && <div className="peeks__actions">
      {chosen === 'browser'
        ? <button type="button" className="button button--primary" disabled={busy} aria-busy={busy} onClick={() => void turnOn(preset, false)}>{t(busy ? 'notifications.enabling' : 'alerts.turnOn')}</button>
        : <button type="button" className="button button--primary" onClick={addToCalendar}>{t('alerts.calendar.action')}</button>}
    </div>}
  </>}</Sheet>;
}
