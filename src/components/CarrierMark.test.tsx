import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { carrierInfo } from '../lib/carriers';
import { CarrierMark } from './CarrierMark';
import markup from './carrierMark.fixture.json';
import { CARRIER_TRUCK, carrierDecal } from '@carriers/core/brand';

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

  it.each(['fedex', 'dpd', 'dpd-fr', 'amazon-logistics', 'amazon-shipping', 'japan-post', 'dhl-ecommerce', 'swiss-post', 'quickpac', 'la-poste', 'chronopost', 'india-post', 'mondial-relay', 'spring-gds', 'swiss-post-cargo', 'postlogistics'] as const)(
    'renders the declared decoration for %s', (id) => {
      const { container } = render(<CarrierMark carrier={carrierInfo(id)} />);
      const paths = [...container.querySelectorAll('svg > path')].map(path => path.getAttribute('d'));
      for (const shape of CARRIER_TRUCK.decals[carrierDecal(id)]) {
        if (shape.type === 'circle') {
          expect(container.querySelector(`svg > circle[cx="${shape.cx}"][cy="${shape.cy}"][r="${String(shape.r).replace(/^0\./, '.')}"]`)).not.toBeNull();
        } else expect(paths).toContain(shape.d);
      }
      expect(container.firstChild).toHaveAttribute('aria-label', carrierInfo(id).name);
    },
  );

  it('covers the three liveries and a carrier that has none', () => {
    expect(Object.keys(markup)).toEqual(['dhl', 'ups', 'gls-ch', 'unknown']);
  });
});
