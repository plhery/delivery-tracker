import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { carrierInfo } from '../../lib/carriers';
import { scroll, stubIntersections } from '../../test/intersections';
import { CarrierRibbon, RIBBON_CARRIERS } from './CarrierRibbon';

beforeEach(() => { stubIntersections(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('CarrierRibbon', () => {
  it('rolls the carriers by in their own liveries, as one image with a name', () => {
    render(<CarrierRibbon />);
    const road = screen.getByRole('img', { name: 'Works with Swiss Post, DHL, UPS, DPD Switzerland, GLS and thousands more carriers' });
    // The line of trucks stands twice in the lane, so it can roll without a gap.
    const trucks = road.querySelectorAll('.door-ribbon__truck');
    expect(trucks).toHaveLength(RIBBON_CARRIERS.length * 2);
    expect(road.querySelectorAll('.carrier-mark__truck')).toHaveLength(trucks.length);
    expect((trucks[1] as HTMLElement).style.getPropertyValue('--carrier-brand-light')).toBe('#d40511');
    // No truck rides in step with its neighbour.
    const rhythm = (index: number) => (trucks[index] as HTMLElement).style.animationDuration;
    expect(new Set([0, 1, 2, 3].map(rhythm)).size).toBe(4);
    expect(screen.getByText('Finds the carrier for you: 3,500+ of them, from Swiss Post to USPS')).toBeVisible();
  });

  it('arrives with one line of trucks, standing, and rolls once the page is live', () => {
    const html = renderToString(<CarrierRibbon />);
    expect(html.match(/door-ribbon__truck/g)).toHaveLength(RIBBON_CARRIERS.length);
    expect(html).not.toContain('data-rolling');
    render(<CarrierRibbon />);
    expect(screen.getByRole('img')).toHaveAttribute('data-rolling');
  });

  it('names only carriers the catalog knows', () => {
    for (const id of RIBBON_CARRIERS) expect(carrierInfo(id).id).toBe(id);
    expect(new Set(RIBBON_CARRIERS).size).toBe(RIBBON_CARRIERS.length);
  });

  it('rolls only while it is on screen', () => {
    render(<CarrierRibbon />);
    const road = screen.getByRole('img');
    expect(road).toHaveAttribute('data-paused');
    scroll(road, 1);
    expect(road).not.toHaveAttribute('data-paused');
    scroll(road, 0);
    expect(road).toHaveAttribute('data-paused');
  });
});
