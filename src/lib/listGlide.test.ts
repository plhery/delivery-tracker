import { afterEach, describe, expect, it, vi } from 'vitest';
import { glideList, measureList } from './listGlide';

type Box = { left: number; top: number; width?: number; height?: number };

function place(element: HTMLElement, box: Box) {
  const rect = { x: box.left, y: box.top, left: box.left, top: box.top, width: box.width ?? 300, height: box.height ?? 100,
    right: box.left + (box.width ?? 300), bottom: box.top + (box.height ?? 100), toJSON: () => ({}) } as DOMRect;
  element.getBoundingClientRect = () => rect;
  element.getClientRects = () => [rect] as unknown as DOMRectList;
}

describe('glideList', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('glides moved blocks from where they were seen, relative to a parent that moves too', () => {
    document.body.innerHTML = `<div class="deliveries-page">
      <div class="parcel-card-swipe" id="first"></div>
      <section class="parcel-section" id="section"><div class="parcel-card-swipe" id="nested"></div></section>
      <div class="parcel-card-swipe" id="fresh"></div>
    </div>`;
    const element = (id: string) => document.getElementById(id)!;
    const root = document.querySelector<HTMLElement>('.deliveries-page')!;
    place(element('first'), { left: 20, top: 100 });
    place(element('section'), { left: 20, top: 400, height: 300 });
    place(element('nested'), { left: 20, top: 450 });
    element('fresh').getClientRects = () => [] as unknown as DOMRectList;
    const before = measureList(root);

    // The section moves up 112px; its card also moves 40px within it; a new card appears.
    place(element('section'), { left: 20, top: 288, height: 300 });
    place(element('nested'), { left: 20, top: 298 });
    place(element('fresh'), { left: 20, top: 700 });
    const animate = vi.fn((keyframes: Keyframe[]) => ({ currentTime: 0, startTime: null, keyframes, addEventListener() {}, cancel() {} }));
    for (const id of ['first', 'section', 'nested', 'fresh']) element(id).animate = animate as unknown as HTMLElement['animate'];
    root.animate = animate as unknown as HTMLElement['animate'];
    glideList(root, before);

    const started = (id: string) => (element(id).animate as unknown as typeof animate).mock.calls
      .find((_, index) => animate.mock.contexts[index] === element(id))?.[0];
    expect(started('first')).toBeUndefined();
    expect(started('section')?.[0]).toEqual({ translate: '0px 112px' });
    expect(started('section')?.at(-1)).toEqual({ translate: '0px 0px' });
    expect(started('nested')?.[0]).toEqual({ translate: '0px 40px' });
    expect(started('fresh')).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });
});
