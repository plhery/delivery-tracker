import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../i18n';
import { MAX_NAME_LENGTH } from '../recents';
import { Glyph } from './glyphs';

/**
 * What a visitor can do with the parcel: share its link, and give it a name
 * that stays on this device.
 */
export function Actions({ name, onShare, onRename }: {
  name: string | null;
  onShare: () => void;
  onRename: (name: string | null) => void;
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
    onRename(draft.trim() || null);
    setEditing(false);
  }

  if (editing) {
    return <form className="peekp-name" onSubmit={save}>
      <input type="text" value={draft} maxLength={MAX_NAME_LENGTH} autoFocus autoComplete="off" enterKeyHint="done"
        aria-label={t('detail.titleAria')} placeholder={t('common.parcel')}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') setEditing(false); }} />
      <button type="button" className="button button--secondary" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
      <button type="submit" className="button button--primary">{t('detail.saveTitle')}</button>
    </form>;
  }
  return <div className="peekp-actions">
    <button type="button" className="peekp-action" onClick={onShare}><Icon name="share" /><span>{t('link.share')}</span></button>
    <button ref={nameButton} type="button" className="peekp-action" onClick={edit}><Glyph name="pencil" /><span>{t(name ? 'detail.editTitle' : 'link.name')}</span></button>
  </div>;
}
