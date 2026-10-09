import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Icon, SmallPip } from '../../components/Icon';
import type { ApiParcelFeedbackReason } from '../../generated/apiContract';
import { useI18n, type MessageKey } from '../../i18n';
import { trackAction } from '../../lib/analytics';
import {
  asksOnReturn,
  FEEDBACK_REASONS,
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
 * shows it. Both stand on every visit: something may happen that the reader
 * tells only later. An answer is given in place; a sheet takes the words.
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

export function useParcelFeedback({ kind, scan, carrier, busy = false, notes, send }: FeedbackSubject): ParcelFeedbackState {
  const { locale } = useI18n();
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
    // Nothing to send: tomorrow the carrier's site may show it, and the row asks again.
    notYet: () => go('early'),
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

const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
/** Out, a little past, and back. */
const SPRING = 'cubic-bezier(.34, 1.36, .64, 1)';
const SETTLE = 'cubic-bezier(.22, 1, .36, 1)';
/** Pip's moments of relief: an answer was taken. */
const HAPPY: readonly Moment[] = ['right', 'sent', 'noted'];

/**
 * The first time the question is in view, Pip hops up and what he says opens from beside him; the row rises.
 * Until then it waits out of sight, so nothing is seen to vanish and come back.
 */
function useArrival(stand: RefObject<HTMLDivElement | null>, kind: ParcelFeedbackState['kind']) {
  useLayoutEffect(() => {
    const element = stand.current;
    if (!element?.animate || still()) return;
    const pip = element.querySelector('.small-pip');
    const said = element.querySelector('.peekfb-bubble, .peekfb-ask');
    const moves = [
      pip?.animate({ opacity: [0, 1, 1], transform: ['translateY(10px) scale(.9)', 'translateY(-5px) scale(1.03)', 'none'] },
        { duration: 520, easing: SETTLE, fill: 'backwards' }),
      said?.animate(pip
        ? { opacity: [0, 1], transform: ['scale(.84)', 'none'] }
        : { opacity: [0, 1], transform: ['translateY(10px)', 'none'] }, { duration: 460, delay: pip ? 150 : 0, easing: pip ? SPRING : SETTLE, fill: 'backwards' }),
    ].filter((move): move is Animation => !!move);
    for (const move of moves) move.pause();
    const play = () => { for (const move of moves) move.play(); };
    const box = element.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) {
      play();
      return () => { for (const move of moves) move.cancel(); };
    }
    if (typeof IntersectionObserver === 'undefined') {
      for (const move of moves) move.cancel();
      return;
    }
    const watch = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      watch.disconnect();
      play();
    });
    watch.observe(element);
    return () => {
      watch.disconnect();
      for (const move of moves) move.cancel();
    };
  }, [stand, kind]);
}

/** The standing question, where the history ends: Pip's for a parcel a carrier answers for, a row for one none was found for. */
export function FeedbackQuestion({ feedback }: { feedback: ParcelFeedbackState }) {
  const { t } = useI18n();
  const { kind, moment, place } = feedback;
  const stand = useRef<HTMLDivElement>(null);
  useArrival(stand, kind);
  // What is said after an answer comes in; what the page opened on was simply there.
  const [opened, setOpened] = useState<Moment | null>(moment);
  if (opened !== null && moment !== opened) setOpened(null);
  const moved = opened === null || undefined;

  // The height the question stands at, kept as it changes, for the change an answer brings to grow from.
  const height = useRef(0);
  useLayoutEffect(() => {
    const element = place.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => { height.current = element.offsetHeight; });
    watch.observe(element);
    return () => watch.disconnect();
  }, [place, kind]);

  // An answer replaces the buttons it was given with: the bubble or the row grows or shrinks to it from where it
  // stood, the focus stays where the reader was, and what follows is in view. The focus and the scroll wait for a
  // sheet that was over the page to have handed it back.
  const answered = useRef(moment);
  useLayoutEffect(() => {
    const element = place.current;
    if (answered.current === moment || !element) return;
    const [from, to] = [height.current, element.offsetHeight];
    if (from && from !== to && element.animate && !still()) element.animate({ height: [`${from}px`, `${to}px`] }, { duration: 420, easing: SETTLE });
  }, [moment, place]);
  useEffect(() => {
    const element = place.current;
    if (answered.current === moment) return;
    answered.current = moment;
    element?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ block: 'nearest', behavior: still() ? 'auto' : 'smooth' });
  }, [moment, place]);
  if (!kind) return null;

  if (kind === 'unknown') {
    return <div ref={stand} className="peekfb">
      <div ref={place} className="peekfb-ask" data-moment={moment} tabIndex={-1}>
        <div key={moment} className="peekfb-say" data-moved={moved}>
          {moment === 'early' ? <Said>{t('feedback.unknown.early')}</Said>
            : moment === 'named' ? <Said>{t('feedback.unknown.sent')}</Said>
              : <>
                <p className="peekfb-question">{t('feedback.unknown.question')}</p>
                <Answers yes={t('feedback.yes')} no={t('feedback.unknown.notYet')} onYes={feedback.elsewhere} onNo={feedback.notYet} />
              </>}
        </div>
      </div>
    </div>;
  }
  return <div ref={stand} className="peekfb">
    <div className="peekfb-pip" data-moment={moment} data-mood={HAPPY.includes(moment) ? 'happy' : undefined}>
      <SmallPip />
      <div ref={place} className="peekfb-bubble" tabIndex={-1}>
        <div key={moment} className="peekfb-say" data-moved={moved}>
          {moment === 'right' ? <Said>{t('feedback.pip.right')}</Said>
            : moment === 'sent' || moment === 'noted' ? <>
              <Said>{t('feedback.pip.sent')}</Said>
              {moment === 'sent' && <button type="button" className="peekfb-beside" onClick={feedback.addNote}>{t('feedback.addNote')}</button>}
            </> : moment === 'reasons' ? <>
              <p className="peekfb-question">{t('feedback.whatsOff')}</p>
              <span className="peekfb-chips">
                {FEEDBACK_REASONS.map((reason, index) => <button key={reason} type="button" className="peekfb-pill" style={{ '--i': index } as CSSProperties}
                  onClick={() => feedback.pick(reason)}>{t(REASON_KEYS[reason])}</button>)}
              </span>
            </> : <>
              <p className="peekfb-question">{t('feedback.pip.question')}</p>
              <Answers yes={t('feedback.yes')} no={t('feedback.notQuite')} onYes={() => feedback.right('page')} onNo={feedback.notQuite} />
            </>}
        </div>
      </div>
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
    {/* Pip asks this one too. */}
    {word?.say === 'back' && !open && <Toast mark={<SmallPip />} action={<span className="peekfb-toastanswers">
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
