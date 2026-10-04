import { use, useEffect, useSyncExternalStore } from 'react';

/** How long to wait before asking again for code that could not be fetched. */
const RETRY_MS = [1_000, 3_000];
const RELOAD_KEY = 'sdt.code-reload.v1';
const RELOAD_EVERY_MS = 60_000;

/** After a deployment the page's own files may be gone: a reload brings the new page, at most once a minute. */
function reloadForNewCode(): void {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOAD_KEY)) < RELOAD_EVERY_MS) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { return; }
  window.location.reload();
}

const never = () => () => undefined;
const alive = () => false;
const arrivingFromServer = () => true;

export interface LaterCode<Code> {
  /** The code is here: every page waiting for it draws with it. A page that opens on these screens says so as it loads. */
  provide(code: Code): void;
  /** Fetches the code once. A failed fetch is forgotten, so the next call tries again. */
  load(): Promise<void>;
  /** The code, once it is here. */
  read(): Code | undefined;
  /**
   * The code, once it is here; fetched when `wanted`. A fetch that fails is
   * tried again, and when the browser comes back online; when it keeps
   * failing, `giveUp` reloads the page.
   */
  useCode(wanted: boolean, giveUp?: () => void): Code | undefined;
  /**
   * Holds the page back until the code asked for at the start is here, so a
   * browser that opens on these screens comes alive on them, as it did when
   * every page carried their code. Any other page never waits.
   */
  useEarly(): void;
}

/**
 * Screens whose code a page comes without: it is fetched when one of them is
 * about to show. A browser that `expected` says will open on them asks for
 * it as soon as the page's own code runs.
 */
export function laterCode<Code>(fetchCode: () => Promise<Code>, expected: () => boolean): LaterCode<Code> {
  let code: Code | undefined;
  let loading: Promise<void> | undefined;
  let failures = 0;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const read = () => code;

  function provide(provided: Code): void {
    code = provided;
    failures = 0;
    for (const listener of listeners) listener();
  }

  function load(): Promise<void> {
    if (code) return Promise.resolve();
    return loading ??= fetchCode().then(provide, (error: unknown) => {
      loading = undefined;
      throw error;
    });
  }

  // It never fails: a page whose code could not be fetched comes alive without it, and asks again when a screen needs it.
  const early = typeof window !== 'undefined' && expected() ? load().catch(() => undefined) : null;

  return {
    provide,
    load,
    read,
    useCode(wanted, giveUp = reloadForNewCode) {
      const loaded = useSyncExternalStore(subscribe, read, read);
      useEffect(() => {
        if (!wanted || loaded) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let stopped = false;
        const attempt = () => {
          load().catch(() => {
            if (stopped || code || navigator.onLine === false) return;
            const wait = RETRY_MS[failures++];
            if (wait === undefined) giveUp();
            else timer = setTimeout(attempt, wait);
          });
        };
        attempt();
        window.addEventListener('online', attempt);
        return () => {
          stopped = true;
          clearTimeout(timer);
          window.removeEventListener('online', attempt);
        };
      }, [wanted, loaded, giveUp]);
      return loaded;
    },
    useEarly() {
      // Only a page still coming alive is held back, with what the server drew standing in place. One that is alive
      // draws at once, and waits where its screens say.
      const arriving = useSyncExternalStore(never, alive, arrivingFromServer);
      if (early && arriving) use(early);
    },
  };
}
