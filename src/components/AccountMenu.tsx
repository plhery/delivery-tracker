import { trackAction, trackOverlay, analyticsEnabled, setAnalyticsEnabled } from '../lib/analytics';
import { userErrorMessage } from '../lib/userMessages';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LanguageControl, useI18n } from '../i18n';
import { useAppearance, type Appearance } from '../lib/appearance';
import { useSheetDialog } from '../lib/modal';
import type { ApiAuth } from '../lib/apiClient';
import { Icon } from './Icon';
import { NotificationControl } from './NotificationControl';

type AccountAction = 'export' | 'delete' | 'sign-out' | 'reset-demo';

export function AccountMenu({ email, onExport, onDelete, onSignOut, onExitDemo, onResetDemo, apiAuth }: {
  email?: string;
  onExport?: () => Promise<void>;
  onDelete?: (confirmation: string) => Promise<void>;
  onSignOut?: () => Promise<void>;
  onExitDemo?: () => void;
  onResetDemo?: () => Promise<void>;
  apiAuth?: ApiAuth;
}) {
  const { t } = useI18n();
  const [usageAnalytics, setUsageAnalytics] = useState(analyticsEnabled);
  const [appearance, setAppearance] = useAppearance();
  const initial = email?.trim().charAt(0).toUpperCase();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) return trackOverlay('account'); }, [open]);
  const [working, setWorking] = useState<AccountAction | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [dialog, close] = useSheetDialog<HTMLDivElement>(open, () => { setOpen(false); setConfirmingReset(false); }, closeButton);

  async function run(action: AccountAction, operation: () => Promise<void>) {
    if (working) return;
    setWorking(action);
    setError(null);
    try { await operation(); if (action === 'export' || action === 'reset-demo') setWorking(null); }
    catch (reason) { setError(userErrorMessage(reason, t, 'account.actionFailed')); setWorking(null); }
  }

  return <>
    <button type="button" className="account-trigger" aria-label={email ? t('account.options', { email }) : t('native.account')}
      aria-haspopup="dialog" onClick={() => setOpen(true)}>{initial || <Icon name="account" />}</button>
    {open && createPortal(<div className="sheet-backdrop" onClick={close}>
      <div ref={dialog} className="sheet settings-sheet account-menu" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="sheet__grabber" aria-hidden="true" />
        <div className="sheet__heading"><h2 className="sheet__title" id="settings-title">{t('native.account')}</h2>
          <button ref={closeButton} className="sheet__close" type="button" onClick={close} aria-label={t('common.close')}><Icon name="close" /></button></div>
        <div className="settings-profile"><span className="settings-profile__avatar">{initial || <Icon name="account" />}</span>
          <div>{email && <span>{t('account.signedIn')}</span>}<strong>{email || t('app.demo')}</strong></div></div>
        {onExitDemo && <button type="button" className="settings-row settings-row--exit" onClick={onExitDemo}><Icon name="exit" />{t('native.exitDemo')}<Icon name="arrow" /></button>}
        {onResetDemo && (confirmingReset ? <div className="settings-reset">
          <h3>{t('native.resetDemoQuestion')}</h3><p>{t('native.resetDemoDescription')}</p>
          <div className="sheet__actions">
            <button className="button button--secondary" type="button" autoFocus disabled={Boolean(working)} onClick={() => { setConfirmingReset(false); setError(null); }}>{t('common.cancel')}</button>
            <button className="button button--primary" type="button" disabled={Boolean(working)} aria-busy={working === 'reset-demo'} onClick={() => void run('reset-demo', async () => { await onResetDemo(); close(); })}>{t('native.resetDemo')}</button>
          </div>
        </div> : <button type="button" className="settings-row settings-row--reset" disabled={Boolean(working)} onClick={() => setConfirmingReset(true)}><Icon name="refresh" />{t('native.resetDemo')}<Icon name="arrow" /></button>)}
        <section className="settings-section"><LanguageControl className="language-control--account" /></section>
        <fieldset className="settings-section appearance-control"><legend>{t('native.appearance.title')}</legend>
          <div>{(['system', 'light', 'dark'] as Appearance[]).map((option) => <button type="button" key={option} aria-pressed={appearance === option} onClick={() => { setAppearance(option); trackAction('appearance-change'); }}><Icon name={option === 'light' ? 'sun' : option === 'dark' ? 'moon' : 'system'} />{t(`native.appearance.${option}`)}</button>)}</div>
        </fieldset>
        <section className="settings-section"><label className="settings-row">
          <input type="checkbox" checked={usageAnalytics} onChange={(event) => {
            setUsageAnalytics(event.target.checked); setAnalyticsEnabled(event.target.checked);
          }} />{t('analytics.label')}</label><p>{t('analytics.detail')}</p></section>
        {apiAuth && <section className="settings-section"><NotificationControl apiAuth={apiAuth} variant="row" /></section>}
        {error && <p className="sheet__error" role="alert">{error}</p>}
        {confirmingDelete && email ? <div className="settings-delete">
          <h3>{t('account.deleteQuestion')}</h3><p>{t('account.deleteDescription')}</p>
          <label className="field" htmlFor="delete-account-confirmation"><span>{t('account.typeToConfirm', { email })}</span>
            <input className="field__input" id="delete-account-confirmation" type="email" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus /></label>
          <div className="sheet__actions"><button className="button button--secondary" type="button" disabled={Boolean(working)} onClick={() => { setConfirmingDelete(false); setConfirmation(''); setError(null); }}>{t('common.cancel')}</button>
            <button className="button button--danger" type="button" disabled={Boolean(working) || confirmation.trim().toLowerCase() !== email.toLowerCase()}
              onClick={() => void run('delete', () => onDelete?.(confirmation) ?? Promise.resolve())}>{working === 'delete' ? t('account.deleting') : t('account.deletePermanent')}</button></div>
        </div> : <section className="settings-section settings-links">
          {onExport && <button className="settings-row" type="button" disabled={Boolean(working)} onClick={() => void run('export', onExport)}><Icon name="download" />{working === 'export' ? t('account.exporting') : t('account.export')}</button>}
          <a className="settings-row" href="/privacy.html" onClick={() => trackAction('privacy-open')}><Icon name="lock" />{t('account.privacy')}<Icon name="arrow" /></a>
          {onSignOut && <button className="settings-row" type="button" disabled={Boolean(working)} onClick={() => void run('sign-out', onSignOut)}><Icon name="exit" />{working === 'sign-out' ? t('account.signingOut') : t('account.signOut')}</button>}
          {onDelete && <button className="settings-row settings-row--danger" type="button" disabled={Boolean(working)} onClick={() => setConfirmingDelete(true)}><Icon name="trash" />{t('account.delete')}</button>}
        </section>}
      </div>
    </div>, document.body)}
  </>;
}
