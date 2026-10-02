import { trackAction } from '../../lib/analytics';

export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** How sharing ended. `cancelled` is the share sheet closed without a choice: nothing to say. */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Shares a parcel's link, and only the link: through the system's share
 * sheet where there is one, else by copying it.
 */
export async function shareParcelLink(url: string): Promise<ShareOutcome> {
  let outcome: ShareOutcome | null = null;
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ url });
      outcome = 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  outcome ??= await copyText(url) ? 'copied' : 'failed';
  trackAction('parcel-link-share', outcome === 'failed' ? 'error' : 'success');
  return outcome;
}
