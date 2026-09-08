export interface CardOrigin {
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
  radius: string;
}

/** Capture the actual tapped card, never a stale position from browser history. */
export function captureCardOrigin(card?: HTMLElement): CardOrigin | null {
  if (!card || !window.matchMedia?.('(max-width: 760px)').matches
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
  const bounds = card.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0 || bounds.bottom <= 0 || bounds.top >= window.innerHeight) return null;
  const style = getComputedStyle(card);
  return {
    left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
    color: style.backgroundColor, radius: style.borderTopLeftRadius,
  };
}

/** Expand the paper first; reveal its contents without visibly stretching type. */
export function expandCardIntoDialog(dialog: HTMLElement, origin: CardOrigin): () => void {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (!dialog.animate || !reducedMotion || reducedMotion.matches || !window.matchMedia('(max-width: 760px)').matches) return () => {};
  const bounds = dialog.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return () => {};
  const style = getComputedStyle(dialog);
  const scaleX = origin.width / bounds.width;
  const scaleY = origin.height / bounds.height;
  const radius = Number.parseFloat(origin.radius) || 0;
  const expansion = dialog.animate([
    {
      transform: `translate(${origin.left - bounds.left}px, ${origin.top - bounds.top}px) scale(${scaleX}, ${scaleY})`,
      transformOrigin: 'top left',
      // Compensate for the panel's scale so the card starts with round corners.
      borderRadius: `${radius / scaleX}px / ${radius / scaleY}px`, backgroundColor: origin.color,
    },
    { transform: 'none', transformOrigin: 'top left', borderRadius: style.borderRadius, backgroundColor: style.backgroundColor },
  ], { id: 'parcel-card-expand', duration: 230, easing: 'cubic-bezier(.2,.8,.2,1)' });
  const contents = Array.from(dialog.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
    .map((child) => child.animate([{ opacity: 0 }, { opacity: 1 }], {
      id: 'parcel-detail-content', duration: 150, delay: 65, fill: 'backwards', easing: 'ease-out',
    }));
  const stop = () => {
    expansion.cancel();
    contents.forEach((animation) => animation.cancel());
    window.removeEventListener('resize', stop);
    window.visualViewport?.removeEventListener('resize', stop);
    reducedMotion.removeEventListener('change', stop);
  };
  window.addEventListener('resize', stop);
  window.visualViewport?.addEventListener('resize', stop);
  reducedMotion.addEventListener('change', stop);
  void expansion.finished.then(stop, stop);
  return stop;
}
