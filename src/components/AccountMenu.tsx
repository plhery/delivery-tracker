import { userErrorMessage } from '../lib/userMessages';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LanguageControl, useI18n } from '../i18n';
import { useAppearance, type Appearance } from '../lib/appearance';
import { useSheetDialog } from '../lib/modal';
import type { ApiAuth } from '../lib/apiClient';
import { Icon } from './Icon';
import { NotificationControl } from './NotificationControl';

type AccountAction = 'export' | 'delete' | 'sign-out';

export function AccountMenu({ email, onExport, onDelete, onSignOut, onExitDemo, apiAuth }: {
  email?: string;
  onExport?: () => Promise<void>;
  onDelete?: (confirmation: string) => Promise<void>;
  onSignOut?: () => Promise<void>;
  onExitDemo?: () => void;
  apiAuth?: ApiAuth;
}) {
  const { t } = useI18n();
  const [appearance, setAppearance] = useAppearance();
  const initial = email?.trim().charAt(0).toUpperCase();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<AccountAction | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [dialog, close] = useSheetDialog<HTMLDivElement>(open, () => setOpen(false), closeButton);

  async function run(action: AccountAction, operation: () => Promise<void>) {
    if (working) return;
    setWorking(action);
    setError(null);
    try { await operation(); if (action === 'export') setWorking(null); }
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
        <section className="settings-section"><LanguageControl className="language-control--account" /></section>
        <fieldset className="settings-section appearance-control"><legend>{t('native.appearance.title')}</legend>
          <div>{(['system', 'light', 'dark'] as Appearance[]).map((option) => <button type="button" key={option} aria-pressed={appearance === option} onClick={() => setAppearance(option)}><Icon name={option === 'light' ? 'sun' : option === 'dark' ? 'moon' : 'system'} />{t(`native.appearance.${option}`)}</button>)}</div>
        </fieldset>
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
          <a className="settings-row" href="/privacy.html"><Icon name="lock" />{t('account.privacy')}<Icon name="arrow" /></a>
          {onSignOut && <button className="settings-row" type="button" disabled={Boolean(working)} onClick={() => void run('sign-out', onSignOut)}><Icon name="exit" />{working === 'sign-out' ? t('account.signingOut') : t('account.signOut')}</button>}
          {onDelete && <button className="settings-row settings-row--danger" type="button" disabled={Boolean(working)} onClick={() => setConfirmingDelete(true)}><Icon name="trash" />{t('account.delete')}</button>}
        </section>}
      </div>
    </div>, document.body)}
  </>;
}
