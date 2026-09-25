type ServiceWorkerReloadSource = Pick<
  ServiceWorkerContainer,
  'controller' | 'addEventListener' | 'removeEventListener'
>;

type ServiceWorkerRegistrationSource = Pick<ServiceWorkerContainer, 'register'>;

type PageVisibility = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

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

/**
 * A reload loses only what the address keeps: main screens with nothing open
 * or typed. Sign-in, sheets and dialogs finish on the build that opened them.
 */
export function canReplacePage(root: ParentNode = document): boolean {
  if (!root.querySelector('.app') || root.querySelector('[aria-modal="true"], dialog[open]')) return false;
  return !Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
    .some((field) => !['hidden', 'checkbox', 'radio'].includes(field.type) && field.value.trim() !== '');
}

/**
 * Apply an activated upgrade when the open app is next put away. The new worker
 * already serves every later request, and the current build loaded all of its
 * code at start, so it keeps working until then instead of reloading in front
 * of someone who is reading or typing.
 */
export function enablePwaLiveReload(
  reload: () => void = () => window.location.reload(),
  serviceWorker: ServiceWorkerReloadSource | null =
    ('serviceWorker' in navigator ? navigator.serviceWorker : null),
  page: PageVisibility = document,
  canReplace: () => boolean = canReplacePage,
): () => void {
  if (!serviceWorker) return () => undefined;

  let hasController = Boolean(serviceWorker.controller);
  let upgraded = false;
  let isReloading = false;

  const applyUpgrade = () => {
    if (!upgraded || isReloading || page.visibilityState !== 'hidden' || !canReplace()) return;
    isReloading = true;
    reload();
  };

  const handleControllerChange = () => {
    // The first controller change is installation, not an upgrade. Reloading
    // here would make a first-time visitor refresh immediately after opening.
    if (!hasController) {
      hasController = true;
      return;
    }
    upgraded = true;
    applyUpgrade();
  };

  serviceWorker.addEventListener('controllerchange', handleControllerChange);
  page.addEventListener('visibilitychange', applyUpgrade);
  return () => {
    serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    page.removeEventListener('visibilitychange', applyUpgrade);
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
