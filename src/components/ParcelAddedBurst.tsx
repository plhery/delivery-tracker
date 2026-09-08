import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Same little sparks and rumble as the native card celebration.
const parcels = [
  [-1, 90, -80, 19, 20], [-0.7, 145, 65, 24, 0],
  [-0.35, 115, -100, 21, 50], [0, 155, 85, 25, 30],
  [0.35, 120, -55, 20, 60], [0.6, 95, 100, 22, 10],
] as const;

export function ParcelAddedBurst({ parcelId, onFinished }: { parcelId: string; onFinished: () => void }) {
  const cloud = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = cloud.current;
    if (!element) return;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reduced = motion?.matches ?? false;
    const animations: Animation[] = [];
    const width = window.innerWidth;
    let frame = 0;
    let timer = 0;
    let finished = false;
    let card: HTMLElement | null = null;
    let launched = false;
    let positioned = false;
    let previousY: number | null = null;
    let stableFrames = 0;
    const requestedAt = performance.now();
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
      card?.removeAttribute('data-celebrating');
      onFinished();
    };
    const visibility = () => { if (document.hidden) finish(); };
    // Ignore keyboard height changes; the emitter follows the card every frame.
    const resize = () => { if (window.innerWidth !== width) finish(); };
    element.dataset.reduced = String(reduced);

    function launch(target: HTMLElement) {
      const button = target.querySelector<HTMLButtonElement>('.parcel-card');
      if (!button || !target.animate) { finish(); return; }
      launched = true;
      element!.dataset.phase = 'playing';
      target.dataset.celebrating = reduced ? 'highlight' : 'rumble';
      button.focus({ preventScroll: true });
      // Animate the wrapper, leaving the button's swipe transform independent.
      const frames: Keyframe[] = reduced
        ? [{ filter: 'brightness(1)' }, { filter: 'brightness(1.08)', offset: 0.5 }, { filter: 'brightness(1)' }]
        : Array.from({ length: 33 }, (_, step) => {
          const progress = step / 32;
          const wobble = Math.sin(progress * Math.PI * 6) * (1 - progress);
          return { offset: progress, transform: `translateX(${wobble * 3}px) rotate(${wobble * 1.1}deg) scale(${1 + Math.sin(progress * Math.PI) * 0.012})` };
        });
      animations.push(target.animate(frames, { duration: reduced ? 750 : 480 }));
      if (!reduced) {
        const spread = Math.min(target.getBoundingClientRect().width * 0.25, 80);
        Array.from(element!.children).forEach((child, index) => {
          const [horizontal, rise, spin, , delay] = parcels[index];
          const sparks = Array.from({ length: 33 }, (_, step) => {
            const progress = step / 32;
            const x = horizontal * spread * (1 - (1 - progress) ** 2);
            const y = -rise * progress + 120 * progress ** 2;
            const rotation = spin * progress + Math.sin(progress * Math.PI * 2) * 8;
            const scale = Math.min(1, progress / 0.12) * (1 - progress * 0.25);
            return {
              offset: progress,
              transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`,
              opacity: Math.min(1, progress / 0.05) * Math.min(1, (1 - progress) / 0.3),
            };
          });
          animations.push(child.animate(sparks, { duration: 800, delay, fill: 'both' }));
        });
      }
      timer = window.setTimeout(finish, reduced ? 750 : 950);
    }

    function followCard(now: number) {
      if (finished) return;
      card = document.querySelector<HTMLElement>(`.parcel-card-swipe[data-parcel-id="${CSS.escape(parcelId)}"]`);
      if (document.hidden || (launched && (!card || !card.getClientRects().length))) { finish(); return; }
      if (!card || !card.getClientRects().length || card.closest('[inert]')) {
        if (now - requestedAt > 1500) { finish(); return; }
        frame = requestAnimationFrame(followCard);
        return;
      }
      const rect = card.getBoundingClientRect();
      const anchor = card.querySelector<HTMLElement>('.parcel-card__stub, .postage-stamp');
      const stamp = anchor?.getBoundingClientRect();
      element!.style.setProperty('--burst-x', `${stamp ? stamp.x + stamp.width / 2 : rect.right - 30}px`);
      element!.style.setProperty('--burst-y', `${stamp ? stamp.y + stamp.height / 2 : rect.y + rect.height / 2}px`);
      if (!positioned) {
        positioned = true;
        if (rect.top < 110 || rect.bottom > window.innerHeight - 90) {
          card.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'center' });
        }
      }
      if (!launched) {
        stableFrames = previousY !== null && Math.abs(rect.y - previousY) < 0.5 ? stableFrames + 1 : 0;
        previousY = rect.y;
        const visible = rect.top >= 80 && rect.bottom <= window.innerHeight - 65;
        if (visible && (stableFrames >= 4 || now - requestedAt > 1200)) launch(card);
        else if (now - requestedAt > 1500) { finish(); return; }
      }
      frame = requestAnimationFrame(followCard);
    }
    frame = requestAnimationFrame(followCard);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('pointerdown', finish, { once: true });
    document.addEventListener('keydown', finish, { once: true });
    document.addEventListener('wheel', finish, { once: true, passive: true });
    window.addEventListener('resize', resize);
    window.addEventListener('popstate', finish, { once: true });
    motion?.addEventListener('change', finish, { once: true });
    return () => {
      finished = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
      card?.removeAttribute('data-celebrating');
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('pointerdown', finish);
      document.removeEventListener('keydown', finish);
      document.removeEventListener('wheel', finish);
      window.removeEventListener('resize', resize);
      window.removeEventListener('popstate', finish);
      motion?.removeEventListener('change', finish);
    };
  }, [parcelId, onFinished]);

  return createPortal(<div ref={cloud} className="parcel-added-burst" data-parcel-id={parcelId} data-phase="waiting" aria-hidden="true">
    {parcels.map(([, , , size], index) => <span key={index} style={{ fontSize: size }}>📦</span>)}
  </div>, document.body);
}
