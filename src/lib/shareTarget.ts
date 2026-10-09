export interface SharedParcelInput {
  label: string;
  trackingInput: string;
}

/**
 * Why shared content never reached the app. The service worker cannot know the
 * reader's language, so it names the reason in the app's address and the app
 * says it.
 */
export type ShareFailure = 'too-large' | 'failed';

/** What was shared to the installed app: the text to add, or why there is none. */
export type SharedParcel = { input: SharedParcelInput } | { failure: ShareFailure };

const SHARE_MARKER = 'share-target';
/** The marker of a share whose draft is waiting for the app. */
const SHARE_RECEIVED = '1';

function shareMarker(location: Location): typeof SHARE_RECEIVED | ShareFailure | null {
  const marker = new URLSearchParams(location.search).get(SHARE_MARKER);
  return marker === SHARE_RECEIVED || marker === 'too-large' || marker === 'failed' ? marker : null;
}

/** Where the service worker sends the app after a share: to read its draft, or to say why there is none. */
export function shareTargetAddress(failure?: ShareFailure): string {
  return `/?${SHARE_MARKER}=${failure ?? SHARE_RECEIVED}`;
}

async function readDraft(): Promise<SharedParcelInput | null> {
  try {
    const response = await fetch('/share-target/draft', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object') return null;
    const draft = value as Partial<SharedParcelInput>;
    if (typeof draft.label !== 'string' || typeof draft.trackingInput !== 'string') return null;
    const trackingInput = draft.trackingInput.trim().slice(0, 10_000);
    return trackingInput ? { label: draft.label.trim().slice(0, 80), trackingInput } : null;
  } catch {
    return null;
  }
}

/**
 * What a share brought, when the address says the app was opened by one. A
 * draft that is gone or empty is a share that failed: the person shared
 * something and must hear that nothing came through.
 */
export async function readSharedParcel(
  location: Location = window.location,
): Promise<SharedParcel | null> {
  const marker = shareMarker(location);
  if (!marker) return null;
  if (marker !== SHARE_RECEIVED) return { failure: marker };
  const input = await readDraft();
  return input ? { input } : { failure: 'failed' };
}

export function clearSharedParcelInput(location: Location = window.location): void {
  if (!shareMarker(location)) return;
  const url = new URL(location.href);
  url.searchParams.delete(SHARE_MARKER);
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}
