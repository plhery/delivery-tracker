import { useEffect, useSyncExternalStore } from 'react';
import { loadWorld, onWorldLoaded, worldLoaded } from './world';

// The shapes themselves need no React and live in `world.ts`, where the server reads them too.
export * from './world';

/** True once the map data is ready; asks for it when `wanted`. */
export function useWorld(wanted = true): boolean {
  const ready = useSyncExternalStore(onWorldLoaded, worldLoaded, () => false);
  useEffect(() => {
    if (wanted) loadWorld().catch(() => {});
  }, [wanted]);
  return ready;
}
