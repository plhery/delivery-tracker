import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

export type Appearance = 'system' | 'light' | 'dark';
import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE } from './appearanceConfig';
export { APPEARANCE_STORAGE_KEY } from './appearanceConfig';
const eventName = 'delivery-appearance-change';

function readAppearance(): Appearance {
  try {
    const value = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch { /* Light appearance remains usable when storage is unavailable. */ }
  return DEFAULT_APPEARANCE;
}

let memoryAppearance: Appearance | null = null;
function snapshot() { return memoryAppearance ?? readAppearance(); }
function serverSnapshot(): Appearance { return DEFAULT_APPEARANCE; }
function subscribe(notify: () => void) {
  const onStorage = () => { memoryAppearance = null; notify(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener(eventName, notify);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(eventName, notify);
  };
}

export function applyAppearance(value: Appearance) {
  document.documentElement.dataset.appearance = value;
  const dark = value === 'dark' || (value === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151915' : '#F4F5F1');
}

export function useAppearance() {
  const appearance = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return [appearance, (value: Appearance) => {
    memoryAppearance = value;
    try { localStorage.setItem(APPEARANCE_STORAGE_KEY, value); } catch { /* Keep it for this session. */ }
    applyAppearance(value);
    window.dispatchEvent(new Event(eventName));
  }] as const;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance] = useAppearance();
  useEffect(() => {
    applyAppearance(appearance);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const update = () => applyAppearance(appearance);
    media?.addEventListener('change', update);
    return () => media?.removeEventListener('change', update);
  }, [appearance]);
  return children;
}
