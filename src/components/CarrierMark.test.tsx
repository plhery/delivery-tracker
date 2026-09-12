import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { carrierInfo } from '../lib/carriers';
import { CarrierMark } from './CarrierMark';
import markup from './carrierMark.fixture.json';

/**
 * The truck is data now (`packages/carriers/core/brand/truck.json`). The
 * fixture is the markup the hand-written SVG produced before that move, so a
 * change to the geometry that would move a pixel has to be deliberate.
 */
describe('carrier mark', () => {
  it.each(Object.keys(markup) as (keyof typeof markup)[])('draws %s exactly as before', (id) => {
    const { container } = render(<CarrierMark carrier={carrierInfo(id)} />);
    expect(container.innerHTML).toBe(markup[id]);
  });

  it('covers the three liveries and a carrier that has none', () => {
    expect(Object.keys(markup)).toEqual(['dhl', 'ups', 'gls-ch', 'swiss-post']);
  });
});
