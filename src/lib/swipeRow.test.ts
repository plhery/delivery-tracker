import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindSwipeRow, commitPoint, releaseSwipe, revealFor, travelFor, type SwipeRow } from './swipeRow';

describe('swipe geometry', () => {
  it('follows the finger across the action, then resists, and stays within the row', () => {
    expect(revealFor(40, 360)).toBe(40);
    expect(revealFor(88, 360)).toBe(88);
    expect(revealFor(188, 360)).toBeCloseTo(168);
    expect(revealFor(-400, 360)).toBeGreaterThan(-44);
    expect(revealFor(5000, 360)).toBeLessThan(360);
  });

  it('is continuous and invertible, so a caught card never jumps', () => {
    const knee = 88 + (commitPoint(360) - 88) / 0.8;
    for (const travel of [-120, -1, 0, 30, 88, 120, knee - 1, knee + 1, 260, 400]) {
      expect(travelFor(revealFor(travel, 360), 360)).toBeCloseTo(travel, 5);
    }
    for (const edge of [0, 88, knee]) expect(revealFor(edge + 1e-6, 360) - revealFor(edge - 1e-6, 360)).toBeLessThan(1e-4);
  });

  it('archives past the commit point or on a throw, and otherwise settles by speed and position', () => {
    expect(commitPoint(360)).toBe(180);
    expect(commitPoint(200)).toBe(144);
    expect(releaseSwipe(180, 0, 360)).toBe('archive');
    expect(releaseSwipe(100, 1500, 360)).toBe('archive');
    expect(releaseSwipe(60, 1500, 360)).toBe('open');
    expect(releaseSwipe(150, -300, 360)).toBe('closed');
    expect(releaseSwipe(50, 0, 360)).toBe('open');
    expect(releaseSwipe(30, 0, 360)).toBe('closed');
    expect(releaseSwipe(30, 100, 360)).toBe('open');
  });
});

describe('bindSwipeRow', () => {
  let row: SwipeRow | null = null;
  afterEach(() => {
    row?.destroy();
    row = null;
    document.body.innerHTML = '';
  });

  function setup(onArchive = vi.fn(async () => true)) {
    document.body.innerHTML = `<div class="deliveries-page"><div class="parcel-grid"><div class="parcel-card-swipe" id="row">
      <div id="tray"><div id="block"><button id="action"></button></div></div><button id="card"></button>
    </div></div></div>`;
    const element = (id: string) => document.getElementById(id)!;
    const onOpenChange = vi.fn();
    const onArchiveStart = vi.fn();
    row = bindSwipeRow({ row: element('row'), card: element('card'), tray: element('tray'), block: element('block'), action: element('action') },
      { reflow: true, onOpenChange, onArchiveStart, onArchive });
    return { card: element('card'), element: element('row'), onOpenChange, onArchiveStart, onArchive };
  }
  function pointer(target: HTMLElement, type: string, clientX: number, clientY = 100) {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'touch', clientX, clientY }));
  }
  function swipe(card: HTMLElement, from: number, to: number, y = 100) {
    pointer(card, 'pointerdown', from);
    pointer(card, 'pointermove', to, y);
    pointer(card, 'pointerup', to, y);
  }

  it('reveals the action with a short swipe, and a tap on the card closes it', async () => {
    const { card, element, onOpenChange } = setup();
    swipe(card, 300, 240);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(card.style.transform).toBe('translateX(-88px)');
    await vi.waitFor(() => expect(element.dataset.swipe).toBe('open'));
    // The click that ends the swipe does not open the parcel; the next tap closes the row.
    expect(row!.consumeClick()).toBe(true);
    expect(row!.consumeClick()).toBe(true);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(card.style.transform).toBe('translateX(0px)');
    await vi.waitFor(() => expect(element.dataset.swipe).toBeUndefined());
    expect(row!.consumeClick()).toBe(false);
  });

  it('leaves vertical drags to the page', () => {
    const { card, onOpenChange } = setup();
    swipe(card, 300, 294, 180);
    expect(card.style.transform).toBe('translateX(0px)');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(row!.consumeClick()).toBe(false);
  });

  it('archives with a long swipe once the row has left', async () => {
    const { card, element, onArchive, onArchiveStart } = setup();
    swipe(card, 300, 20);
    expect(onArchiveStart).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(onArchive).toHaveBeenCalledOnce());
    expect(element.dataset.leaving).toBe('');
    expect(element.style.position).toBe('absolute');
  });

  it('brings the row back when the parcel stays', async () => {
    const { card, element, onArchive } = setup(vi.fn(async () => false));
    row!.archive();
    await vi.waitFor(() => expect(onArchive).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(element.dataset.swipe).toBeUndefined());
    expect(element.dataset.leaving).toBeUndefined();
    expect(element.style.position).toBe('');
    expect(card.style.transform).toBe('translateX(0px)');
  });

  it('closes an open row when another is pressed', () => {
    const { card, onOpenChange } = setup();
    swipe(card, 300, 240);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(card.style.transform).toBe('translateX(0px)');
  });
});
