import { render, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RECENTS_STORAGE_KEY } from '../peek/recents';
import { useEntryHint } from './entryHint';
import { ENTRY_HINT_BOOTSTRAP, ENTRY_HINT_KEYS, ENTRY_HINT_LANDING_PATHS } from './entryHintConfig';
import { EXPERIENCE_STORAGE_KEY, isLandingPath, LANDING_PATH } from './experience';

const root = document.documentElement;
/** Runs the script as the page does, before anything is drawn. */
const bootstrap = () => { new Function(ENTRY_HINT_BOOTSTRAP)(); return root.dataset.entry; };
const SESSION_KEY = 'sb-project-auth-token';

function Probe({ settled }: { settled: boolean }) {
  return <p>{useEntryHint(settled) ?? 'none'}</p>;
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); delete root.dataset.entry; history.replaceState(null, '', '/'); });
afterEach(() => { localStorage.clear(); sessionStorage.clear(); delete root.dataset.entry; history.replaceState(null, '', '/'); });

describe('the entry hint script', () => {
  it('reads the names the page’s own stores write, and the landing’s addresses as the page routes them', () => {
    expect(ENTRY_HINT_KEYS).toEqual({ experience: EXPERIENCE_STORAGE_KEY, deviceParcels: RECENTS_STORAGE_KEY });
    expect(ENTRY_HINT_LANDING_PATHS).toEqual([LANDING_PATH, '/de', '/fr', '/it', '/es', '/pt', '/pl']);
    for (const path of ENTRY_HINT_LANDING_PATHS) expect(isLandingPath(path), path).toBe(true);
  });

  it('marks nothing for a first visit', () => {
    expect(bootstrap()).toBeUndefined();
  });

  it('marks a browser that holds a sign-in, unless it signed out', () => {
    localStorage.setItem(SESSION_KEY, '{"access_token":"a"}');
    expect(bootstrap()).toBe('app');
    delete root.dataset.entry;
    localStorage.setItem(`${SESSION_KEY}.signed-out`, 'true');
    expect(bootstrap()).toBeUndefined();
    // What a sign-in leaves beside its session is no session.
    localStorage.clear();
    localStorage.setItem(`${SESSION_KEY}-code-verifier`, 'verifier');
    expect(bootstrap()).toBeUndefined();
  });

  it('marks a sign-in on its way back from a provider or a link', () => {
    history.replaceState(null, '', '/?code=abc');
    expect(bootstrap()).toBe('app');
    delete root.dataset.entry;
    history.replaceState(null, '', '/#access_token=abc');
    expect(bootstrap()).toBe('app');
    delete root.dataset.entry;
    history.replaceState(null, '', '/?parcel=p1');
    expect(bootstrap()).toBeUndefined();
  });

  it('marks an open demo, and the sign-in step of this tab', () => {
    localStorage.setItem(EXPERIENCE_STORAGE_KEY, 'demo');
    expect(bootstrap()).toBe('app');
    delete root.dataset.entry;
    localStorage.setItem(EXPERIENCE_STORAGE_KEY, 'welcome');
    expect(bootstrap()).toBeUndefined();
    sessionStorage.setItem(EXPERIENCE_STORAGE_KEY, 'sign-in');
    expect(bootstrap()).toBe('app');
    delete root.dataset.entry;
    // A sign-in step another tab left behind is not this tab's.
    sessionStorage.clear();
    localStorage.setItem(EXPERIENCE_STORAGE_KEY, 'sign-in');
    expect(bootstrap()).toBeUndefined();
  });

  it('marks a visitor with parcels on this device, and a sign-in before that', () => {
    localStorage.setItem(RECENTS_STORAGE_KEY, '[]');
    expect(bootstrap()).toBeUndefined();
    localStorage.setItem(RECENTS_STORAGE_KEY, '[{"id":"k7Qm2xHd9RtW"}]');
    expect(bootstrap()).toBe('device');
    delete root.dataset.entry;
    localStorage.setItem(SESSION_KEY, '{"access_token":"a"}');
    expect(bootstrap()).toBe('app');
  });

  it.each(ENTRY_HINT_LANDING_PATHS)('hides only the way to sign in at %s, where the landing shows to a saved sign-in too', (path) => {
    history.replaceState(null, '', path);
    expect(bootstrap()).toBeUndefined();
    // The address shows the landing whatever else this browser remembers.
    localStorage.setItem(EXPERIENCE_STORAGE_KEY, 'demo');
    sessionStorage.setItem(EXPERIENCE_STORAGE_KEY, 'sign-in');
    expect(bootstrap()).toBeUndefined();
    localStorage.setItem(RECENTS_STORAGE_KEY, '[{"id":"k7Qm2xHd9RtW"}]');
    expect(bootstrap()).toBe('device');
    delete root.dataset.entry;
    localStorage.setItem(SESSION_KEY, '{"access_token":"a"}');
    expect(bootstrap()).toBe('account');
    delete root.dataset.entry;
    localStorage.setItem(`${SESSION_KEY}.signed-out`, 'true');
    expect(bootstrap()).toBe('device');
  });

  it('leaves every other address alone', () => {
    localStorage.setItem(SESSION_KEY, '{"access_token":"a"}');
    for (const path of ['/p/k7Qm2xHd9RtW', '/demo', '/en', '/de/more', '/home/more', '/xde', '/xx']) {
      history.replaceState(null, '', path);
      expect(bootstrap(), path).toBeUndefined();
    }
  });

  it('marks nothing where storage cannot be read', () => {
    const storage = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    try { expect(bootstrap()).toBeUndefined(); } finally { Object.defineProperty(window, 'localStorage', storage); }
  });
});

describe('useEntryHint', () => {
  it('knows nothing on the server', () => {
    root.dataset.entry = 'app';
    expect(renderToString(<Probe settled={false} />)).toContain('none');
  });

  it('gives the mark while the page finds out who is looking, and removes it once it knows', () => {
    root.dataset.entry = 'app';
    const view = render(<Probe settled={false} />);
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(root.dataset.entry).toBe('app');
    view.rerender(<Probe settled />);
    expect(root.dataset.entry).toBeUndefined();
  });

  it('keeps the landing’s own mark until the page knows who is looking', () => {
    root.dataset.entry = 'account';
    const view = render(<Probe settled={false} />);
    expect(screen.getByText('account')).toBeInTheDocument();
    expect(root.dataset.entry).toBe('account');
    view.rerender(<Probe settled />);
    expect(root.dataset.entry).toBeUndefined();
  });

  it('removes a visitor’s mark as soon as the page is live, without waiting for anyone', () => {
    root.dataset.entry = 'device';
    render(<Probe settled={false} />);
    expect(root.dataset.entry).toBeUndefined();
  });

  it('starts from what the server drew, then takes the mark', async () => {
    root.dataset.entry = 'app';
    const container = document.createElement('div');
    container.innerHTML = renderToString(<Probe settled={false} />);
    document.body.append(container);
    expect(container).toHaveTextContent('none');
    let hydrated: ReturnType<typeof hydrateRoot>;
    await act(async () => { hydrated = hydrateRoot(container, <Probe settled={false} />); });
    expect(container).toHaveTextContent('app');
    expect(root.dataset.entry).toBe('app');
    await act(async () => { hydrated.render(<Probe settled />); });
    expect(root.dataset.entry).toBeUndefined();
    await act(async () => { hydrated.unmount(); });
    container.remove();
  });

  it('ignores a mark it does not know', () => {
    root.dataset.entry = 'other';
    render(<Probe settled={false} />);
    expect(screen.getByText('none')).toBeInTheDocument();
  });
});
