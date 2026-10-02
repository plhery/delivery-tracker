import { useEffect, useId, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useI18n, type MessageKey } from '../../i18n';
import { trackAction } from '../../lib/analytics';
import { carrierInfo, displayedCarrierId } from '../../lib/carriers';
import type { ParcelWithEvents } from '../../types';
import { noteLink, useLinkNote, type ShareWords } from '../deviceNotes';
import {
  cleanLinkText,
  MAX_GIFT_FROM_LENGTH,
  MAX_GIFT_NOTE_LENGTH,
  maskedNumber,
  numberEnds,
  parcelLinkErrorKey,
  updateParcelLink,
  type ParcelLinkChanges,
  type ParcelLinkView,
  type ParcelShare,
  type ParcelShareClient,
} from '../links';
import { parcelShareURL } from '../route';
import { Glyph } from './glyphs';
import { copyText, shareParcelLink } from './share';
import { Sheet, SwitchRow } from './Sheet';

const NO_WORDS: ShareWords = { name: false, note: '', from: '' };

interface Settings { showNumber: boolean; gift: boolean }

/**
 * The share sheet: the parcel's link, what it shows, and the way to stop
 * sharing. The name, a gift's note and who it is from are added to the link
 * after its `#`: they reach the recipient's browser and no server.
 */
function ShareSheetView({ title, linkId, settings, loading, stopped, stoppedLine, pendingLine, numberHint, name, nameTitle, nameHint, unnamedHint, promise, words,
  onWords, onChange, onLink, onStop, onAgain, onNameIt, onClose }: {
  title: string;
  /** The link, once there is one. */
  linkId: string | null;
  settings: Settings;
  /** The link's state is being read. */
  loading: boolean;
  /** Sharing was stopped: the sheet says so and offers the way back. */
  stopped: boolean;
  stoppedLine: string;
  /** What stands in the link's place while there is none. */
  pendingLine: string;
  numberHint: string;
  /** The name the link can carry, when the parcel has one. */
  name: string | null;
  nameTitle: string;
  nameHint: string;
  unnamedHint: string;
  promise: string;
  words: ShareWords;
  onWords: (words: ShareWords) => void;
  /** Saves a switch. A rejection puts the switch back and says so. */
  onChange: (changes: Settings) => Promise<void>;
  /** The link to hand out, made now when there is none yet. */
  onLink: () => Promise<string>;
  onStop: () => Promise<void>;
  /** Absent where sharing again simply makes a new link. */
  onAgain?: () => Promise<void>;
  /** Leaves the sheet to name the parcel. */
  onNameIt?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const fields = useId();
  const [saving, setSaving] = useState<Partial<Settings>>({});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [said, setSaid] = useState<MessageKey | null>(null);
  // What is being typed, spaces and all: the device keeps the words clean, which would eat a space between two of them.
  const [typed, setTyped] = useState({ note: words.note, from: words.from });
  const note = (cleanLinkText(typed.note, MAX_GIFT_NOTE_LENGTH) ?? '') === words.note ? typed.note : words.note;
  const from = (cleanLinkText(typed.from, MAX_GIFT_FROM_LENGTH) ?? '') === words.from ? typed.from : words.from;
  function write(field: 'note' | 'from', value: string) {
    setTyped({ note, from, [field]: value });
    onWords({ ...words, [field]: value });
  }
  const shown = { ...settings, ...saving };
  const carried = { name: words.name && name ? name : null, note: shown.gift ? words.note : null, from: shown.gift ? words.from : null };
  const address = linkId ? parcelShareURL(linkId, carried) : null;

  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(null), 4_000);
    return () => clearTimeout(timer);
  }, [said]);

  async function change(field: keyof Settings, value: boolean) {
    setError(null);
    setSaving((current) => ({ ...current, [field]: value }));
    try {
      await onChange({ ...shown, [field]: value });
    } catch (reason) {
      const key = parcelLinkErrorKey(reason);
      setError(key === 'error.generic' ? 'share.failed' : key);
    } finally {
      setSaving((current) => {
        const { [field]: saved, ...rest } = current;
        void saved;
        return rest;
      });
    }
  }

  async function run(action: () => Promise<void>) {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      const key = parcelLinkErrorKey(reason);
      setError(key === 'error.generic' ? 'share.failed' : key);
    } finally {
      setWorking(false);
    }
  }

  const handOut = (how: 'share' | 'copy') => run(async () => {
    const url = parcelShareURL(await onLink(), carried);
    if (how === 'share') {
      const outcome = await shareParcelLink(url);
      if (outcome === 'copied') setSaid('link.copied');
      if (outcome === 'failed') setError('link.shareFailed');
      return;
    }
    const copied = await copyText(url);
    trackAction('parcel-link-share', copied ? 'success' : 'error');
    if (copied) setSaid('link.copied');
    else setError('link.shareFailed');
  });

  return <Sheet title={title} className="peeks-share" onClose={onClose}>{(dismiss) => <>
    {stopped ? <>
      <p className="peeks__note" role="status"><Glyph name="info" />{stoppedLine}</p>
      {error && <p className="sheet__error" role="alert">{t(error)}</p>}
      {onAgain && <div className="peeks__actions">
        <button type="button" className="button button--primary" disabled={working} onClick={() => void run(onAgain)}>{t('share.again')}</button>
      </div>}
    </> : <>
      <div className="peeks-link" aria-busy={loading || undefined}>
        {address
          ? <span className="peeks-link__address" aria-label={t('share.address')}>{address.replace(/^https?:\/\//, '')}</span>
          : <span className="peeks-link__pending">{loading ? '…' : pendingLine}</span>}
        <button type="button" className="peeks-link__copy" disabled={loading || working} onClick={() => void handOut('copy')}><Icon name="copy" /><span>{t('detail.copy')}</span></button>
      </div>
      <div className="peeks-switches">
        <SwitchRow icon={<Glyph name="receipt" />} title={t('share.number.title')} hint={t('share.number.hint', { number: numberHint })}
          checked={shown.showNumber} disabled={loading} busy={'showNumber' in saving} onChange={(value) => void change('showNumber', value)} />
        <SwitchRow icon={<Glyph name="pencil" />} title={nameTitle} hint={name ? nameHint : unnamedHint}
          checked={!!name && words.name} disabled={loading || !name} onChange={(value) => onWords({ ...words, name: value })}>
          {!name && onNameIt && <button type="button" className="peeks-switch__nudge" onClick={() => { dismiss(); onNameIt(); }}>{t('link.name')}</button>}
        </SwitchRow>
        <SwitchRow icon={<Icon name="gift" />} title={t('share.gift.title')} hint={t('share.gift.hint')}
          checked={shown.gift} disabled={loading} busy={'gift' in saving} onChange={(value) => void change('gift', value)} />
        {shown.gift && <div className="peeks-gift">
          <label htmlFor={`${fields}-note`}>{t('share.gift.note')}</label>
          <textarea id={`${fields}-note`} rows={2} maxLength={MAX_GIFT_NOTE_LENGTH} value={note} autoComplete="off"
            aria-describedby={`${fields}-private`} onChange={(event) => write('note', event.target.value)} />
          <label htmlFor={`${fields}-from`}>{t('share.gift.from')}</label>
          <input id={`${fields}-from`} type="text" maxLength={MAX_GIFT_FROM_LENGTH} value={from} autoComplete="off"
            onChange={(event) => write('from', event.target.value)} />
          <small id={`${fields}-private`}>{t('share.gift.private')}</small>
        </div>}
      </div>
      <p className="peeks__promise">{promise}</p>
      {error && <p className="sheet__error" role="alert">{t(error)}</p>}
      <div className="peeks__actions">
        <button type="button" className="button button--primary" disabled={loading || working} onClick={() => void handOut('share')}><Icon name="share" /><span>{t('share.action')}</span></button>
        {linkId && <button type="button" className="peeks__quiet" disabled={working} onClick={() => void run(onStop)}>{t('share.stop')}</button>}
      </div>
    </>}
    <p className="peeks__said" role="status" data-empty={!said || undefined}>{said && <><Icon name="check" />{t(said)}</>}</p>
  </>}</Sheet>;
}

/**
 * Sharing a looked-up parcel, for the device that holds its owner key. The
 * switches are saved at once, and the page takes the answer.
 */
export function LinkShareSheet({ linkId, ownerKey, view, name, onChanged, onNameIt, onClose }: {
  linkId: string;
  ownerKey: string;
  view: ParcelLinkView;
  /** The name this device has for the parcel. */
  name: string | null;
  onChanged: (view: ParcelLinkView) => void;
  onNameIt: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const words = useLinkNote(linkId).share ?? NO_WORDS;
  const { link, parcel } = view;

  async function save(changes: ParcelLinkChanges, event: 'parcel-link-share-change' | 'parcel-link-share-stop') {
    try {
      onChanged(await updateParcelLink(linkId, ownerKey, changes));
      trackAction(event, 'success');
    } catch (error) {
      trackAction(event, 'error');
      throw error;
    }
  }

  return <ShareSheetView
    title={t('share.title')}
    linkId={linkId}
    settings={{ showNumber: link.showNumber === true, gift: link.gift === true }}
    loading={false}
    stopped={link.shared === false}
    stoppedLine={t('share.stopped.owner')}
    pendingLine=""
    numberHint={maskedNumber(numberEnds(parcel.trackingNumber))}
    name={name}
    nameTitle={t('share.inside.title')}
    nameHint={t('share.inside.hint', { name: name ?? '' })}
    unnamedHint={t('share.inside.unnamed')}
    promise={t('share.promise.link')}
    words={words}
    onWords={(next) => noteLink(linkId, { share: next })}
    onChange={(next) => save({
      ...(next.showNumber !== (link.showNumber === true) ? { showNumber: next.showNumber } : {}),
      ...(next.gift !== (link.gift === true) ? { gift: next.gift } : {}),
    }, 'parcel-link-share-change')}
    onLink={async () => linkId}
    onStop={() => save({ shared: false }, 'parcel-link-share-stop')}
    onAgain={() => save({ shared: true }, 'parcel-link-share-change')}
    onNameIt={onNameIt}
    onClose={onClose}
  />;
}

/**
 * Sharing one of an account's parcels. The link is made when the person
 * shares or copies it, not when the sheet opens: until then nothing about the
 * parcel can be reached from outside the account.
 */
export function AccountShareSheet({ parcel, client, onClose }: {
  parcel: ParcelWithEvents;
  client: ParcelShareClient;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ link: ParcelShare | null; loading: boolean; stopped: boolean }>({ link: null, loading: true, stopped: false });
  // What the next link will show, chosen before there is one.
  const [chosen, setChosen] = useState<Settings>({ showNumber: false, gift: false });
  const [draft, setDraft] = useState<ShareWords>(NO_WORDS);
  const noted = useLinkNote(state.link?.id ?? null).share;
  const words = state.link ? noted ?? draft : draft;
  const name = parcel.label.trim() || null;
  const fallback = useMemo(() => t('share.name.fallback', { carrier: carrierInfo(displayedCarrierId(parcel), locale).name }), [parcel, locale, t]);

  useEffect(() => {
    let disposed = false;
    client.current(parcel.id).then((link) => {
      if (disposed) return;
      setState({ link, loading: false, stopped: false });
      if (link) setChosen({ showNumber: link.showNumber, gift: link.gift });
    }, () => {
      // Without an answer the sheet offers what it can: sharing makes or finds the link.
      if (!disposed) setState({ link: null, loading: false, stopped: false });
    });
    return () => { disposed = true; };
  }, [client, parcel.id]);

  async function share(settings: Settings): Promise<ParcelShare> {
    const link = await client.share(parcel, settings);
    setState({ link, loading: false, stopped: false });
    setChosen({ showNumber: link.showNumber, gift: link.gift });
    if (!noted) noteLink(link.id, { share: draft });
    return link;
  }

  return <ShareSheetView
    title={name ? t('share.titleNamed', { name }) : t('share.title')}
    linkId={state.link?.id ?? null}
    settings={chosen}
    loading={state.loading}
    stopped={false}
    stoppedLine=""
    pendingLine={t(state.stopped ? 'share.stopped.account' : 'share.pending')}
    numberHint={maskedNumber(numberEnds(parcel.trackingNumber))}
    name={name}
    nameTitle={t('share.name.title')}
    nameHint={t('share.name.hint', { name: fallback })}
    unnamedHint={t('share.name.unnamed')}
    promise={t('share.promise.account')}
    words={words}
    onWords={(next) => { if (state.link) noteLink(state.link.id, { share: next }); else setDraft(next); }}
    onChange={async (next) => { if (state.link) await share(next); else setChosen(next); }}
    onLink={async () => (state.link ?? await share(chosen)).id}
    onStop={async () => {
      await client.stop(parcel.id);
      setDraft(words);
      setState({ link: null, loading: false, stopped: true });
    }}
    onClose={onClose}
  />;
}
