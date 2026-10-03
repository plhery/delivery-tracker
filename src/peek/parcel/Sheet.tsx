import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../i18n';
import { useSheetDialog } from '../../lib/modal';
import './Sheets.css';

/**
 * A sheet over the page: it rises from the bottom on a phone, keeps the
 * keyboard inside it, closes on Escape or a tap outside, and hands the focus
 * back to what opened it.
 */
export function Sheet({ title, intro, className = '', onClose, children }: {
  title: string;
  /** A sentence under the title. */
  intro?: string;
  className?: string;
  onClose: () => void;
  /** The sheet's content; as a function it gets the way to close the sheet with its leaving animation. */
  children: ReactNode | ((dismiss: () => void) => ReactNode);
}) {
  const { t } = useI18n();
  const heading = useId();
  const close = useRef<HTMLButtonElement>(null);
  const [dialog, dismiss] = useSheetDialog<HTMLDivElement>(true, onClose, close);
  return createPortal(<div className="sheet-backdrop" onClick={dismiss}>
    <div ref={dialog} className={`sheet peeks ${className}`} role="dialog" aria-modal="true" aria-labelledby={heading} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
      <div className="sheet__grabber" aria-hidden="true" />
      <div className="sheet__heading">
        <h2 className="sheet__title" id={heading}>{title}</h2>
        <button ref={close} className="sheet__close" type="button" onClick={dismiss} aria-label={t('common.close')}><Icon name="close" /></button>
      </div>
      {intro && <p className="peeks__intro">{intro}</p>}
      {typeof children === 'function' ? children(dismiss) : children}
    </div>
  </div>, document.body);
}

/**
 * A real switch with its label: the name is the title, and the state is
 * announced as on or off. A `hint` under the title or a `value` beside the
 * switch describes it.
 */
export function SwitchRow({ icon, title, hint, value, checked, disabled = false, busy = false, onChange }: {
  icon: ReactNode;
  title: string;
  hint?: string;
  /** What the switch is about, such as the name it shows. */
  value?: string;
  checked: boolean;
  disabled?: boolean;
  /** A change is being saved: the switch shows the new state and ignores another change until it is. */
  busy?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  const described = [hint && `${id}-hint`, value && `${id}-value`].filter(Boolean).join(' ') || undefined;
  return <div className="peeks-switch" data-disabled={disabled || undefined}>
    <label htmlFor={id}>
      <span className="peeks-switch__icon" aria-hidden="true">{icon}</span>
      <span className="peeks-switch__text">
        <strong id={`${id}-title`}>{title}</strong>
        {hint && <small id={`${id}-hint`}>{hint}</small>}
      </span>
      {value && <span className="peeks-switch__value" id={`${id}-value`}>{value}</span>}
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} aria-busy={busy || undefined}
        aria-labelledby={`${id}-title`} aria-describedby={described}
        onChange={(event) => { if (!busy) onChange(event.target.checked); }} />
      <span className="peeks-switch__track" aria-hidden="true" />
    </label>
  </div>;
}
