import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CARRIERS, carrierInfo } from '../lib/carriers';
import { CarrierMark } from './CarrierMark';
import markup from './carrierMark.fixture.json';
import { CARRIER_DECALS, CARRIER_TRUCK, carrierDecal } from '../brand';

/** Recorded SVG markup anchors the shared truck and selected liveries. */
describe('carrier mark', () => {
  it.each(Object.keys(markup) as (keyof typeof markup)[])('draws %s exactly as recorded', (id) => {
    const { container } = render(<CarrierMark carrier={carrierInfo(id)} />);
    expect(container.innerHTML).toBe(markup[id]);
  });

  it.each([
    'ups', 'fedex', 'dpd', 'dpd-fr', 'amazon-logistics', 'amazon-shipping', 'japan-post', 'dhl-ecommerce',
    'dhl-ecommerce-es', 'dhl-ecommerce-nl', 'dhl-ecommerce-pl', 'dhl-ecommerce-uk', 'swiss-post',
    'quickpac', 'la-poste', 'chronopost', 'india-post', 'mondial-relay', 'spring-gds', 'swiss-post-cargo', 'postlogistics',
    'usps', 'royal-mail', 'canada-post', 'australia-post', 'tnt', 'correos-spain', 'correos-express', 'yamato', 'china-post',
    'inpost', 'bpost', 'austrian-post', 'hermes', 'hermes-de', 'nova-poshta', 'brt', 'dpd-de', 'dpd-uk',
    'korea-post', 'nz-post', 'poczta-polska', 'ukrposhta', 'correios-br', 'ctt', 'ctt-express', 'sf-express', 'ninja-van',
    'hongkong-post', 'thailand-post', 'bring-posten', 'packeta', 'gls-ch', 'gls-de', 'gls-fr', 'evri', 'evri-uk',
    'postnord', 'poste-italiane', 'aramex', 'j-and-t', 'aliexpress', 'zto', 'yto', 'sto', 'yunda', 'jd-logistics', 'ems',
    'seur', 'mrw', 'nacex', 'purolator', 'parcelforce', 'posti', 'an-post', 'delhivery', 'blue-dart', 'dtdc', 'sagawa',
    'ontrac', 'estafeta', 'pos-malaysia', 'four-px', 'planzer', 'tipsa', 'gofo', 'dachser',
    'asendia', 'colis-prive', 'ciblex', 'colisweb', 'uniuni', 'yunexpress', 'canpar', 'relais-colis',
    'singapore-post', 'geodis', 'lbc-express', 'spx-ph', 'ekart', 'xpressbees', 'cne', 'yanwen', 'sunyou', 'speedx',
    'spee-dee', 'speedpak', 'the-courier-guy', 'landmark-global', 'old-dominion', 'paack', 'c-chez-vous',
    'ecoscooting', 'correos-chile', 'delivengo', 'intelcom', 'shipup', 'heppner',
  ] as const)(
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

  it('switches between every livery without React warnings or leftover shapes', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { container, rerender } = render(<CarrierMark carrier={carrierInfo('quickpac')} />);
      const brandedCarriers = Object.values(CARRIERS).filter(({ id }) => CARRIER_DECALS[id]);
      for (const carrier of [...brandedCarriers, carrierInfo('unknown'), carrierInfo('quickpac')]) {
        rerender(<CarrierMark carrier={carrier} />);
        const fresh = render(<CarrierMark carrier={carrier} />);
        expect(container.innerHTML).toBe(fresh.container.innerHTML);
        fresh.unmount();
      }
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
