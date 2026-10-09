/**
 * The text typed into a carrier's page's box, on its way to the tracker. A
 * tracking number never goes into an address, so the box notes it for this
 * tab and opens the landing, which takes the note once and looks it up.
 */
export const CARRIER_HANDOFF_STORAGE_KEY = 'sdt.peek.carrierHandoff.v1'; // gitleaks:allow -- sessionStorage name, not a credential
// A note this old was left by a landing that never opened: it is not looked up on a later visit.
const MAX_AGE_MS = 10 * 60_000;
// The most the landing's field is handed, as from the share sheet.
const MAX_LENGTH = 10_000;

/** Notes the typed text for the landing. Without session storage the landing opens with its field empty. */
export function writeCarrierHandoff(text: string, now = Date.now()): void {
  try {
    window.sessionStorage.setItem(CARRIER_HANDOFF_STORAGE_KEY, JSON.stringify({ text: text.trim().slice(0, MAX_LENGTH), at: now }));
  } catch { /* The landing opens anyway, and the number can be typed again. */ }
}

/** The text a carrier's page handed over a moment ago, once: the note is dropped whether it is used or not. */
export function takeCarrierHandoff(now = Date.now()): string | null {
  try {
    const written = window.sessionStorage.getItem(CARRIER_HANDOFF_STORAGE_KEY);
    if (written === null) return null;
    window.sessionStorage.removeItem(CARRIER_HANDOFF_STORAGE_KEY);
    const note = JSON.parse(written) as { text?: unknown; at?: unknown } | null;
    const age = now - Number(note?.at);
    if (typeof note?.text !== 'string' || !note.text.trim() || !(age >= 0 && age < MAX_AGE_MS)) return null;
    return note.text.trim().slice(0, MAX_LENGTH);
  } catch {
    return null;
  }
}
