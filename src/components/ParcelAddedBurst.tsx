import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Same uneven trajectories as the native add-parcel celebration.
const parcels = [
  [-0.94, 148, -112, 26, 20], [-0.68, 242, 78, 34, 0],
  [-0.45, 186, -158, 29, 70], [-0.21, 282, 106, 37, 30],
  [0.08, 218, -72, 31, 90], [0.32, 166, 142, 25, 10],
  [0.54, 256, -128, 35, 50], [0.76, 212, 94, 28, 80],
  [0.96, 152, 164, 32, 40],
] as const;

export function ParcelAddedBurst({ onFinished }: { onFinished: () => void }) {
  const cloud = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = cloud.current;
    if (!element) return;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reduced = motion?.matches ?? false;
    const animations: Animation[] = [];
    const width = window.innerWidth;
    const spread = Math.min(width - 60, 350) / 2;
    const finish = () => onFinished();
    const visibility = () => { if (document.hidden) finish(); };
    // A closing mobile keyboard can resize the viewport. Keep the launch point steady.
    const resize = () => { if (window.innerWidth !== width) finish(); };
    element.dataset.reduced = String(reduced);
    element.style.setProperty('--burst-y', `${window.innerHeight * 0.6}px`);

    if (!document.hidden) {
      Array.from(element.children).forEach((child, index) => {
        if (!(child instanceof HTMLElement) || !child.animate || (reduced && index > 0)) return;
        const [horizontal, rise, spin, , delay] = parcels[index];
        const frames: Keyframe[] = reduced
          ? [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 1, offset: 0.65 }, { opacity: 0 }]
          : Array.from({ length: 33 }, (_, step) => {
            const progress = step / 32;
            const x = horizontal * spread * (1 - (1 - progress) ** 2);
            const y = -rise * progress + 220 * progress ** 2;
            const rotation = spin * progress + Math.sin(progress * Math.PI * 2) * 12;
            const scale = Math.min(1, progress / 0.1) * (1 - progress * 0.18);
            return {
              offset: progress,
              transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`,
              opacity: Math.min(1, progress / 0.04) * Math.min(1, (1 - progress) / 0.24),
            };
          });
        animations.push(child.animate(frames, { duration: reduced ? 550 : 1050, delay: reduced ? 0 : delay, fill: 'both' }));
      });
    }
    const timer = window.setTimeout(finish, document.hidden || !animations.length ? 0 : reduced ? 550 : 1200);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('pointerdown', finish, { once: true });
    document.addEventListener('keydown', finish, { once: true });
    window.addEventListener('resize', resize);
    window.addEventListener('popstate', finish, { once: true });
    motion?.addEventListener('change', finish, { once: true });
    return () => {
      clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('pointerdown', finish);
      document.removeEventListener('keydown', finish);
      window.removeEventListener('resize', resize);
      window.removeEventListener('popstate', finish);
      motion?.removeEventListener('change', finish);
    };
  }, [onFinished]);

  return createPortal(<div ref={cloud} className="parcel-added-burst" aria-hidden="true">
    {parcels.map(([, , , size], index) => <span key={index} style={{ fontSize: size }}>📦</span>)}
  </div>, document.body);
}
