import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Icon, SmallPip } from '../../components/Icon';
import type { ApiParcelFeedbackReason } from '../../generated/apiContract';
import { useI18n, type MessageKey } from '../../i18n';
import { trackAction } from '../../lib/analytics';
import {
  asksFeedback,
  asksOnReturn,
  FEEDBACK_REASONS,
  type FeedbackMemory,
  type FeedbackNotes,
  type ParcelFeedback,
  type SendParcelFeedback,
} from './feedbackModel';
import { Glyph } from './glyphs';
import { Sheet } from './Sheet';
import { Toast } from './Toast';
import './Feedback.css';

/**
 * The question a parcel's page asks its reader. For a parcel a carrier
 * answers for, Pip asks where the history ends whether he got it right, and
 * the page asks once more on the way back from the carrier's own site. For a
 * parcel no carrier was found for, a row asks whether the carrier's site
 * shows it. An answer is given in place; a sheet takes the words.
 */
export interface FeedbackSubject {
  /** A carrier answers for the parcel, or none was found. Null asks nothing. */
  kind: 'found' | 'unknown' | null;
  /** What the page ends on (`scanIdentity`). */
  scan: string;
  /** The carrier's name, for the line that says what an answer carries. */
  carrier: string;
  /** Something else is said or asked over the page: the question on the way back waits for another visit. */
  busy?: boolean;
  /** This browser's memory of the question; the same object for as long as the parcel is the same. */
  notes: FeedbackNotes;
  send: SendParcelFeedback;
}

type Moment = 'ask' | 'reasons' | 'sent' | 'noted' | 'right' | 'early' | 'named';
type Open =
  | { sheet: 'wrong'; id: string; reasons: readonly ApiParcelFeedbackReason[]; asked: 'page' | 'back' }
  | { sheet: 'carrier' };
type Word = { say: 'back'; site: string } | { say: 'back-right' | 'back-sent' | 'failed' };

const ACTIONS = { right: 'parcel-feedback-right', wrong: 'parcel-feedback-wrong', found_elsewhere: 'parcel-feedback-carrier' } as const;
const REASON_KEYS: Record<ApiParcelFeedbackReason, MessageKey> = {
  arrived: 'feedback.reason.arrived',
  status: 'feedback.reason.status',
  steps: 'feedback.reason.steps',
  time_place: 'feedback.reason.timePlace',
  carrier: 'feedback.reason.carrier',
  other: 'feedback.reason.other',
};
/** The question on the way back waits this long for an answer, a word of thanks stays this long. */
const BACK_MS = 12_000;
const WORD_MS = 4_000;
/** A page left for less than this was not compared with the carrier's. */
const AWAY_MS = 1_500;
const NOTE_LIMIT = 1_000;
const CARRIER_LIMIT = 120;
const PAGE_LIMIT = 500;

export interface ParcelFeedbackState {
  kind: 'found' | 'unknown' | null;
  carrier: string;
  /** The standing question is on the page. */
  shown: boolean;
  moment: Moment;
  open: Open | null;
  word: Word | null;
  /** Where the standing question stands on the page: what a sheet hands the focus back to. */
  place: RefObject<HTMLDivElement | null>;
  /** The reader leaves for a carrier's own page, named as its link names it. */
  visited(site: string): void;
  right(asked: 'page' | 'back'): void;
  notQuite(): void;
  pick(reason: ApiParcelFeedbackReason): void;
  addNote(): void;
  wrongOnReturn(): void;
  elsewhere(): void;
  notYet(): void;
  sendWords(reasons: readonly ApiParcelFeedbackReason[], note: string): Promise<boolean>;
  sendCarrier(name: string, page: string): Promise<boolean>;
  close(): void;
}

/** What the browser remembered as the page opened. An answer given on this visit stays on the page to be read. */
interface Opened { notes: FeedbackNotes; memory: FeedbackMemory; at: number }
const opening = (notes: FeedbackNotes): Opened => ({ notes, memory: notes.read(), at: Date.now() });

export function useParcelFeedback({ kind, scan, carrier, busy = false, notes, send }: FeedbackSubject): ParcelFeedbackState {
  const { locale } = useI18n();
  const [remembered, setRemembered] = useState(() => opening(notes));
  if (remembered.notes !== notes) setRemembered(opening(notes));
  const [flow, setFlow] = useState<{ notes: FeedbackNotes; kind: FeedbackSubject['kind']; moment: Moment }>({ notes, kind, moment: 'ask' });
  // Another parcel, or a carrier found while the page was open, starts over.
  const moment = flow.notes === notes && flow.kind === kind ? flow.moment : 'ask';
  const go = (next: Moment) => setFlow({ notes, kind, moment: next });
  const [open, setOpen] = useState<Open | null>(null);
  const [word, setWord] = useState<Word | null>(null);
  // The answer whose reason was given in place, for the note that may follow it.
  const given = useRef<{ id: string; reasons: readonly ApiParcelFeedbackReason[] } | null>(null);
  const place = useRef<HTMLDivElement>(null);
  // What the question says once its sheet has closed. Said earlier, it would take away the button the sheet
  // hands the focus back to, and the page would jump to its first control instead.
  const after = useRef<Moment | null>(null);

  const remember = (answeredFor: string) => notes.write({ ...notes.read(), at: new Date().toISOString(), scan: answeredFor });

  async function deliver(feedback: ParcelFeedback, first = true): Promise<boolean> {
    try {
      await send({ ...feedback, app: 'web', locale });
      if (first) trackAction(ACTIONS[feedback.answer], 'success');
      remember(scan);
      return true;
    } catch {
      if (first) trackAction(ACTIONS[feedback.answer], 'error');
      return false;
    }
  }

  useEffect(() => {
    if (!word) return;
    const timer = setTimeout(() => setWord((current) => current === word ? null : current), word.say === 'back' ? BACK_MS : WORD_MS);
    return () => clearTimeout(timer);
  }, [word]);

  // On the way back from the carrier's own site, the reader has just seen what it says.
  const away = useRef<{ site: string; left: number | null } | null>(null);
  const askable = kind === 'found' && !busy && !open && (moment === 'ask' || moment === 'reasons');
  useEffect(() => {
    const seen = () => {
      const visit = away.current;
      if (!visit) return;
      if (document.hidden) {
        visit.left ??= Date.now();
        return;
      }
      if (visit.left === null) return;
      away.current = null;
      if (!askable || Date.now() - visit.left < AWAY_MS || !asksOnReturn(notes.read(), scan)) return;
      notes.write({ ...notes.read(), back: scan });
      setWord({ say: 'back', site: visit.site });
    };
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, [askable, notes, scan]);

  return {
    kind,
    carrier,
    shown: kind !== null && (moment !== 'ask' || asksFeedback(remembered.memory, scan, remembered.at)),
    moment,
    open,
    word,
    place,
    visited(site) {
      if (kind === 'found') away.current = { site, left: null };
    },
    right(asked) {
      go('right');
      setWord(asked === 'back' ? { say: 'back-right' } : null);
      void deliver({ id: crypto.randomUUID(), answer: 'right', asked }).then((sent) => {
        if (sent) return;
        go('ask');
        setWord({ say: 'failed' });
      });
    },
    notQuite: () => go('reasons'),
    pick(reason) {
      const answer = { id: crypto.randomUUID(), reasons: [reason] };
      given.current = answer;
      go('sent');
      void deliver({ ...answer, answer: 'wrong', asked: 'page' }).then((sent) => {
        if (sent) return;
        go('reasons');
        setWord({ say: 'failed' });
      });
    },
    addNote() {
      if (given.current) setOpen({ sheet: 'wrong', ...given.current, asked: 'page' });
    },
    wrongOnReturn() {
      // The question at the edge of the screen leaves with its buttons: the sheet returns to the standing one.
      place.current?.focus({ preventScroll: true });
      setWord(null);
      setOpen({ sheet: 'wrong', id: crypto.randomUUID(), reasons: [], asked: 'back' });
    },
    elsewhere: () => setOpen({ sheet: 'carrier' }),
    notYet() {
      // Nothing to send: tomorrow the carrier's site may show it.
      notes.write({ ...notes.read(), at: new Date().toISOString(), scan: '' });
      go('early');
    },
    async sendWords(reasons, note) {
      if (open?.sheet !== 'wrong') return false;
      const words = note.trim();
      const sent = await deliver({ id: open.id, answer: 'wrong', reasons: [...reasons], ...(words ? { note: words } : {}), asked: open.asked }, open.asked === 'back');
      if (!sent) return false;
      after.current = 'noted';
      if (open.asked === 'back') setWord({ say: 'back-sent' });
      return true;
    },
    async sendCarrier(name, page) {
      const [who, where] = [name.trim(), page.trim()];
      const sent = await deliver({
        id: crypto.randomUUID(), answer: 'found_elsewhere', ...(who ? { carrierName: who } : {}), ...(where ? { trackingPage: where } : {}), asked: 'page',
      });
      if (sent) after.current = 'named';
      return sent;
    },
    close() {
      setOpen(null);
      const next = after.current;
      after.current = null;
      if (next) setTimeout(() => go(next));
    },
  };
}

function Answers({ yes, no, onYes, onNo }: { yes: string; no: string; onYes: () => void; onNo: () => void }) {
  return <span className="peekfb-answers">
    <button type="button" className="peekfb-pill" onClick={onYes}>{yes}</button>
    <button type="button" className="peekfb-pill" onClick={onNo}>{no}</button>
  </span>;
}

function Said({ children }: { children: ReactNode }) {
  return <p className="peekfb-said" role="status"><Icon name="check" />{children}</p>;
}

/** The standing question, where the history ends: Pip's for a parcel a carrier answers for, a row for one none was found for. */
export function FeedbackQuestion({ feedback }: { feedback: ParcelFeedbackState }) {
  const { t } = useI18n();
  const { kind, moment, place } = feedback;
  // An answer replaces the buttons it was given with: the focus stays where the reader was, and what follows is in view.
  const answered = useRef(moment);
  useEffect(() => {
    if (answered.current === moment) return;
    answered.current = moment;
    const element = place.current;
    element?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [moment, place]);
  if (!feedback.shown || !kind) return null;

  if (kind === 'unknown') {
    return <div ref={place} className="peekfb-ask" data-moment={moment} tabIndex={-1}>
      {moment === 'early' ? <Said>{t('feedback.unknown.early')}</Said>
        : moment === 'named' ? <Said>{t('feedback.unknown.sent')}</Said>
          : <>
            <p className="peekfb-question">{t('feedback.unknown.question')}</p>
            <Answers yes={t('feedback.yes')} no={t('feedback.unknown.notYet')} onYes={feedback.elsewhere} onNo={feedback.notYet} />
          </>}
    </div>;
  }
  return <div className="peekfb-pip" data-moment={moment}>
    <SmallPip />
    <div ref={place} className="peekfb-bubble" tabIndex={-1}>
      {moment === 'right' ? <Said>{t('feedback.pip.right')}</Said>
        : moment === 'sent' || moment === 'noted' ? <>
          <Said>{t('feedback.pip.sent')}</Said>
          {moment === 'sent' && <button type="button" className="peekfb-beside" onClick={feedback.addNote}>{t('feedback.addNote')}</button>}
        </> : moment === 'reasons' ? <>
          <p className="peekfb-question">{t('feedback.whatsOff')}</p>
          <span className="peekfb-chips">
            {FEEDBACK_REASONS.map((reason) => <button key={reason} type="button" className="peekfb-pill" onClick={() => feedback.pick(reason)}>{t(REASON_KEYS[reason])}</button>)}
          </span>
        </> : <>
          <p className="peekfb-question">{t('feedback.pip.question')}</p>
          <Answers yes={t('feedback.yes')} no={t('feedback.notQuite')} onYes={() => feedback.right('page')} onNo={feedback.notQuite} />
        </>}
    </div>
  </div>;
}

function WrongSheet({ feedback, initial, dismiss }: { feedback: ParcelFeedbackState; initial: readonly ApiParcelFeedbackReason[]; dismiss: () => void }) {
  const { t } = useI18n();
  const field = useId();
  const [picked, setPicked] = useState(initial);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const toggle = (reason: ApiParcelFeedbackReason) => setPicked((current) => current.includes(reason) ? current.filter((one) => one !== reason) : [...current, reason]);
  async function send() {
    setSending(true);
    setFailed(false);
    if (await feedback.sendWords(picked, note)) dismiss();
    else {
      setFailed(true);
      setSending(false);
    }
  }
  return <>
    <div className="peekfb-chips">
      {FEEDBACK_REASONS.map((reason) => <button key={reason} type="button" className="peekfb-chip" aria-pressed={picked.includes(reason)} onClick={() => toggle(reason)}>{t(REASON_KEYS[reason])}</button>)}
    </div>
    <div className="peekfb-field">
      <label htmlFor={field}>{t('feedback.note')}</label>
      <textarea id={field} rows={2} maxLength={NOTE_LIMIT} value={note} onChange={(event) => setNote(event.target.value)} />
    </div>
    {failed && <p className="sheet__error" role="alert">{t('feedback.failed')}</p>}
    <div className="peeks__actions">
      <button type="button" className="button button--primary" disabled={sending || (!picked.length && !note.trim())} onClick={() => void send()}>
        {t(sending ? 'feedback.sending' : 'feedback.send')}
      </button>
    </div>
    <p className="peeks__promise">{t('feedback.promise', { carrier: feedback.carrier })}</p>
  </>;
}

function CarrierSheet({ feedback, dismiss }: { feedback: ParcelFeedbackState; dismiss: () => void }) {
  const { t } = useI18n();
  const field = useId();
  const [who, setWho] = useState('');
  const [where, setWhere] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function send() {
    setSending(true);
    setFailed(false);
    if (await feedback.sendCarrier(who, where)) dismiss();
    else {
      setFailed(true);
      setSending(false);
    }
  }
  return <form onSubmit={(event) => { event.preventDefault(); if (!sending && (who.trim() || where.trim())) void send(); }}>
    <div className="peekfb-field peekfb-field--first">
      <label htmlFor={`${field}-who`}>{t('feedback.unknown.who')}</label>
      <input id={`${field}-who`} type="text" maxLength={CARRIER_LIMIT} value={who} onChange={(event) => setWho(event.target.value)} autoComplete="off" />
    </div>
    <div className="peekfb-field">
      <label htmlFor={`${field}-where`}>{t('feedback.unknown.where')}</label>
      {/* An address as the reader has it, with or without its scheme: it is read by a person, never opened. */}
      <input id={`${field}-where`} type="text" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={PAGE_LIMIT}
        value={where} onChange={(event) => setWhere(event.target.value)} autoComplete="off" />
    </div>
    {failed && <p className="sheet__error" role="alert">{t('feedback.failed')}</p>}
    <div className="peeks__actions">
      <button type="submit" className="button button--primary" disabled={sending || (!who.trim() && !where.trim())}>
        {t(sending ? 'feedback.sending' : 'feedback.send')}
      </button>
    </div>
    <p className="peeks__promise">{t('feedback.unknown.promise')}</p>
  </form>;
}

/** What lies over the page: the question asked on the way back, the sheets, and the words that follow them. */
export function FeedbackOverlays({ feedback }: { feedback: ParcelFeedbackState }) {
  const { t } = useI18n();
  const { open, word } = feedback;
  return <>
    {word?.say === 'back' && !open && <Toast mark={<Icon name="arrow" />} action={<span className="peekfb-toastanswers">
      <button type="button" onClick={() => feedback.right('back')}>{t('feedback.yes')}</button>
      <button type="button" onClick={feedback.wrongOnReturn}>{t('feedback.no')}</button>
    </span>}>
      <strong>{t('feedback.back.question', { site: word.site })}</strong>
    </Toast>}
    {word?.say === 'back-right' && <Toast>{t('feedback.back.right')}</Toast>}
    {word?.say === 'back-sent' && <Toast>{t('feedback.back.sent')}</Toast>}
    {word?.say === 'failed' && <Toast mark={<Glyph name="info" />}>{t('feedback.failed')}</Toast>}
    {open?.sheet === 'wrong' && <Sheet title={t('feedback.whatsOff')} className="peekfb-sheet" onClose={feedback.close}>
      {(dismiss) => <WrongSheet feedback={feedback} initial={open.reasons} dismiss={dismiss} />}
    </Sheet>}
    {open?.sheet === 'carrier' && <Sheet title={t('feedback.unknown.title')} className="peekfb-sheet" onClose={feedback.close}>
      {(dismiss) => <CarrierSheet feedback={feedback} dismiss={dismiss} />}
    </Sheet>}
  </>;
}
