import { useEffect, useId, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useI18n, type MessageKey } from '../../i18n';
import { trackAction } from '../../lib/analytics';
import type { ParcelWithEvents } from '../../types';
import { noteLink, useLinkNote, type ShareWords } from '../deviceNotes';
import {
  cleanLinkText,
  MAX_GIFT_FROM_LENGTH,
  MAX_GIFT_NOTE_LENGTH,
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
import { SharePreview } from './SharePreview';
import { Sheet, SwitchRow } from './Sheet';

const NO_WORDS: ShareWords = { name: false, note: '', from: '' };

interface Settings { showNumber: boolean; gift: boolean }

/**
 * The share sheet: what the link shows, as the other person will see it, the
 * switches that change it, the link, and the way to stop sharing. Gift words
 * are saved before handing out the link and released only after delivery.
 */
function ShareSheetView({ title, parcel, linkId, settings, loading, stopped, stoppedLine, pendingLine, name, worksUntil, words,
  onWords, onChange, onLink, onStop, onAgain, onAccount, onClose }: {
  title: string;
  parcel: ParcelWithEvents;
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
  /** The name the link can carry. A parcel without a name has no such choice. */
  name: string | null;
  /** The day the link stops working, for a link Peek forgets by itself: "30 oct". */
  worksUntil?: string | null;
  words: ShareWords;
  onWords: (words: ShareWords) => void;
  /** Saves a switch. A rejection puts the switch back and says so. */
  onChange: (changes: Settings) => Promise<void>;
  /** The link to hand out, made now when there is none yet. */
  onLink: (giftWords?: ParcelLinkChanges['giftWords']) => Promise<string>;
  onStop: () => Promise<void>;
  /** Absent where sharing again simply makes a new link. */
  onAgain?: () => Promise<void>;
  /** Leaves the sheet to sign in: a link from an account works for as long as it is shared. */
  onAccount?: () => void;
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
  const address = linkId ? parcelShareURL(linkId, shown.gift ? {} : carried) : null;

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
    const protectedWords = shown.gift ? { name: carried.name, note: cleanLinkText(carried.note, MAX_GIFT_NOTE_LENGTH), from: cleanLinkText(carried.from, MAX_GIFT_FROM_LENGTH) } : undefined;
    const url = parcelShareURL(await onLink(protectedWords), shown.gift ? {} : carried);
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
      <SharePreview parcel={parcel} name={carried.name} showNumber={shown.showNumber} gift={shown.gift} />
      <div className="peeks-switches peeks-switches--joined">
        <SwitchRow icon={<Glyph name="receipt" />} title={t('share.number.title')}
          checked={shown.showNumber} disabled={loading} busy={'showNumber' in saving} onChange={(value) => void change('showNumber', value)} />
        {name && <SwitchRow icon={<Glyph name="pencil" />} title={t('share.name.title')} value={name}
          checked={words.name} disabled={loading} onChange={(value) => onWords({ ...words, name: value })} />}
        <SwitchRow icon={<Icon name="gift" />} title={t('share.gift.title')}
          checked={shown.gift} disabled={loading} busy={'gift' in saving} onChange={(value) => void change('gift', value)} />
      </div>
      {shown.gift && <div className="peeks-gift">
        <label htmlFor={`${fields}-note`}>{t('share.gift.note')}</label>
        <textarea id={`${fields}-note`} rows={2} maxLength={MAX_GIFT_NOTE_LENGTH} value={note} autoComplete="off"
          aria-describedby={`${fields}-private`} onChange={(event) => write('note', event.target.value)} />
        <label htmlFor={`${fields}-from`}>{t('share.gift.from')}</label>
        <input id={`${fields}-from`} type="text" maxLength={MAX_GIFT_FROM_LENGTH} value={from} autoComplete="off"
          onChange={(event) => write('from', event.target.value)} />
        <small id={`${fields}-private`}>{t('share.gift.private')}</small>
      </div>}
      <div className="peeks-link" aria-busy={loading || undefined}>
        {address
          ? <span className="peeks-link__address" aria-label={t('share.address')}>{address.replace(/^https?:\/\//, '')}</span>
          : <span className="peeks-link__pending">{loading ? '…' : pendingLine}</span>}
        <button type="button" className="peeks-link__copy" disabled={loading || working || Object.keys(saving).length > 0} onClick={() => void handOut('copy')}><Icon name="copy" /><span>{t('detail.copy')}</span></button>
      </div>
      {error && <p className="sheet__error" role="alert">{t(error)}</p>}
      <div className="peeks__actions">
        <button type="button" className="button button--primary" disabled={loading || working || Object.keys(saving).length > 0} onClick={() => void handOut('share')}><Icon name="share" /><span>{t('share.action')}</span></button>
      </div>
      {(worksUntil || linkId) && <div className="peeks__foot">
        {worksUntil && <p>
          {t('share.works.until', { date: worksUntil })}
          {onAccount && <> · <button type="button" onClick={() => { dismiss(); onAccount(); }}>{t('share.works.account')}</button></>}
        </p>}
        {linkId && <button type="button" className="peeks__stop" disabled={working} onClick={() => void run(onStop)}>{t('share.stop')}</button>}
      </div>}
    </>}
    <p className="peeks__said" role="status" data-empty={!said || undefined}>{said && <><Icon name="check" />{t(said)}</>}</p>
  </>}</Sheet>;
}

/**
 * Sharing a looked-up parcel, for the device that holds its owner key. The
 * switches are saved at once, and the page takes the answer.
 */
export function LinkShareSheet({ linkId, ownerKey, view, name, worksUntil, onChanged, onAccount, onClose }: {
  linkId: string;
  ownerKey: string;
  view: ParcelLinkView;
  /** The name this device has for the parcel. */
  name: string | null;
  /** The day Peek forgets the parcel, once its journey is over: "30 oct". */
  worksUntil: string | null;
  onChanged: (view: ParcelLinkView) => void;
  /** Offered to a visitor. */
  onAccount?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const words = useLinkNote(linkId).share ?? (view.link.giftWords
    ? { name: !!view.link.giftWords.name, note: view.link.giftWords.note ?? '', from: view.link.giftWords.from ?? '' } : NO_WORDS);
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
    parcel={parcel}
    linkId={linkId}
    settings={{ showNumber: link.showNumber === true, gift: link.gift === true }}
    loading={false}
    stopped={link.shared === false}
    stoppedLine={t('share.stopped.owner')}
    pendingLine=""
    name={name}
    worksUntil={worksUntil}
    words={words}
    onWords={(next) => noteLink(linkId, { share: next })}
    onChange={(next) => save({
      ...(next.showNumber !== (link.showNumber === true) ? { showNumber: next.showNumber } : {}),
      ...(next.gift !== (link.gift === true) ? { gift: next.gift } : {}),
    }, 'parcel-link-share-change')}
    onLink={async (giftWords) => {
      if (giftWords) await save({ giftWords }, 'parcel-link-share-change');
      return linkId;
    }}
    onStop={() => save({ shared: false }, 'parcel-link-share-stop')}
    onAgain={() => save({ shared: true }, 'parcel-link-share-change')}
    onAccount={onAccount}
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
  const { t } = useI18n();
  const [state, setState] = useState<{ link: ParcelShare | null; loading: boolean; stopped: boolean }>({ link: null, loading: true, stopped: false });
  // What the next link will show, chosen before there is one.
  const [chosen, setChosen] = useState<Settings>({ showNumber: false, gift: false });
  const [draft, setDraft] = useState<ShareWords>(NO_WORDS);
  const noted = useLinkNote(state.link?.id ?? null).share;
  const words = state.link ? noted ?? (state.link.giftWords
    ? { name: !!state.link.giftWords.name, note: state.link.giftWords.note ?? '', from: state.link.giftWords.from ?? '' } : draft) : draft;
  const name = parcel.label.trim() || null;

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

  async function share(settings: Settings & Pick<ParcelLinkChanges, 'giftWords'>): Promise<ParcelShare> {
    const link = await client.share(parcel, settings);
    setState({ link, loading: false, stopped: false });
    setChosen({ showNumber: link.showNumber, gift: link.gift });
    if (!noted) noteLink(link.id, { share: words });
    return link;
  }

  return <ShareSheetView
    title={name ? t('share.titleNamed', { name }) : t('share.title')}
    parcel={parcel}
    linkId={state.link?.id ?? null}
    settings={chosen}
    loading={state.loading}
    stopped={false}
    stoppedLine=""
    pendingLine={t(state.stopped ? 'share.stopped.account' : 'share.pending')}
    name={name}
    words={words}
    onWords={(next) => { if (state.link) noteLink(state.link.id, { share: next }); else setDraft(next); }}
    onChange={async (next) => { if (state.link) await share(next); else setChosen(next); }}
    onLink={async (giftWords) => (giftWords ? await share({ ...chosen, giftWords }) : state.link ?? await share(chosen)).id}
    onStop={async () => {
      await client.stop(parcel.id);
      setDraft(words);
      setState({ link: null, loading: false, stopped: true });
    }}
    onClose={onClose}
  />;
}
