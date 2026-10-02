import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n';
import { PeekLockup, PeekMark, peekMarkDrawing } from './PeekMark';

const shapes = (root: ParentNode) => [...root.querySelectorAll('rect, polygon, ellipse, circle, path')]
  .map((shape) => [shape.tagName, ...[...shape.attributes].filter(({ name }) => !name.startsWith('data-')).map(({ name, value }) => `${name}=${value}`).sort()]);
const mark = (size: number) => render(<PeekMark size={size} />).container.querySelector('svg')!;
const file = (name: string) => new DOMParser().parseFromString(readFileSync(`public/icons/${name}`, 'utf8'), 'image/svg+xml');

describe('the mark', () => {
  it('loses detail as it shrinks', () => {
    expect([16, 23, 24, 28, 30, 40, 41, 64, 127, 128, 512].map(peekMarkDrawing)).toEqual(
      ['glyph', 'glyph', 'simple', 'simple', 'simple', 'simple', 'full', 'full', 'full', 'label', 'label'],
    );
  });

  it('keeps only the eyes over the rim and the lid under 24 px, clipped to its own tile', () => {
    const first = mark(16), second = mark(20);
    expect(first).toHaveAttribute('data-drawing', 'glyph');
    expect(first.querySelectorAll('ellipse')).toHaveLength(2);
    const clip = first.querySelector('clipPath')!;
    expect(first.querySelector('g')).toHaveAttribute('clip-path', `url(#${clip.id})`);
    expect(second.querySelector('clipPath')!.id).not.toBe(clip.id);
  });

  it('draws bigger eyes and no tape from 24 to 40 px', () => {
    const simple = mark(28);
    expect(simple).toHaveAttribute('data-drawing', 'simple');
    expect(simple.querySelector('ellipse')).toHaveAttribute('rx', '66');
    expect(simple.querySelector('clipPath')).toBeNull();
    expect(simple.querySelectorAll('polygon')).toHaveLength(2);
  });

  it('adds the tape above 40 px and the label from 128 px', () => {
    const full = mark(64), labelled = mark(128);
    expect(full.querySelector('ellipse')).toHaveAttribute('rx', '58');
    expect(full.querySelectorAll('polygon')).toHaveLength(3);
    expect(full.querySelector('[data-part="label"]')).toBeNull();
    expect(labelled.querySelectorAll('[data-part="label"]')).toHaveLength(2);
    expect(shapes(labelled).filter((shape) => !shapes(full).some((other) => other.join() === shape.join()))).toHaveLength(2);
  });

  it('is decorative, with its own size and stroke inside a link or a button', () => {
    const svg = mark(30);
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveClass('peek-mark');
    expect(svg).toHaveStyle({ width: '30px', height: '30px' });
    expect(svg.querySelector('polygon[stroke]')).toHaveAttribute('stroke-linejoin', 'round');
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
