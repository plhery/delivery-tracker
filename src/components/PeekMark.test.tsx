import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n';
import { PeekLockup, PeekMark } from './PeekMark';

/** Every element of a drawing in paint order, as its tag and its attributes. */
const shapes = (root: ParentNode) => [...root.querySelectorAll('svg *')]
  .map((shape) => [shape.tagName, ...[...shape.attributes].map(({ name, value }) => `${name}=${value}`).sort()]);
const mark = (size: number) => render(<PeekMark size={size} />).container.querySelector('svg')!;
const file = (name: string) => new DOMParser().parseFromString(readFileSync(`public/icons/${name}`, 'utf8'), 'image/svg+xml');
const number = (shape: Element, name: string) => Number(shape.getAttribute(name));
/** Whether a circle lies wholly inside an ellipse or another circle, judged on its outline degree by degree. */
const inside = (circle: Element, outer: Element) => Array.from({ length: 360 }, (_, degree) => degree * Math.PI / 180).every((angle) => Math.hypot(
  (number(circle, 'cx') + number(circle, 'r') * Math.cos(angle) - number(outer, 'cx')) / number(outer, outer.tagName === 'ellipse' ? 'rx' : 'r'),
  (number(circle, 'cy') + number(circle, 'r') * Math.sin(angle) - number(outer, 'cy')) / number(outer, outer.tagName === 'ellipse' ? 'ry' : 'r'),
) < 1);

describe('the mark', () => {
  it('is two eyes on a rounded yellow tile, painted back to front: the tile, both whites, then each eye’s pupil and catchlight', () => {
    const svg = mark(64);
    expect(svg).toHaveAttribute('viewBox', '0 0 512 512');
    expect(shapes(svg)).toEqual([
      ['rect', 'fill=#f3cf48', 'height=512', 'rx=116', 'width=512'],
      ['ellipse', 'cx=190', 'cy=262', 'fill=#fffaf0', 'rx=70', 'ry=77'],
      ['ellipse', 'cx=322', 'cy=262', 'fill=#fffaf0', 'rx=70', 'ry=77'],
      ['circle', 'cx=219.4', 'cy=269', 'fill=#171714', 'r=35'],
      ['circle', 'cx=207.5', 'cy=255', 'fill=#ffffff', 'r=10.5'],
      ['circle', 'cx=351.4', 'cy=269', 'fill=#171714', 'r=35'],
      ['circle', 'cx=339.5', 'cy=255', 'fill=#ffffff', 'r=10.5'],
    ]);
  });

  it('gives each of its two eyes a pupil inside the white and a catchlight inside the pupil, the right eye a copy of the left', () => {
    const svg = mark(64);
    const whites = [...svg.querySelectorAll('ellipse')], circles = [...svg.querySelectorAll('circle')];
    expect(whites).toHaveLength(2);
    expect(circles).toHaveLength(4);
    // The whites overlap, so both lie under the pupils: neither covers the other eye's pupil.
    expect(number(whites[0], 'cx') + number(whites[0], 'rx')).toBeGreaterThan(number(whites[1], 'cx') - number(whites[1], 'rx'));
    expect(whites[1].nextElementSibling).toBe(circles[0]);
    const [left, right] = whites.map((white, eye) => {
      const [pupil, catchlight] = circles.slice(eye * 2);
      expect(inside(pupil, white)).toBe(true);
      expect(inside(catchlight, pupil)).toBe(true);
      expect(number(catchlight, 'r')).toBeLessThan(number(pupil, 'r'));
      return [white, pupil, catchlight];
    });
    left.forEach((shape, index) => {
      expect(number(right[index], 'cx') - number(shape, 'cx')).toBeCloseTo(132);
      for (const name of ['cy', 'rx', 'ry', 'r', 'fill']) expect(right[index].getAttribute(name)).toBe(shape.getAttribute(name));
    });
    // The pair stands in the middle of the tile's width.
    expect((number(left[0], 'cx') + number(right[0], 'cx')) / 2).toBe(256);
  });

  it('is the same drawing at every size', () => {
    const drawing = mark(64).innerHTML;
    for (const size of [16, 28, 30, 64, 512]) {
      const svg = mark(size);
      expect(svg.innerHTML).toBe(drawing);
      expect(svg).toHaveStyle({ width: `${size}px`, height: `${size}px` });
      // Only its inline size tells one from another.
      expect([...svg.attributes].map(({ name }) => name).sort()).toEqual(['aria-hidden', 'class', 'style', 'viewBox']);
    }
  });

  it('is decorative, with its own size and no stroke inside a link or a button', () => {
    const { container } = render(<><button type="button"><PeekMark size={30} /></button><a href="https://peek.example.test/"><PeekMark size={18} className="brand" /></a></>);
    const [inButton, inLink] = container.querySelectorAll('svg');
    expect(inButton).toHaveAttribute('aria-hidden', 'true');
    expect(inButton).toHaveAttribute('class', 'peek-mark');
    expect(inButton).toHaveStyle({ width: '30px', height: '30px' });
    expect(inLink).toHaveAttribute('aria-hidden', 'true');
    expect(inLink).toHaveAttribute('class', 'peek-mark brand');
    expect(inLink).toHaveStyle({ width: '18px', height: '18px' });
    // Its class turns off the stroke a link or a button gives its line icons, and no shape asks for one of its own.
    expect(container.querySelector('[stroke], [stroke-width]')).toBeNull();
  });

  it('is the drawing in the icon files', () => {
    expect(shapes(file('icon.svg'))).toEqual(shapes(mark(512)));
    expect(shapes(file('favicon.svg'))).toEqual(shapes(mark(16)));
  });
});

describe('the lockup', () => {
  it('sets the name over what the app does, beside the 28 px mark', () => {
    const { container } = render(<I18nProvider initialLocale="en"><PeekLockup /></I18nProvider>);
    expect(screen.getByText('Peek')).toHaveClass('peek-lockup__name');
    expect(screen.getByText('Universal Parcel Tracker')).toHaveClass('peek-lockup__tagline');
    expect(container.querySelector('svg')).toHaveStyle({ width: '28px' });
  });
});
