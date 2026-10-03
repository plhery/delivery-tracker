import type { MouseEvent } from 'react';
import { DEMO_PATH } from '../../lib/experience';

export { SOURCE_URL } from '../../lib/source';

/** Who makes Peek, on X. */
export const AUTHOR_URL = 'https://x.com/plhery';

/** A public build-time address, taken only when it is a secure link. */
export function publicLink(value: string | undefined): string | null {
  try {
    const url = new URL(value?.trim() ?? '');
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The iPhone app's page. A build that names none shows no button for it. */
export const IOS_APP_URL = publicLink(process.env.NEXT_PUBLIC_IOS_APP_URL);

/** Opens the demo deliveries at their own address, without leaving the page. Back returns to where the visitor was. */
export function openDemo(): void {
  window.history.pushState(null, '', DEMO_PATH);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** For a link to the demo deliveries: a plain click opens them in place, a modified one is left to the browser. */
export function followDemoLink(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  openDemo();
}
