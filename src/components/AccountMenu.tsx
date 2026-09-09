import { trackAction, trackOverlay } from '../lib/analytics';
import { userErrorMessage } from '../lib/userMessages';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LanguageControl, useI18n } from '../i18n';
import { useAppearance, type Appearance } from '../lib/appearance';
import { useSheetDialog } from '../lib/modal';
import type { ApiAuth } from '../lib/apiClient';
import { Icon } from './Icon';
import { NotificationControl } from './NotificationControl';
import './Settings.css';

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
  const [appearance, setAppearance] = useAppearance();
  const initial = email?.trim().charAt(0).toUpperCase();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<'home' | 'account'>('home');
  useEffect(() => { if (open) return trackOverlay('account'); }, [open]);
  const [working, setWorking] = useState<AccountAction | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const [dialog, close] = useSheetDialog<HTMLDivElement>(open, () => {
    setOpen(false); setPage('home'); setConfirmingReset(false); setConfirmingDelete(false); setError(null);
  }, closeButton, undefined, Boolean(working));
  const accountTitle = t(onExitDemo ? 'settings.demoData' : 'settings.accountData');

  function navigate(next: 'home' | 'account') {
    setPage(next); setConfirmingReset(false); setConfirmingDelete(false); setError(null);
    requestAnimationFrame(() => (next === 'home' ? accountButton.current : heading.current)?.focus());
  }

  async function run(action: AccountAction, operation: () => Promise<void>) {
    if (working) return;
    setWorking(action); setError(null);
    try { await operation(); if (action === 'export' || action === 'reset-demo') setWorking(null); }
    catch (reason) { setError(userErrorMessage(reason, t, 'account.actionFailed')); setWorking(null); }
  }

  return <>
    <button type="button" className="account-trigger" aria-label={email ? t('account.options', { email }) : t('native.account')}
      aria-haspopup="dialog" onClick={() => setOpen(true)}>{initial || <Icon name="account" />}</button>
    {open && createPortal(<div className="sheet-backdrop" onClick={close}>
      <div ref={dialog} className="sheet settings-sheet account-menu refined-settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="sheet__grabber" aria-hidden="true" />
        {page === 'account' && <button type="button" className="settings-back" disabled={Boolean(working)} onClick={() => navigate('home')}><span aria-hidden="true">‹</span>{t('settings.title')}</button>}
        <div className="sheet__heading"><h2 ref={heading} tabIndex={-1} className="sheet__title" id="settings-title">{page === 'home' ? t('settings.title') : accountTitle}</h2>
          <button ref={closeButton} className="sheet__close" type="button" disabled={Boolean(working)} onClick={close} aria-label={t('common.close')}><Icon name="close" /></button></div>
        <div hidden={page !== 'home'}>
          <div className="settings-profile"><span className="settings-profile__avatar">{initial || 'D'}</span>
            <div><strong>{email || t('app.demo')}</strong>{email && <span>{t('account.signedIn')}</span>}</div></div>
          {apiAuth && <section className="settings-group" aria-labelledby="settings-deliveries"><h3 id="settings-deliveries" className="settings-group__title">{t('native.deliveries')}</h3><div className="settings-box"><NotificationControl apiAuth={apiAuth} variant="row" /></div></section>}
          <section className="settings-group" aria-labelledby="settings-preferences"><h3 className="settings-group__title" id="settings-preferences">{t('settings.preferences')}</h3>
            <div className="settings-box"><fieldset className="settings-appearance"><legend>{t('native.appearance.title')}</legend>
              <div>{(['system', 'light', 'dark'] as Appearance[]).map((option) => <button type="button" key={option} aria-pressed={appearance === option} onClick={() => { setAppearance(option); trackAction('appearance-change'); }}><span className={`settings-mini-screen settings-mini-screen--${option}`} aria-hidden="true"><i /><i /></span>{t(`native.appearance.${option}`)}</button>)}</div>
            </fieldset><LanguageControl className="language-control--account" /></div>
          </section>
          <div className="settings-box"><button ref={accountButton} className="settings-row" type="button" onClick={() => navigate('account')}>{accountTitle}<span className="settings-chevron" aria-hidden="true">›</span></button></div>
        </div>
        {page === 'account' && <>
          <p className="settings-description">{email || t('app.demo')}</p>
          {error && <p className="sheet__error" role="alert">{error}</p>}
          {confirmingDelete && email ? <div className="settings-delete">
            <h3>{t('account.deleteQuestion')}</h3><p>{t('account.deleteDescription')}</p>
            <label className="field" htmlFor="delete-account-confirmation"><span>{t('account.typeToConfirm', { email })}</span>
              <input className="field__input" id="delete-account-confirmation" type="email" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus /></label>
            <div className="sheet__actions"><button className="button button--secondary" type="button" disabled={Boolean(working)} onClick={() => { setConfirmingDelete(false); setConfirmation(''); setError(null); }}>{t('common.cancel')}</button>
              <button className="button button--danger" type="button" disabled={Boolean(working) || confirmation.trim().toLowerCase() !== email.toLowerCase()}
                onClick={() => void run('delete', () => onDelete?.(confirmation) ?? Promise.resolve())}>{working === 'delete' ? t('account.deleting') : t('account.deletePermanent')}</button></div>
          </div> : confirmingReset && onResetDemo ? <div className="settings-reset">
            <h3>{t('native.resetDemoQuestion')}</h3><p>{t('native.resetDemoDescription')}</p>
            <div className="sheet__actions">
              <button className="button button--secondary" type="button" autoFocus disabled={Boolean(working)} onClick={() => { setConfirmingReset(false); setError(null); }}>{t('common.cancel')}</button>
              <button className="button button--primary" type="button" disabled={Boolean(working)} aria-busy={working === 'reset-demo'} onClick={() => void run('reset-demo', async () => { await onResetDemo(); setOpen(false); setPage('home'); setConfirmingReset(false); })}>{t('native.resetDemo')}</button>
            </div>
          </div> : <>
            <section className="settings-group"><h3 className="settings-group__title">{t('settings.yourData')}</h3><div className="settings-box">
              {onExport && <button className="settings-row" type="button" disabled={Boolean(working)} onClick={() => void run('export', onExport)}><Icon name="download" />{working === 'export' ? t('account.exporting') : t('account.export')}</button>}
              <a className="settings-row" href="/privacy.html" onClick={() => trackAction('privacy-open')}><Icon name="lock" />{t('account.privacy')}<span className="settings-chevron" aria-hidden="true">›</span></a>
            </div></section>
            {(onExitDemo || onResetDemo) && <section className="settings-group"><h3 className="settings-group__title">{t('app.demo')}</h3><div className="settings-box">
              {onResetDemo && <button className="settings-row" type="button" disabled={Boolean(working)} onClick={() => setConfirmingReset(true)}>{t('native.resetDemo')}<span className="settings-chevron" aria-hidden="true">›</span></button>}
              {onExitDemo && <button type="button" className="settings-row" disabled={Boolean(working)} onClick={onExitDemo}>{t('native.exitDemo')}</button>}
            </div></section>}
            {onSignOut && <div className="settings-box"><button className="settings-row" type="button" disabled={Boolean(working)} onClick={() => void run('sign-out', onSignOut)}>{working === 'sign-out' ? t('account.signingOut') : t('account.signOut')}</button></div>}
            {onDelete && <button className="settings-delete-link" type="button" disabled={Boolean(working)} onClick={() => setConfirmingDelete(true)}>{t('account.delete')}</button>}
          </>}
        </>}
      </div>
    </div>, document.body)}
  </>;
}
