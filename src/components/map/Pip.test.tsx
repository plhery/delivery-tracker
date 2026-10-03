import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STAGES } from '../../generated/apiContract';
import { PARCEL, ParcelIllustration, SmallPip, flapPoints } from '../Icon';
import { InkPip, outlineDistance, pipExtents, pipMood, pipOutlines, type PipMood } from './Pip';

const moods: PipMood[] = ['look', 'eager', 'wait', 'worry', 'joy'];

describe('Pip', () => {
  it('has a mood for every stage with a map', () => {
    expect(Object.fromEntries(STAGES.map((stage) => [stage, pipMood(stage)]))).toEqual({
      pending: null, registered: 'look', accepted: 'look', in_transit: 'look', out_for_delivery: 'eager', customs: 'wait',
      ready_for_pickup: 'wait', failed_attempt: 'worry', exception: 'worry', returned: 'worry', delivered: 'joy',
    });
    expect(pipMood()).toBeNull();
  });

  it('folds the flaps open on their hinges, as the design draws them', () => {
    expect(flapPoints(PARCEL.flaps.backLeft, true)).toBe('55,142 150,95 112,48 17,95');
    expect(flapPoints(PARCEL.flaps.backRight, true)).toBe('150,95 245,142 270,88 174.24,41.32');
    // The front flaps rest just above level, clear of the sides.
    expect(flapPoints(PARCEL.flaps.frontRight, true)).toBe('245,142 150,190 193,189 287.06,141.26');
    expect(flapPoints(PARCEL.flaps.frontLeft, true)).toBe('55,142 150,190 107,189 12.94,141.26');
    expect(flapPoints(PARCEL.flaps.frontLeft, false)).toBe('55,142 150,190 197.5,166 102.5,118.5');
  });

  it('draws the box in the card’s ink, closed with its tape or open with its glints', () => {
    for (const mood of moods) {
      const { container, unmount } = render(<InkPip mood={mood} side={1} />);
      const open = mood === 'joy';
      expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelectorAll('polygon')).toHaveLength(open ? 4 : 2);
      expect(container.querySelector(`path[d="${PARCEL.tape}"]`) === null).toBe(open);
      expect(container.querySelectorAll(`path[d="${PARCEL.glint}"]`)).toHaveLength(open ? 6 : 0);
      // Every colour comes from the card: nothing keeps the kraft palette.
      expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
      unmount();
    }
  });

  it('looks toward the dot and trails its speed lines away from it', () => {
    const pupils = (side: -1 | 0 | 1, below = false) => {
      const { container, unmount } = render(<InkPip mood="eager" side={side} below={below} />);
      const pupil = container.querySelector('circle')!;
      const result = { x: Number(pupil.getAttribute('cx')), y: Number(pupil.getAttribute('cy')), mirrored: container.querySelector('path[opacity=".32"]')!.hasAttribute('transform') };
      unmount();
      return result;
    };
    // The left eye sits at 26.25, 33 in the plane of the box's side.
    expect(pupils(1)).toEqual({ x: 30.87, y: 31.74, mirrored: false });
    expect(pupils(-1)).toEqual({ x: 21.63, y: 31.74, mirrored: true });
    expect(pupils(0).y).toBeGreaterThan(33);
    expect(pupils(0, true).y).toBeLessThan(33);
  });

  it('knows what he covers', () => {
    for (const mood of moods) {
      const extents = pipExtents(mood, 1);
      const [x, y] = [(extents.left + extents.right) / 2, (extents.top + extents.bottom) / 2];
      // The middle of his box is on him; its top corner on the dot's side is not.
      expect(Math.min(...pipOutlines(mood, 1).map((outline) => outlineDistance([x, y], outline)))).toBe(0);
      expect(Math.min(...pipOutlines(mood, 1).map((outline) => outlineDistance([extents.right, extents.top], outline)))).toBeGreaterThan(10);
    }
    expect(pipExtents('eager', 1).left).toBe(0);
    expect(pipExtents('eager', -1)).toMatchObject({ left: 52, right: 300 });
  });
});

describe('the kraft parcel', () => {
  it('wears Pip’s face on its left side, with happy eyes for when it opens', () => {
    const { container } = render(<ParcelIllustration />);
    const face = container.querySelector('.parcel-illustration__pip')!;
    expect(face).toHaveAttribute('transform', PARCEL.facePlane);
    expect(face.querySelectorAll('.parcel-illustration__eye')).toHaveLength(2);
    expect(face.querySelectorAll('.parcel-illustration__happy-eye')).toHaveLength(2);
    expect(face.querySelector('path:not([class])')).toHaveAttribute('d', 'M42 51Q48 58 54 51');
    // The face is on the side: after the rear flaps, and under the front ones, which swing over it on their way open.
    const flaps = container.querySelectorAll<SVGGElement>('.parcel-illustration__flap');
    const front = container.querySelectorAll<SVGGElement>('.parcel-illustration__flap--swing');
    expect([flaps.length, front.length]).toEqual([4, 2]);
    expect(flaps[1].compareDocumentPosition(face) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(face.compareDocumentPosition(front[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A front flap turns 154 degrees on its hinge, through upright: as tall there as it is deep when closed, or a little more.
    for (const flap of front) {
      expect(flap.style.getPropertyValue('--fold-turn')).toBe('154deg');
      expect(Number(flap.style.getPropertyValue('--fold-rise'))).toBeGreaterThan(1);
      expect(flap.style.getPropertyValue('--fold-scale')).toBe('');
    }
    expect(flaps[0].style.getPropertyValue('--fold-scale')).toBe('-0.970652');
  });

  it('rests the open front flap above Pip’s happy eyes, like a brim', () => {
    const brim = flapPoints(PARCEL.flaps.frontLeft, true).split(' ').map((point) => point.split(',').map(Number) as [number, number]);
    // The eyes of the kraft parcel, then of the ink Pip, as curves in the plane of the left side.
    const eyes = [[24.5, 39, 32.5, 28, 40.5, 39], [55.5, 39, 63.5, 28, 71.5, 39], [14.25, 37.5, 26.25, 21, 38.25, 37.5], [57.75, 37.5, 69.75, 21, 81.75, 37.5]];
    for (const [x0, y0, cx, cy, x1, y1] of eyes) for (let t = 0; t <= 1; t += .125) {
      const x = (1 - t) ** 2 * x0 + 2 * t * (1 - t) * cx + t ** 2 * x1;
      const y = (1 - t) ** 2 * y0 + 2 * t * (1 - t) * cy + t ** 2 * y1;
      // Clear of the widest stroke, with room to spare.
      expect(outlineDistance([55 + x, 142 + .505263 * x + y], brim)).toBeGreaterThan(6);
    }
    render(<InkPip mood="joy" side={1} />);
    const polygons = [...document.querySelectorAll('polygon')];
    const face = document.querySelector(`g[transform="${PARCEL.facePlane}"]`)!;
    expect(polygons[1].compareDocumentPosition(face) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(face.compareDocumentPosition(polygons[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws larger features on a small parcel', () => {
    const { container } = render(<SmallPip />);
    expect(container.querySelector('.parcel-illustration__eye ellipse')).toHaveAttribute('rx', '13');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
