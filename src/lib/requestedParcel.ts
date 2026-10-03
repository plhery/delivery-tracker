/**
 * A link to one of an account's parcels (`/?parcel=<id>`), opened by someone
 * who has to sign in first. Signing in with an emailed code happens on the
 * page, and the address keeps the parcel. A sign-in provider returns to `/`
 * alone, so the parcel is noted for this tab before leaving and put back in
 * the address on the way back, where the deliveries read it.
 */
export const REQUESTED_PARCEL_STORAGE_KEY = 'sdt.web.requestedParcel.v1'; // gitleaks:allow -- sessionStorage name, not a credential
const MAX_AGE_MS = 60 * 60_000;
const PARCEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Notes the parcel the address asks for. An address that asks for none drops an older note. */
export function rememberRequestedParcel(now = Date.now()): void {
  try {
    const id = window.location.pathname === '/' ? new URLSearchParams(window.location.search).get('parcel') : null;
    if (id && PARCEL_ID.test(id)) window.sessionStorage.setItem(REQUESTED_PARCEL_STORAGE_KEY, JSON.stringify({ id, at: now }));
    else window.sessionStorage.removeItem(REQUESTED_PARCEL_STORAGE_KEY);
  } catch { /* Without session storage the deliveries open without the parcel. */ }
}

/**
 * Puts the noted parcel back in the address of the deliveries and tells them,
 * once: the note is dropped whether it was used or not.
 */
export function restoreRequestedParcel(now = Date.now()): void {
  let id: string;
  try {
    const written = window.sessionStorage.getItem(REQUESTED_PARCEL_STORAGE_KEY);
    if (written === null) return;
    window.sessionStorage.removeItem(REQUESTED_PARCEL_STORAGE_KEY);
    const note = JSON.parse(written) as { id?: unknown; at?: unknown } | null;
    const age = now - Number(note?.at);
    if (typeof note?.id !== 'string' || !PARCEL_ID.test(note.id) || !(age >= 0 && age < MAX_AGE_MS)) return;
    id = note.id;
  } catch {
    return;
  }
  const url = new URL(window.location.href);
  // Only the deliveries' own address takes it, and a parcel it already names stays.
  if (url.pathname !== '/' || url.searchParams.has('parcel')) return;
  url.searchParams.set('parcel', id);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
