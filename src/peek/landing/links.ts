import { DEMO_PATH } from '../../lib/experience';

/** Where the code lives. */
export const SOURCE_URL = 'https://github.com/plhery/delivery-tracker';

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

/** Opens the sample parcels at their own address, without leaving the page. Back returns to where the visitor was. */
export function openDemo(): void {
  window.history.pushState(null, '', DEMO_PATH);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
