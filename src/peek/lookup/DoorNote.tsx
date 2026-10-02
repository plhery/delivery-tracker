import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon';

const drawings = {
  clipboard: 'M9 4h6v3H9V4ZM7 5H5v16h14V5h-2M9 12h6M9 16h4',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3',
  offline: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M19 13a10 10 0 0 0-2.2-1.6M2 9.5a15 15 0 0 1 4.3-2.8M22 9.5A15 15 0 0 0 11 5.1M12 20h.01',
} as const;

export type DoorIconName = keyof typeof drawings;

/** The door's own line drawings, in the app's icon style. */
export function DoorIcon({ name }: { name: DoorIconName }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={drawings[name]} />
  </svg>;
}

/**
 * A note under the field: something the visitor should know before going on.
 * `urgent` notes are read out when they appear; the others wait their turn.
 */
export function DoorNote({ icon, tone = 'paper', title, urgent = false, children }: {
  icon: DoorIconName | IconName;
  tone?: 'paper' | 'warm';
  title?: string;
  urgent?: boolean;
  children?: ReactNode;
}) {
  return <div className={`door-note door-note--${tone}`} role={urgent ? 'alert' : 'note'}>
    <span className="door-note__icon">{icon in drawings ? <DoorIcon name={icon as DoorIconName} /> : <Icon name={icon as IconName} />}</span>
    <div className="door-note__text">
      {title && <strong>{title}</strong>}
      {children}
    </div>
  </div>;
}
