type ServiceWorkerReloadSource = Pick<
  ServiceWorkerContainer,
  'controller' | 'addEventListener' | 'removeEventListener'
>;

type ServiceWorkerRegistrationSource = Pick<ServiceWorkerContainer, 'register'>;

type PageVisibility = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

const RESUME_KEY = 'sdt.update-resume.v1';
const RESUME_WINDOW_MS = 30_000;
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

/** Register the production worker without allowing an HTTP cache to pin an old build. */
export async function registerPwaServiceWorker(
  serviceWorker: ServiceWorkerRegistrationSource | null =
    ('serviceWorker' in navigator ? navigator.serviceWorker : null),
): Promise<ServiceWorkerRegistration | null> {
  if (!serviceWorker) return null;
  return await serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  });
}

// Screen state a reload would lose that the address does not keep: open sheets
// and dialogs, sections someone expanded, work in progress, undo and search
// controls. A parcel's detail is in the address, so it reopens, and its
// tracking history starts expanded anyway.
const KEEPS_STATE = [
  '[aria-modal="true"]:not(.detail)',
  'dialog[open]',
  'details[open]:not(.tracking-journal)',
  '[aria-busy="true"]',
  '.undo-toast',
  '.action-toast',
  '.parcel-added-burst',
  '#parcel-view-controls',
].join(', ');

/**
 * Whether a reload brings back the same screen: the app, rather than sign-in,
 * with nothing open, in progress or typed. Friend cards load from the network,
 * so an open Friends tab is only replaced while the app is put away.
 */
export function canReplacePage(visible = false, root: ParentNode = document): boolean {
  if (!root.querySelector('.app') || root.querySelector(KEEPS_STATE)) return false;
  if (visible && root.querySelector('.friends-page')) return false;
  return !Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
    .some((field) => !['hidden', 'checkbox', 'radio'].includes(field.type) && field.value.trim() !== '');
}

export interface ResumedScreen { top: number; detailTop: number }

/** Remember where the page and an open parcel were scrolled, for the reload that follows. */
export function rememberScreen(): void {
  try {
    const detail = document.querySelector<HTMLElement>('.detail');
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({
      href: window.location.href,
      top: window.scrollY,
      detailTop: detail?.scrollTop ?? 0,
      at: Date.now(),
    }));
  } catch {
    // Without session storage the reload still keeps the address.
  }
}

/** The screen an update reload left, once, when this page is that reload. */
export function takeResumedScreen(): ResumedScreen | null {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? 'null');
    sessionStorage.removeItem(RESUME_KEY);
    if (!saved || typeof saved !== 'object') return null;
    const { href, top, detailTop, at } = saved as Record<string, unknown>;
    if (href !== window.location.href || typeof at !== 'number' || Date.now() - at > RESUME_WINDOW_MS) return null;
    return {
      top: typeof top === 'number' ? top : 0,
      detailTop: typeof detailTop === 'number' ? detailTop : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Switch the open app to an activated upgrade without losing its place. The
 * new worker already serves every later request, and the current build loaded
 * all of its code at start, so the switch waits for a moment when a reload
 * brings back the same screen: at once while the app is put away, otherwise
 * after a few seconds without input. The reload keeps the address and the
 * scroll positions.
 */
export function enablePwaLiveReload({
  reload = () => window.location.reload(),
  serviceWorker = 'serviceWorker' in navigator ? navigator.serviceWorker : null,
  page = document,
  canReplace = canReplacePage,
  remember = rememberScreen,
  idleMs = 3_000,
  checkMs = 1_000,
}: {
  reload?: () => void;
  serviceWorker?: ServiceWorkerReloadSource | null;
  page?: PageVisibility;
  canReplace?: (visible: boolean) => boolean;
  remember?: () => void;
  idleMs?: number;
  checkMs?: number;
} = {}): () => void {
  if (!serviceWorker) return () => undefined;

  let hasController = Boolean(serviceWorker.controller);
  let upgraded = false;
  let isReloading = false;
  let lastInput = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stopChecking = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const applyUpgrade = () => {
    if (!upgraded || isReloading) return;
    const visible = page.visibilityState === 'visible';
    if (visible && Date.now() - lastInput < idleMs) return;
    if (!canReplace(visible)) return;
    isReloading = true;
    stopChecking();
    remember();
    reload();
  };

  const noteInput = () => { lastInput = Date.now(); };

  const handleControllerChange = () => {
    // The first controller change is installation, not an upgrade. Reloading
    // here would make a first-time visitor refresh immediately after opening.
    if (!hasController) {
      hasController = true;
      return;
    }
    upgraded = true;
    applyUpgrade();
    if (!isReloading && timer === null) timer = setInterval(applyUpgrade, checkMs);
  };

  serviceWorker.addEventListener('controllerchange', handleControllerChange);
  page.addEventListener('visibilitychange', applyUpgrade);
  for (const type of INPUT_EVENTS) page.addEventListener(type, noteInput, { capture: true, passive: true });
  return () => {
    stopChecking();
    serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    page.removeEventListener('visibilitychange', applyUpgrade);
    for (const type of INPUT_EVENTS) page.removeEventListener(type, noteInput, { capture: true });
  };
}

/** A long-lived page never navigates, so ask for a new build when it returns. */
export function checkForUpdatesOnResume(
  registration: Pick<ServiceWorkerRegistration, 'update'>,
  page: PageVisibility = document,
  interval = 60 * 60_000,
  now: () => number = Date.now,
): () => void {
  let checkedAt = now();
  const check = () => {
    if (page.visibilityState !== 'visible' || now() - checkedAt < interval) return;
    checkedAt = now();
    void registration.update().catch(() => undefined);
  };
  page.addEventListener('visibilitychange', check);
  return () => page.removeEventListener('visibilitychange', check);
}
