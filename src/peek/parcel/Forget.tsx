import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useI18n, type MessageKey } from '../../i18n';
import { trackAction } from '../../lib/analytics';
import { forgetParcelLink, ParcelLinkError, parcelLinkErrorKey } from '../links';
import { forgetRecent } from '../recents';

const SOURCE_URL = 'https://github.com/plhery/delivery-tracker';

/**
 * Forgets a lookup everywhere: on the server with the owner key, then on this
 * device. A link that is already gone counts as forgotten.
 */
export async function forgetParcel(linkId: string, key: string): Promise<void> {
  try {
    await forgetParcelLink(linkId, key);
  } catch (error) {
    if (!(error instanceof ParcelLinkError && error.kind === 'unavailable')) {
      trackAction('parcel-link-forget', 'error');
      throw error;
    }
  }
  forgetRecent(linkId);
  trackAction('parcel-link-forget', 'success');
}

/**
 * Asks once before a parcel is forgotten for good. With `arrived`, it is the
 * owner's gentle exit after "I have it": forget the parcel now, or keep it
 * until Peek forgets it by itself.
 */
export function ForgetDialog({ onForget, onCancel, arrived }: {
  /** Forgets the parcel; a rejection keeps the dialog open with its reason. */
  onForget: () => Promise<void>;
  onCancel: () => void;
  /** The parcel has arrived; `forgetLine` says when Peek forgets it anyway. */
  arrived?: { forgetLine: string | null };
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    return () => { if (typeof element.close === 'function' && element.open) element.close(); };
  }, []);

  async function forget() {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      await onForget();
    } catch (reason) {
      const key = parcelLinkErrorKey(reason);
      setError(key === 'error.generic' ? 'link.forget.failed' : key);
      setWorking(false);
    }
  }

  return <dialog ref={dialog} className="delete-parcel-dialog" aria-labelledby="peekp-forget-title" aria-describedby="peekp-forget-body"
    onCancel={(event) => { event.preventDefault(); if (!working) onCancel(); }}>
    <h2 id="peekp-forget-title">{t(arrived ? 'alerts.have.title' : 'link.forget.title')}</h2>
    <p id="peekp-forget-body">{arrived ? [arrived.forgetLine, t('alerts.have.body')].filter(Boolean).join(' ') : t('link.forget.body')}</p>
    {error && <p className="sheet__error" role="alert">{t(error)}</p>}
    <div className="delete-parcel-dialog__actions">
      <button type="button" className="button button--secondary" onClick={onCancel} disabled={working} autoFocus>{t(arrived ? 'alerts.have.keep' : 'common.cancel')}</button>
      <button type="button" className="button button--danger" onClick={() => void forget()} disabled={working}>{t(working ? 'link.forget.working' : 'link.forget.now')}</button>
    </div>
  </dialog>;
}

/** The privacy promise at the foot of the page, with the way to forget the parcel at once for its owner. */
export function ForgetFooter({ promise, onForget }: {
  /** When Peek forgets the parcel by itself; absent for a parcel shared from an account. */
  promise: string | null;
  /** Offered to the owner only. */
  onForget?: () => void;
}) {
  const { t } = useI18n();
  return <footer className="peekp-footer">
    {promise && <p><Icon name="lock" />{promise}</p>}
    <p>
      {onForget && <><button type="button" className="peekp-footer__forget" onClick={onForget}>{t('link.forget.now')}</button> · </>}
      <a href="/privacy.html" onClick={() => trackAction('privacy-open')}>{t('auth.privacyLink')}</a> · <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">{t('link.source')}</a>
    </p>
  </footer>;
}

/**
 * Later, once the journey is over: the day Peek forgets the parcel, and what
 * can still be done with it.
 */
export function Afterwards({ date, onForget, keepLabel, onKeep, onTrackAnother }: {
  /** "Peek forgets this parcel on 30 Oct", when the link has such a day. */
  date: string | null;
  onForget?: () => void;
  keepLabel?: string;
  onKeep?: () => void;
  onTrackAnother: () => void;
}) {
  const { t } = useI18n();
  return <>
    {(date || onForget || onKeep) && <section className="peekp-after" aria-labelledby={date ? 'peekp-after-title' : undefined}>
      <span className="peekp-after__icon" aria-hidden="true"><Icon name="hourglass" /></span>
      {date && <h2 id="peekp-after-title">{date}</h2>}
      <p>{t('link.forget.body')}</p>
      <div>
        {onForget && <button type="button" className="button button--secondary" onClick={onForget}><Icon name="trash" />{t('link.forget.now')}</button>}
        {onKeep && <button type="button" className="button peekp-after__keep" onClick={onKeep}>{keepLabel}</button>}
      </div>
    </section>}
    <section className="peekp-another" aria-labelledby="peekp-another-title">
      <h2 id="peekp-another-title">{t('link.another')}</h2>
      <button type="button" className="button button--secondary" onClick={onTrackAnother}><Icon name="search" />{t('app.trackAnother')}</button>
    </section>
  </>;
}
