import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { carrierInfo } from '../lib/carriers';
import { CarrierMark } from './CarrierMark';
import markup from './carrierMark.fixture.json';
import { CARRIER_TRUCK, carrierDecal } from '@carriers/core/brand';

/** Recorded SVG markup anchors the shared truck and selected liveries. */
describe('carrier mark', () => {
  it.each(Object.keys(markup) as (keyof typeof markup)[])('draws %s exactly as recorded', (id) => {
    const { container } = render(<CarrierMark carrier={carrierInfo(id)} />);
    expect(container.innerHTML).toBe(markup[id]);
  });

  it.each(['ups', 'fedex', 'dpd', 'dpd-fr', 'amazon-logistics', 'amazon-shipping', 'japan-post', 'dhl-ecommerce', 'swiss-post', 'quickpac', 'la-poste', 'chronopost', 'india-post', 'mondial-relay', 'spring-gds', 'swiss-post-cargo', 'postlogistics'] as const)(
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
