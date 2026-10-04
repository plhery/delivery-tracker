import { trackAction } from './analytics';
import { useEffect, useSyncExternalStore } from 'react';
import { pathLanguage } from './locale';

export type EntryScreen = 'welcome' | 'sign-in' | 'demo';
/** One name in two stores: the browser remembers the demo, a tab its sign-in step. */
export const EXPERIENCE_STORAGE_KEY = 'sdt.web.experience.v1'; // gitleaks:allow -- public browser storage preference name
/** The demo's own address. Anyone who opens it sees the demo, with an account or without. */
export const DEMO_PATH = '/demo';
/** The landing's own address. Anyone who opens it sees the landing; at `/`, someone signed in sees their deliveries. */
export const LANDING_PATH = '/home';
/** Whether a path is an address of the landing's own: `/home`, or the landing in one language, such as `/de`. */
export const isLandingPath = (pathname: string) => pathname === LANDING_PATH || pathLanguage(pathname) !== null;
const DEMO_ARRIVAL_KEY = 'sdt.web.demo-arrival.v1'; // gitleaks:allow -- sessionStorage marker name
const eventName = 'delivery-experience-change';
let memoryScreen: EntryScreen | null = null;
const atDemoAddress = () => window.location.pathname === DEMO_PATH;
const atLandingAddress = () => isLandingPath(window.location.pathname);
/** What this browser shows at `/`, whatever address it is at. */
function remembered(): EntryScreen {
  try {
    // The sign-in step belongs to its tab: it lasts a reload and the trip to a sign-in provider, and ends with the tab.
    if (sessionStorage.getItem(EXPERIENCE_STORAGE_KEY) === 'sign-in') return 'sign-in';
    // The demo is the browser's, for the next visit too.
    if (localStorage.getItem(EXPERIENCE_STORAGE_KEY) === 'demo') return 'demo';
  } catch { return memoryScreen ?? 'welcome'; }
  return 'welcome';
}
function read(): EntryScreen {
  // The address decides before anything this browser remembers.
  if (atDemoAddress()) return 'demo';
  if (atLandingAddress()) return 'welcome';
  return remembered();
}
/** Whether `/` shows a visitor the landing in this browser: not while it has the demo or the sign-in step open. */
export const landingAtRoot = () => remembered() === 'welcome';
function subscribe(notify: () => void) {
  const onStorage = () => { memoryScreen = null; notify(); };
  window.addEventListener(eventName, notify);
  window.addEventListener('popstate', notify);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(eventName, notify);
    window.removeEventListener('popstate', notify);
    window.removeEventListener('storage', onStorage);
  };
}

function navigate(next: EntryScreen) {
  if (next === 'demo') trackAction('demo-start');
  else if (read() === 'demo') trackAction('demo-exit');
  if (read() === 'demo' && next !== 'demo') {
    const url = new URL(window.location.href);
    url.searchParams.delete('parcel');
    url.searchParams.delete('view');
    // Leaving the demo's address is leaving the demo: what follows is at `/`.
    if (atDemoAddress()) url.pathname = '/';
    const state = { ...window.history.state };
    delete state.parcelPostDetail;
    window.history.replaceState(state, '', `${url.pathname}${url.search}${url.hash}`);
    try { sessionStorage.removeItem(DEMO_ARRIVAL_KEY); } catch { /* Nothing was noted. */ }
  }
  // The landing's address shows the landing only: signing in and the demo happen at `/`.
  if (next !== 'welcome' && atLandingAddress()) window.history.pushState(null, '', '/');
  memoryScreen = next;
  try {
    if (next === 'sign-in') sessionStorage.setItem(EXPERIENCE_STORAGE_KEY, next);
    else sessionStorage.removeItem(EXPERIENCE_STORAGE_KEY);
    localStorage.setItem(EXPERIENCE_STORAGE_KEY, next === 'demo' ? next : 'welcome');
  } catch { /* Keep the session working. */ }
  window.dispatchEvent(new Event(eventName));
}

/** Someone signed in: the sign-in step is done, so signing out, here or in another tab, ends at the front door. */
export function endSignInStep() {
  if (memoryScreen === 'sign-in') memoryScreen = null;
  try { sessionStorage.removeItem(EXPERIENCE_STORAGE_KEY); } catch { /* Nothing was stored. */ }
  window.dispatchEvent(new Event(eventName));
}

/** `demoRoute` is true when the server rendered the page for the demo's address. */
export function useEntryExperience(demoRoute = false) {
  const screen = useSyncExternalStore(subscribe, read, () => demoRoute ? 'demo' : 'welcome');
  return { screen, navigate };
}

/**
 * Whether the page is at the demo's address, where the demo shows to someone
 * signed in too. Arriving there counts as starting the demo, once per tab.
 */
export function useDemoAddress(demoRoute = false): boolean {
  const here = useSyncExternalStore(subscribe, atDemoAddress, () => demoRoute);
  useEffect(() => {
    if (!here) return;
    try {
      if (sessionStorage.getItem(DEMO_ARRIVAL_KEY)) return;
      sessionStorage.setItem(DEMO_ARRIVAL_KEY, '1');
    } catch { /* Without session storage a reload counts again. */ }
    trackAction('demo-start');
  }, [here]);
  return here;
}
