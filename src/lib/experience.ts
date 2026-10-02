import { trackAction } from './analytics';
import { useEffect, useSyncExternalStore } from 'react';

export type EntryScreen = 'welcome' | 'sign-in' | 'demo';
export const EXPERIENCE_STORAGE_KEY = 'sdt.web.experience.v1'; // gitleaks:allow -- public localStorage preference name
/** The demo's own address. Anyone who opens it sees the demo, with an account or without. */
export const DEMO_PATH = '/demo';
const DEMO_ARRIVAL_KEY = 'sdt.web.demo-arrival.v1'; // gitleaks:allow -- sessionStorage marker name
const eventName = 'delivery-experience-change';
let memoryScreen: EntryScreen | null = null;
const atDemoAddress = () => window.location.pathname === DEMO_PATH;
function read(): EntryScreen {
  // The address decides before anything this browser remembers.
  if (atDemoAddress()) return 'demo';
  try {
    const value = localStorage.getItem(EXPERIENCE_STORAGE_KEY);
    if (value === 'sign-in' || value === 'demo') return value;
  } catch { return memoryScreen ?? 'welcome'; }
  return 'welcome';
}
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
  memoryScreen = next;
  try { localStorage.setItem(EXPERIENCE_STORAGE_KEY, next); } catch { /* Keep the session working. */ }
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
