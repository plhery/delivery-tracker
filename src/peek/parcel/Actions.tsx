import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../i18n';
import { MAX_NAME_LENGTH } from '../recents';
import { Glyph } from './glyphs';

/** The way into the alerts, as the actions row words it. */
export interface PingAction {
  /** "Ping me", "Alerts on"… */
  label: string;
  /** What the button says where there is room: "Ping me when it arrives". */
  long?: string;
  /** The one next step that matters, as for a parcel no carrier has scanned yet: a button of its own above the row. */
  prominent?: boolean;
  onOpen: () => void;
}

/**
 * What can be done with the parcel: be told when it moves, add its delivery
 * to a calendar, share its link, and give it a name that stays on this
 * device. Once it has arrived, "I have it" takes the place of the alerts.
 */
export function Actions({ name, ping, onHave, onCalendar, onShare, onRename, compactName = false }: {
  name: string | null;
  /** Absent once the journey is over. */
  ping?: PingAction;
  /** The owner's gentle exit, once the parcel is delivered. */
  onHave?: () => void;
  /** Offered in the row to a recipient; an owner finds it in the alerts. */
  onCalendar?: () => void;
  onShare?: () => void;
  onRename?: (name: string | null) => void;
  /** The name action is its pencil alone, where the row has more to say. */
  compactName?: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const nameButton = useRef<HTMLButtonElement>(null);
  const edited = useRef(false);
  // The form takes the button's place: when it closes, the keyboard is back where it was.
  useEffect(() => {
    if (editing) edited.current = true;
    else if (edited.current) nameButton.current?.focus({ preventScroll: true });
  }, [editing]);
  function edit() {
    setDraft(name ?? '');
    setEditing(true);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    onRename?.(draft.trim() || null);
    setEditing(false);
  }

  if (editing && onRename) {
    return <form className="peekp-name" onSubmit={save}>
      <input type="text" value={draft} maxLength={MAX_NAME_LENGTH} autoFocus autoComplete="off" enterKeyHint="done"
        aria-label={t('detail.titleAria')} placeholder={t('common.parcel')} data-escape="own"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') setEditing(false); }} />
      <button type="button" className="button button--secondary" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
      <button type="submit" className="button button--primary">{t('detail.saveTitle')}</button>
    </form>;
  }
  // A gift that has arrived leaves its recipient nothing to do here.
  if (!ping && !onHave && !onCalendar && !onShare && !onRename) return null;
  const row = <>
    {ping && !ping.prominent && <button type="button" className="peekp-action" onClick={ping.onOpen}>
      <Icon name="bell" />{ping.long ? <><span className="peekp-action__short">{ping.label}</span><span className="peekp-action__long">{ping.long}</span></> : <span>{ping.label}</span>}
    </button>}
    {onHave && <button type="button" className="peekp-action" onClick={onHave}><Icon name="check" /><span>{t('alerts.have.action')}</span></button>}
    {onCalendar && <button type="button" className="peekp-action" onClick={onCalendar}><Glyph name="calendar" /><span>{t('alerts.calendar.action')}</span></button>}
    {onShare && <button type="button" className="peekp-action" onClick={onShare}><Icon name="share" /><span>{t('link.share')}</span></button>}
    {onRename && <button ref={nameButton} type="button" className={`peekp-action peekp-action--name${compactName ? ' peekp-action--compact' : ''}`} aria-label={t(name ? 'detail.editTitle' : 'link.name')} onClick={edit}>
      <Glyph name="pencil" /><span>{t(name ? 'detail.editTitle' : 'link.name')}</span>
    </button>}
  </>;
  if (!ping?.prominent) return <div className="peekp-actions">{row}</div>;
  return <div className="peekp-actions peekp-actions--led">
    <button type="button" className="button button--primary peekp-actions__lead" onClick={ping.onOpen}><Icon name="bell" /><span>{ping.label}</span></button>
    {row}
  </div>;
}
