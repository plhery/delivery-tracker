import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { carrierInfo } from '../lib/carriers';
import { ParcelIllustration } from './Icon';

const arrow = 'g[transform="translate(201 201) rotate(-27)"]';
const seal = 'g[transform="translate(183 234) rotate(-27)"]';

describe('Pip with its carrier’s label', () => {
  it('keeps the arrow and the lilac seal on a parcel without a carrier', () => {
    const { container } = render(<ParcelIllustration />);
    expect(container.querySelector(arrow)).not.toBeNull();
    expect(container.querySelector(`${seal} .parcel-illustration__seal-light`)).not.toBeNull();
    expect(container.querySelector('.parcel-illustration__label')).toBeNull();
    expect(container.querySelectorAll('.parcel-illustration__eye')).toHaveLength(2);
  });

  it('draws the label on the right side in place of the arrow and the seal', () => {
    const { container } = render(<ParcelIllustration label={{ carrier: carrierInfo('dhl'), number: '1234567899' }} />);
    expect(container.querySelector(arrow)).toBeNull();
    expect(container.querySelector(seal)).toBeNull();
    const label = container.querySelector<SVGGElement>('.parcel-illustration__label')!;
    expect(label).toHaveAttribute('transform', 'matrix(1 -0.505263 0 1 160 205) scale(.97)');
    expect(label).toHaveAttribute('stroke', 'none');
    const paper = label.querySelector(':scope > rect')!;
    expect([paper.getAttribute('width'), paper.getAttribute('height'), paper.getAttribute('fill')]).toEqual(['74', '48', '#FFFEFA']);
    // The carrier's own truck, at half size, in its livery.
    const truck = label.querySelector('g[transform="translate(5 5) scale(.5)"]')!;
    expect(truck.querySelector('rect')).toHaveAttribute('fill', 'var(--carrier-truck)');
    expect(truck.querySelector('path[d="M4 8h12M3 10h12"]')).toHaveAttribute('stroke', 'var(--carrier-accent)');
    expect(label.style.getPropertyValue('--carrier-truck')).toBe('#ffcc00');
    expect(label.style.getPropertyValue('--carrier-brand-light')).toBe('#d40511');
    const name = label.querySelector('.parcel-illustration__label-name')!;
    expect(name).toHaveTextContent('DHL');
    expect(name).toHaveAttribute('fill', 'var(--carrier-brand-light)');
    expect(name).toHaveAttribute('font-style', 'italic');
    expect(name).not.toHaveAttribute('textLength');
    expect(label.querySelector('path[stroke="#20251E"]')!.getAttribute('d')).toMatch(/^M6 20v14m2\.2-14v14/);
    const number = label.querySelector('.parcel-illustration__label-number')!;
    expect(number).toHaveTextContent('1234567899');
    expect(number).not.toHaveAttribute('textLength');
    // The face stays where it was.
    expect(container.querySelectorAll('.parcel-illustration__eye')).toHaveLength(2);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('writes any carrier’s name in its own colour, and fits long names and numbers onto the label', () => {
    const colissimo = carrierInfo('la-poste');
    const { container } = render(<ParcelIllustration label={{ carrier: colissimo, number: '1Z'.repeat(15) }} />);
    const name = container.querySelector('.parcel-illustration__label-name')!;
    expect(name).toHaveTextContent(colissimo.name);
    expect(name).not.toHaveAttribute('font-style');
    expect(name).toHaveAttribute('textLength', '47');
    expect(name).toHaveAttribute('lengthAdjust', 'spacingAndGlyphs');
    expect(container.querySelector('.parcel-illustration__label-number')).toHaveAttribute('textLength', '62');
    expect(container.querySelector('.parcel-illustration__label g[transform="translate(5 5) scale(.5)"] rect')).toHaveAttribute('fill', 'var(--carrier-truck)');
  });

  it('leaves the number line out for a parcel whose number is not shown', () => {
    const { container } = render(<ParcelIllustration label={{ carrier: carrierInfo('ups'), number: null }} />);
    expect(container.querySelector('.parcel-illustration__label-name')).toHaveTextContent('ups');
    expect(container.querySelector('.parcel-illustration__label-number')).toBeNull();
  });
});
