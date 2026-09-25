import { afterEach, describe, expect, it, vi } from 'vitest';
import { canReplacePage, checkForUpdatesOnResume, enablePwaLiveReload, registerPwaServiceWorker } from './pwaUpdates';

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
  };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('enablePwaLiveReload', () => {
  it('applies an upgrade once, when the open app is next put away', () => {
    const worker = serviceWorker({});
    const visibility = page('visible');
    const reload = vi.fn();
    const cleanup = enablePwaLiveReload(reload, worker.source, visibility.source, () => true);

    worker.changeController();
    expect(reload).not.toHaveBeenCalled();
    visibility.hide();
    visibility.show();
    visibility.hide();
    worker.changeController();

    expect(reload).toHaveBeenCalledTimes(1);
    cleanup();
    expect(worker.source.removeEventListener).toHaveBeenCalledWith(
      'controllerchange',
      expect.any(Function),
    );
  });

  it('reloads a hidden app as soon as the replacement worker takes over', () => {
    const worker = serviceWorker({});
    const reload = vi.fn();
    enablePwaLiveReload(reload, worker.source, page('hidden').source, () => true);

    worker.changeController();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits while someone is signing in, typing or inside a sheet', () => {
    const worker = serviceWorker({});
    const visibility = page('visible');
    const reload = vi.fn();
    let replaceable = false;
    enablePwaLiveReload(reload, worker.source, visibility.source, () => replaceable);

    worker.changeController();
    visibility.hide();
    expect(reload).not.toHaveBeenCalled();

    visibility.show();
    replaceable = true;
    visibility.hide();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on first installation but applies the next upgrade', () => {
    const worker = serviceWorker(null);
    const reload = vi.fn();
    enablePwaLiveReload(reload, worker.source, page('hidden').source, () => true);

    worker.changeController();
    expect(reload).not.toHaveBeenCalled();
    worker.changeController();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('is inert when service workers are unsupported', () => {
    const cleanup = enablePwaLiveReload(vi.fn(), null);
    expect(cleanup()).toBeUndefined();
  });
});

describe('canReplacePage', () => {
  it('allows a main screen with nothing open or typed', () => {
    document.body.innerHTML = '<div class="app"><input type="search" value=""><input type="checkbox" checked></div>';
    expect(canReplacePage()).toBe(true);
  });

  it('keeps sign-in, open sheets, dialogs and typed text', () => {
    document.body.innerHTML = '<main class="arrival"><form><input value=""></form></main>';
    expect(canReplacePage()).toBe(false);

    document.body.innerHTML = '<div class="app"></div><div role="dialog" aria-modal="true"></div>';
    expect(canReplacePage()).toBe(false);

    document.body.innerHTML = '<div class="app"><dialog open></dialog></div>';
    expect(canReplacePage()).toBe(false);

    document.body.innerHTML = '<div class="app"><input type="search" value="coffee"></div>';
    expect(canReplacePage()).toBe(false);
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
