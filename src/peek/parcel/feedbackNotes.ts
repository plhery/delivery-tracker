import { linkNote, noteLink } from '../deviceNotes';
import { feedbackMemory, type FeedbackMemory, type FeedbackNotes } from './feedbackModel';

/**
 * Where a browser remembers that it answered for a parcel. A parcel behind a
 * link keeps it with the link's other notes, so forgetting the parcel forgets
 * it; an account's parcel keeps it here, under the parcel's id.
 */
export const FEEDBACK_STORAGE_KEY = 'sdt.feedback.v1'; // gitleaks:allow -- public localStorage name
/** Only the latest parcels can still matter. */
const MAX_PARCELS = 80;

export function linkFeedbackNotes(linkId: string): FeedbackNotes {
  return {
    read: () => linkNote(linkId).feedback ?? {},
    write: (memory) => noteLink(linkId, { feedback: memory }),
  };
}

// Storage that cannot be read or written leaves the memory working for as long as the page lives.
let fallback: Record<string, FeedbackMemory> | null = null;

function stored(): Record<string, FeedbackMemory> {
  if (fallback) return fallback;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(FEEDBACK_STORAGE_KEY) ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
      .map(([id, entry]): [string, FeedbackMemory | null] => [id, feedbackMemory(entry)])
      .filter((entry): entry is [string, FeedbackMemory] => entry[1] !== null));
  } catch {
    return {};
  }
}

export function parcelFeedbackNotes(parcelId: string): FeedbackNotes {
  return {
    read: () => stored()[parcelId] ?? {},
    write(memory) {
      const others = Object.entries(stored()).filter(([id]) => id !== parcelId);
      const kept = Object.fromEntries([...others, [parcelId, memory] as const].slice(-MAX_PARCELS));
      try {
        window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(kept));
        fallback = null;
      } catch {
        fallback = kept;
      }
    },
  };
}
