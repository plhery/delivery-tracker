import type { ApiParcelFeedbackReason, ApiParcelFeedbackRequest } from '../../generated/apiContract';
import { currentEvent } from '../../lib/stages';
import type { ParcelWithEvents } from '../../types';

/**
 * What a reader says of a parcel: that what is shown is right, what is off,
 * or who carries a parcel no carrier was found for. The question stands on
 * the page whenever there is something to judge, for a reader who has more to
 * say later; only the one asked on the way back from the carrier's site keeps
 * quiet about what was answered.
 */

/** An answer as the page words it; sending adds the app and the language. */
export type ParcelFeedback = Omit<ApiParcelFeedbackRequest, 'app' | 'locale'>;
export type SendParcelFeedback = (feedback: ApiParcelFeedbackRequest) => Promise<void>;

export const FEEDBACK_REASONS: readonly ApiParcelFeedbackReason[] = ['arrived', 'status', 'steps', 'time_place', 'carrier', 'other'];

/** What this browser remembers of the question, for one parcel. Nothing of it leaves the browser. */
export interface FeedbackMemory {
  /** When the reader last answered. */
  at?: string;
  /** The scan the page ended on then. */
  scan?: string;
  /** The scan the question was asked about on the way back from the carrier's site. */
  back?: string;
}

/** Where the memory of one parcel's question is kept. */
export interface FeedbackNotes {
  read(): FeedbackMemory;
  write(memory: FeedbackMemory): void;
}

const QUIET_MS = 24 * 60 * 60 * 1_000;
/** No scan to ask about: a parcel no carrier was found for, or one not scanned yet. */
const NO_SCAN = 'none';

/** What the page ends on: its newest scan, and how many it has. */
export function scanIdentity(parcel: Pick<ParcelWithEvents, 'events'>): string {
  const newest = currentEvent(parcel.events);
  return newest ? `${parcel.events.length}:${newest.occurredAt}` : NO_SCAN;
}

/**
 * Whether the question is asked on the way back from the carrier's site: once per scan, not about a scan already
 * answered for, and not within a day of an answer.
 */
export function asksOnReturn(memory: FeedbackMemory, scan: string, now = Date.now()): boolean {
  if (memory.back === scan) return false;
  return !memory.at || (memory.scan !== scan && !(now - Date.parse(memory.at) < QUIET_MS));
}

function text(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.length <= limit ? value : undefined;
}

/** A stored memory, read back: anything else is no memory. */
export function feedbackMemory(value: unknown): FeedbackMemory | null {
  if (!value || typeof value !== 'object') return null;
  const { at, scan, back } = value as Record<string, unknown>;
  const answered = text(at, 40);
  const kept: FeedbackMemory = {
    ...(answered && Number.isFinite(Date.parse(answered)) ? { at: answered, scan: text(scan, 80) ?? '' } : {}),
    ...(text(back, 80) ? { back: text(back, 80) } : {}),
  };
  return kept.at || kept.back ? kept : null;
}
