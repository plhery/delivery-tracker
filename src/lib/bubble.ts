/** Put an explanation bubble under what it explains, or above when there is no room, and say where it grows from. */
export function placeBubble(bubble: HTMLElement, anchor: DOMRect) {
  // The bubble is still drawn small at this point; its layout size is the one it grows to.
  const width = bubble.offsetWidth;
  const height = bubble.offsetHeight;
  const below = anchor.bottom + 10;
  const wanted = below + height <= window.innerHeight - 12 ? below : anchor.top - height - 10;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, anchor.left + anchor.width / 2 - width / 2));
  const top = Math.max(12, Math.min(window.innerHeight - height - 12, wanted));
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  bubble.style.setProperty('--bubble-from', `${anchor.left + anchor.width / 2 - left}px ${anchor.top + anchor.height / 2 - top}px`);
}
