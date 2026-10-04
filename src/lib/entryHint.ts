import { useLayoutEffect, useSyncExternalStore } from 'react';
import { ENTRY_HINT_ATTRIBUTE, type EntryHint } from './entryHintConfig';

const never = () => () => undefined;
const read = (): EntryHint | null => {
  const value = document.documentElement.dataset[ENTRY_HINT_ATTRIBUTE];
  return value === 'app' || value === 'account' || value === 'device' ? value : null;
};

/**
 * The hint the page was marked with before its first paint, or null: on the
 * server, while the page comes alive, and where nothing was found. `settled`
 * says the page knows who is looking: from then on what it draws is right,
 * and the mark goes. A visitor's own parcels need no such wait.
 */
export function useEntryHint(settled: boolean): EntryHint | null {
  const hint = useSyncExternalStore(never, read, () => null);
  const live = useSyncExternalStore(never, () => true, () => false);
  useLayoutEffect(() => {
    if (live && (settled || read() === 'device')) delete document.documentElement.dataset[ENTRY_HINT_ATTRIBUTE];
  }, [live, settled]);
  return hint;
}
