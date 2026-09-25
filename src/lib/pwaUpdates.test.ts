import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canReplacePage,
  checkForUpdatesOnResume,
  enablePwaLiveReload,
  registerPwaServiceWorker,
  rememberScreen,
  takeResumedScreen,
} from './pwaUpdates';

function serviceWorker(controller: object | null) {
  let listener: (() => void) | undefined;
  return {
    source: {
      controller,
      addEventListener: vi.fn((_event: string, next: EventListenerOrEventListenerObject) => {
        listener = next as () => void;
      }),
      removeEventListener: vi.fn(),
    } as unknown as ServiceWorkerContainer,
    changeController: () => listener?.(),
  };
}

function page(visibilityState: DocumentVisibilityState = 'visible') {
  const target = new EventTarget();
  const state = {
    visibilityState,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
  return {
    source: state as unknown as Document,
    show: () => { state.visibilityState = 'visible'; target.dispatchEvent(new Event('visibilitychange')); },
    hide: () => { state.visibilityState = 'hidden'; target.dispatchEvent(new Event('visibilitychange')); },
    input: (type = 'pointerdown') => target.dispatchEvent(new Event(type)),
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('enablePwaLiveReload', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('switches an open app once it has been left alone on a screen it can restore', () => {
    const worker = serviceWorker({});
    const reload = vi.fn();
    const remember = vi.fn();
    const canReplace = vi.fn(() => true);
    const cleanup = enablePwaLiveReload({ reload, remember, canReplace, serviceWorker: worker.source, page: page('visible').source });

    worker.changeController();
    vi.advanceTimersByTime(2_000);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(canReplace).toHaveBeenLastCalledWith(true);
    expect(remember).toHaveBeenCalledOnce();
    expect(remember.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]!);
    expect(reload).toHaveBeenCalledOnce();

    worker.changeController();
    vi.advanceTimersByTime(10_000);
    expect(reload).toHaveBeenCalledOnce();
    cleanup();
    expect(worker.source.removeEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
  });

  it('waits while someone is tapping, typing or scrolling', () => {
    const worker = serviceWorker({});
    const visibility = page('visible');
    const reload = vi.fn();
    enablePwaLiveReload({ reload, remember: vi.fn(), canReplace: () => true, serviceWorker: worker.source, page: visibility.source });

    worker.changeController();
    for (const type of ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart']) {
      vi.advanceTimersByTime(2_000);
      visibility.input(type);
    }
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3_000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('waits for sign-in, sheets, dialogs and typing to finish', () => {
    const worker = serviceWorker({});
    const reload = vi.fn();
    let replaceable = false;
    enablePwaLiveReload({ reload, remember: vi.fn(), canReplace: () => replaceable, serviceWorker: worker.source, page: page('visible').source });

    worker.changeController();
    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();
    replaceable = true;
    vi.advanceTimersByTime(1_000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('switches a hidden app at once, or as soon as it is put away', () => {
    const hidden = serviceWorker({});
    const reloadHidden = vi.fn();
    enablePwaLiveReload({ reload: reloadHidden, remember: vi.fn(), canReplace: () => true, serviceWorker: hidden.source, page: page('hidden').source });
    hidden.changeController();
    expect(reloadHidden).toHaveBeenCalledOnce();

    const open = serviceWorker({});
    const visibility = page('visible');
    const reloadOpen = vi.fn();
    const canReplace = vi.fn(() => true);
    enablePwaLiveReload({ reload: reloadOpen, remember: vi.fn(), canReplace, serviceWorker: open.source, page: visibility.source });
    open.changeController();
    visibility.input();
    visibility.hide();
    expect(canReplace).toHaveBeenLastCalledWith(false);
    expect(reloadOpen).toHaveBeenCalledOnce();
  });

  it('does not reload on first installation but applies the next upgrade', () => {
    const worker = serviceWorker(null);
    const reload = vi.fn();
    enablePwaLiveReload({ reload, remember: vi.fn(), canReplace: () => true, serviceWorker: worker.source, page: page('hidden').source });

    worker.changeController();
    expect(reload).not.toHaveBeenCalled();
    worker.changeController();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('is inert when service workers are unsupported', () => {
    const cleanup = enablePwaLiveReload({ serviceWorker: null });
    expect(cleanup()).toBeUndefined();
  });
});

describe('canReplacePage', () => {
  it('allows the app with a parcel open and nothing in progress', () => {
    document.body.innerHTML = '<div class="app"><input type="search" value=""><input type="checkbox" checked></div>'
      + '<div class="sheet-backdrop"><div class="detail" role="dialog" aria-modal="true"><button aria-busy="false"></button>'
      + '<details class="tracking-journal" open><summary>History</summary></details></div></div>';
    expect(canReplacePage(true)).toBe(true);
  });

  it('keeps sign-in, sheets, dialogs, work in progress and typed text', () => {
    const blocked = [
      '<main class="arrival"><form><input value=""></form></main>',
      '<div class="app"></div><div role="dialog" aria-modal="true"></div>',
      '<div class="app"><dialog open></dialog></div>',
      '<div class="app"><details open><summary>Archived</summary></details></div>',
      '<div class="app"><button aria-busy="true"></button></div>',
      '<div class="app"></div><div class="undo-toast"></div>',
      '<div class="app"></div><div class="action-toast"></div>',
      '<div class="app"><div id="parcel-view-controls"></div></div>',
      '<div class="app"><input type="search" value="coffee"></div>',
    ];
    for (const markup of blocked) {
      document.body.innerHTML = markup;
      expect(canReplacePage(false), markup).toBe(false);
    }
  });

  it('replaces the Friends tab only while the app is put away', () => {
    document.body.innerHTML = '<div class="app"><div class="friends-page"></div></div>';
    expect(canReplacePage(true)).toBe(false);
    expect(canReplacePage(false)).toBe(true);
  });
});

describe('resumed screen', () => {
  it('brings back the scroll positions once, for the same address', () => {
    window.history.replaceState(null, '', '/?parcel=parcel-1');
    document.body.innerHTML = '<div class="detail"></div>';
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 });
    document.querySelector<HTMLElement>('.detail')!.scrollTop = 120;
    try {
      rememberScreen();
    } finally {
      delete (window as { scrollY?: number }).scrollY;
    }

    expect(takeResumedScreen()).toMatchObject({ top: 640 });
    expect(takeResumedScreen()).toBeNull();
  });

  it('ignores a screen saved for another address or long ago', () => {
    window.history.replaceState(null, '', '/?view=passport');
    rememberScreen();
    window.history.replaceState(null, '', '/');
    expect(takeResumedScreen()).toBeNull();

    vi.useFakeTimers();
    try {
      rememberScreen();
      vi.advanceTimersByTime(31_000);
      expect(takeResumedScreen()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('checkForUpdatesOnResume', () => {
  it('asks for a new build when a long-open app returns', () => {
    let time = 0;
    const visibility = page('visible');
    const update = vi.fn().mockResolvedValue(undefined);
    const cleanup = checkForUpdatesOnResume({ update }, visibility.source, 60_000, () => time);

    time = 30_000;
    visibility.hide();
    visibility.show();
    expect(update).not.toHaveBeenCalled();

    time = 61_000;
    visibility.hide();
    expect(update).not.toHaveBeenCalled();
    visibility.show();
    visibility.hide();
    visibility.show();
    expect(update).toHaveBeenCalledTimes(1);

    cleanup();
    time = 200_000;
    visibility.show();
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('registerPwaServiceWorker', () => {
  it('registers the root worker with update caching disabled', async () => {
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);

    await expect(registerPwaServiceWorker({ register })).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
  });

  it('is inert when service workers are unsupported', async () => {
    await expect(registerPwaServiceWorker(null)).resolves.toBeNull();
  });
});
