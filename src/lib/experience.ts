import { trackAction } from './analytics';
import { useSyncExternalStore } from 'react';

export type EntryScreen = 'welcome' | 'sign-in' | 'demo';
export const EXPERIENCE_STORAGE_KEY = 'sdt.web.experience.v1'; // gitleaks:allow -- public localStorage preference name
const eventName = 'delivery-experience-change';
let memoryScreen: EntryScreen | null = null;
function read(): EntryScreen {
  try {
    const value = localStorage.getItem(EXPERIENCE_STORAGE_KEY);
    if (value === 'sign-in' || value === 'demo') return value;
  } catch { return memoryScreen ?? 'welcome'; }
  return 'welcome';
}
function subscribe(notify: () => void) {
  const onStorage = () => { memoryScreen = null; notify(); };
  window.addEventListener(eventName, notify);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(eventName, notify);
    window.removeEventListener('storage', onStorage);
  };
}
function serverSnapshot(): EntryScreen { return 'welcome'; }

function navigate(next: EntryScreen) {
  if (next === 'demo') trackAction('demo-start');
  else if (read() === 'demo') trackAction('demo-exit');
  if (read() === 'demo' && next !== 'demo') {
    const url = new URL(window.location.href);
    url.searchParams.delete('parcel');
    url.searchParams.delete('view');
    const state = { ...window.history.state };
    delete state.parcelPostDetail;
    window.history.replaceState(state, '', `${url.pathname}${url.search}${url.hash}`);
  }
  memoryScreen = next;
  try { localStorage.setItem(EXPERIENCE_STORAGE_KEY, next); } catch { /* Keep the session working. */ }
  window.dispatchEvent(new Event(eventName));
}

export function useEntryExperience() {
  const screen = useSyncExternalStore(subscribe, read, serverSnapshot);
  return { screen, navigate };
}
