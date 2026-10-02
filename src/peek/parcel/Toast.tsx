import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { ToastMark } from '../../components/ToastMark';
import { useI18n, type MessageKey } from '../../i18n';
import './Toast.css';

/** A short word at the edge of the screen. It is a status: read out, never focused. */
export function Toast({ mark, children, action, place = 'bottom', tone = false }: {
  mark?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  place?: 'top' | 'bottom';
  /** The mark takes the parcel's own colours. */
  tone?: boolean;
}) {
  return <div className={`peekp-toast peekp-toast--${place}`} role="status">
    {mark !== undefined ? <span className={`peekp-toast__mark${tone ? ' peekp-toast__mark--tone' : ''}`} aria-hidden="true">{mark}</span> : <ToastMark kind="success" />}
    <span className="peekp-toast__text">{children}</span>
    {action}
  </div>;
}

interface Notice { id: number; text: MessageKey }

const NOTICE_MS = 4_000;
const listeners = new Set<() => void>();
let notice: Notice | null = null;
let serial = 0;

function show(next: Notice | null) {
  notice = next;
  for (const listener of [...listeners]) listener();
}

/** Says something that outlives the screen it happened on: a parcel forgotten, then the front door. */
export function announceNotice(text: MessageKey): void {
  show({ id: ++serial, text });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Shows the notice wherever the visitor is now, for a few seconds. */
export function NoticeToast() {
  const { t } = useI18n();
  const current = useSyncExternalStore(subscribe, () => notice, () => null);
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => { if (notice === current) show(null); }, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [current]);
  return current ? <Toast key={current.id}>{t(current.text)}</Toast> : null;
}
