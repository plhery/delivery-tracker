import { describe, expect, it } from 'vitest';
import {
  CARRIERS,
  SELECTABLE_CARRIERS,
  carrierInfo,
  displayedCarrierId,
  carrierTrackingHintKey,
  carrierRequirements,
  detectCarrier,
  detectCarrierMatch,
  formatTrackingNumber,
  isPlanzerSharedTrackingNumber,
  isValidS10TrackingNumber,
  normalizeTrackingNumber,
  parcelTrackingLinks,
  parcelTrackingNumbers,
  parseTrackingInput,
  supportsSwissPostHandoff,
  tracksAutomatically,
} from './carriers';
import { DEFAULT_CARRIER_COLOR } from './carrierBrand';

/**
 * Organization: number detection has exactly one `it` per carrier ID below
 * (104 total, alphabetical), each covering every known number for that
 * carrier. One carrier may assert many numbers inside its `it`.
 *
 * Research numbers come from delivery-tracker-100-carriers/global-carrier-corpus.json
 * (research date 2026-09-10); each keeps its source URL and evidence role in a
 * comment. "REPORTED REAL" means publicly reported, not independently
 * live-verified. OSS/official/merchant examples are fixtures, never asserted-real
 * shipments. Quarantined and full-barcode records must NOT become positive oracles.
 *
 * Tracking links, text parsing, formatting and other utilities keep their own
 * describes further down; they are a different axis from number detection.
 */

/** The 65 universal-fallback carriers share one profile: selectable, automatic
 * tracking through the universal adapter, and the default carrier color. */
function expectUniversalFallback(id: keyof typeof CARRIERS) {
  const carrier = CARRIERS[id];
  expect(carrier.capabilities.selectable).toBe(true);
  expect(carrier.capabilities.tracking.mode).toBe('automatic');
  expect(carrier.capabilities.tracking.adapter).toBe('universal');
  expect(carrier.color).toBe(DEFAULT_CARRIER_COLOR);
  expect(tracksAutomatically(id)).toBe(true);
}

describe('carrier detection', () => {
  it('aliexpress — AliExpress / Cainiao', () => {
    // REPORTED REAL cross-border Cainiao ID linked with PostNL CK089862199NL;
    // attribution is reported, not independently live-verified.
    // Source: https://www.paketda.de/fragen-antworten.php
    // No exclusive number regex by design: manual/official-link selection that
    // accepts partner and proprietary numbers.
    expect(detectCarrierMatch('CNG00798678939847')).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(detectCarrierMatch('CNG00798678939847').candidates).toContain('colis-prive');
    // OSS EXAMPLE, Latvian postal identifier from a Cainiao SDK realtime example;
    // a partner-postal fixture, not a Cainiao-issued pattern (research-only role).
    // Source: https://github.com/trackingmore100/tracking-sdk-php/blob/master/README.md
    expect(detectCarrier('UB209300714LV')).toBe('intl-post');
  });

  it('amazon-logistics — Amazon Logistics', () => {
    expect(detectCarrier('FR1234567890')).toBe('amazon-logistics');
    expect(detectCarrier('fr 1234-567890')).toBe('amazon-logistics');
    // REPORTED REAL TBA label.
    // Source: https://github.com/jkeen/tracking_number_data/issues/2
    expect(detectCarrier('TBA333656997000')).toBe('amazon-logistics');
    // FAKE/SYNTHETIC TBA fixtures from the OSS corpus (same shape, not real shipments).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/amazon.json
    expect(detectCarrier('TBA000000000000')).toBe('amazon-logistics');
    expect(detectCarrier('TBA010000000000')).toBe('amazon-logistics');
    expect(detectCarrier('TBA000000000001')).toBe('amazon-logistics');
    // TBC/TBM/C families need regional endpoint verification, not the France route.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/amazon.json
    expect(detectCarrier('TBC 000000000000')).toBe('unknown');
    expect(detectCarrier('TBM502887274000')).toBe('unknown');
    expect(detectCarrier('C1004444443')).toBe('unknown');
    expect(detectCarrier('C1004444444')).toBe('unknown');
    expect(detectCarrier('ZZ0000000001')).not.toBe('amazon-logistics');
    // Country-prefix retail identifiers (synthetic shape checks across marketplaces).
    for (const prefix of ['FR', 'DE', 'BE', 'UK', 'GB', 'IT', 'ES', 'NL', 'AT', 'IE', 'PL', 'SE', 'PT', 'CH']) {
      expect(parseTrackingInput(`Your parcel: ${prefix}0000000001`)).toMatchObject({ carrier: 'amazon-logistics', trackingNumber: `${prefix}0000000001` });
      expect(parseTrackingInput(`Your parcel: ${prefix} 0000-000001`)).toMatchObject({ carrier: 'amazon-logistics', trackingNumber: `${prefix} 0000-000001` });
    }
  });

  it('amazon-shipping — Amazon Shipping', () => {
    // No exclusive number detector: FR/TBA numbers reconcile to amazon-logistics
    // until public Shipping verification confirms the parcel.
    expect(detectCarrier('TBA000000000001')).toBe('amazon-logistics');
    expect(CARRIERS['amazon-shipping'].capabilities.selectable).toBe(false);
    expect(CARRIERS['amazon-shipping'].capabilities.tracking.adapter).toBe('amazon-shipping');
    expect(parcelTrackingLinks({ carrier: 'amazon-shipping', trackingNumber: 'UK0000000001' })[0])
      .toMatchObject({ name: 'Amazon Shipping', url: 'https://track.amazon.co.uk/tracking/UK0000000001' });
  });

  it('an-post — An Post', () => {
    // REPORTED REAL label report.
    // Source: https://www.trustpilot.com/review/www.anpost.com
    expect(detectCarrier('CP476340265IE')).toBe('an-post');
    expectUniversalFallback('an-post');
  });

  it('aramex — Aramex', () => {
    // OSS EXAMPLE fixture (not asserted real).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    const match = detectCarrierMatch('30109165494');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('aramex');
    expectUniversalFallback('aramex');
  });

  it('asendia — Asendia', () => {
    expect(detectCarrier('ASE12345678')).toBe('asendia');
    // OSS postal partner fixture — not an exclusive Asendia signature (research-only role).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('LN242142606US')).toBe('intl-post');
    // MERCHANT EXAMPLE labeled for Asendia, but an La Poste S10 shape routing with its issuer.
    // Source: https://marketplace.fnacdarty.com/s/article/Dois-je-obligatoirement-renseigner-un-num%C3%A9ro-de-suivi-tracking-pour-ma-commande?language=fr_BE
    expect(detectCarrier('LF079877211FR')).toBe('la-poste');
  });

  it('australia-post — Australia Post', () => {
    // Tutorial fixtures needing corroboration — not exclusive detectors (research-only).
    // Source: https://github.com/clooney/australia-post-tracking-api/blob/master/australia-post-tracking-api-python.md
    const numeric = detectCarrierMatch('0301006785462006320995');
    expect(numeric.carrier).toBe('unknown');
    expect(numeric.candidates).not.toContain('australia-post');
    expect(detectCarrier('LK201223662AU')).toBe('intl-post');
    expect(detectCarrier('LH290032509AU')).toBe('intl-post');
    expectUniversalFallback('australia-post');
  });

  it('austrian-post — Austrian Post', () => {
    // OFFICIAL EXAMPLE, 22-digit homepage illustration (ambiguous with USPS/CT T Express).
    // Source: https://www.post.at/
    const match = detectCarrierMatch('1011236513864670170531');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('austrian-post');
    // QUARANTINED inbound DE-suffixed sample: fails the S10 check digit, so it is
    // neither an Austrian-issuer rule nor DHL. Source string kept unchanged.
    // Source: https://www.post.at/
    expect(isValidS10TrackingNumber('CA482156827DE')).toBe(false);
    expect(detectCarrier('CA482156827DE')).toBe('unknown');
    expectUniversalFallback('austrian-post');
  });

  it('blue-dart — Blue Dart', () => {
    // OFFICIAL write-to-us examples plus one public complaint shipment (11 digits;
    // waybill and reference are separate selectable input modes, not asserted here).
    // Sources: https://www.bluedart.com/write-to-us and https://www.consumercomplaints.in/blue-dart-express-b100070
    for (const number of ['79034111122', '79034111041', '90617363115']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('blue-dart');
    }
    expectUniversalFallback('blue-dart');
  });

  it('bpost — bpost', () => {
    // REPORTED REAL label reports, S10 BE.
    // Sources: https://www.test-achats.be/plainte/plaintes-publiques/site-de-plainte-et-suivi-colis/CPTBE01224677-52
    // and https://www.test-achats.be/plainte/plaintes-publiques/colis-perdu-%28voire-vol-C3-A9-en-int/925248238424196550
    expect(detectCarrier('CE500137339BE')).toBe('bpost');
    expect(detectCarrier('UI539489067BE')).toBe('bpost');
    // REPORTED REAL 18/24-digit forms (leading zeros and full precision preserved).
    // Sources: https://www.test-achats.be/plainte/plaintes-publiques/absence-de-possibilit-C3-A9-de-gara/b9311a48ffb765e0aa
    // and https://www.test-achats.be/plainte/plaintes-publiques/facteur-qui-a-renvoyer-un-coli/d5dc57a15ab2b157c6
    for (const number of ['323245067847491492', '323211216300000593107030']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('bpost');
    }
    expectUniversalFallback('bpost');
  });

  it('bring-posten — Bring', () => {
    // OSS EXAMPLE S10 fixture (not asserted real).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('CD656914836NO')).toBe('bring-posten');
    expectUniversalFallback('bring-posten');
  });

  it('brt — BRT', () => {
    // REPORTED REAL shipment vs BRTcode report (both 14 digits; roles preserved).
    // Source: https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/brt-non-mi-consegna-il-pacco-n/c869ef987b19acc348
    for (const number of ['25003180070704', '08454077486990']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('brt');
    }
    // QUARANTINED 15-digit user correction, not carrier-confirmed: never a BRT oracle.
    // Source: https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/firma-falsificata-e-pacco-mai-/f6a66bc9986923ffcf
    expect(detectCarrier('027280011093919')).toBe('unknown');
    expectUniversalFallback('brt');
  });

  it('canada-post — Canada Post', () => {
    // OSS EXAMPLES (leading zeros and mod-10 matter; notice cards are a different input type).
    // Sources: https://github.com/jkeen/tracking_number_data/blob/main/couriers/canadapost.json
    // and https://github.com/karrioapi/karrio/blob/deea10f8568b2d48c71bbcc11ec11c62cdaf2a6a/modules/connectors/canadapost/tests/canadapost/test_tracking.py
    for (const number of ['0073938000549297', '7035114477138472', '4002847016405018', '7023210039414604']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('canada-post');
    }
    expectUniversalFallback('canada-post');
  });

  it('canpar — Canpar', () => {
    // OSS EXAMPLES, D/L/S sampled (first letter and leading zeros preserved; do not
    // confuse D-prefixed Canpar with much shorter D-prefixed OnTrac IDs).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/canpar.json
    for (const number of [
      'D576002440000001718010', 'D576002440000001428004',
      'L576002440000000001004', 'S576002440000000004001',
    ]) {
      expect(detectCarrier(number)).toBe('canpar');
    }
    expectUniversalFallback('canpar');
  });

  it('c-chez-vous — C Chez Vous', () => {
    // OFFICIAL EXAMPLE short code from the order-tracking page.
    // Source: https://www.cchezvous.fr/suivi-colis
    expect(detectCarrier('FGRC45BKLM')).toBe('c-chez-vous');
    // OFFICIAL composite example needs reconstruction with -- for the URL; the raw
    // composite itself is not a number-only oracle.
    // Source: https://www.cchezvous.fr/suivi-colis
    expect(detectCarrier('4TZKO156790--59600')).toBe('unknown');
  });

  it('china-post — China Post', () => {
    // OSS EXAMPLE S10 fixtures (issuer context, not last-mile proof; not asserted real).
    // Source: https://github.com/trackingmore100/tracking-sdk-php/blob/master/README.md
    expect(detectCarrier('RP325552475CN')).toBe('china-post');
    expect(detectCarrier('LZ448865302CN')).toBe('china-post');
    expectUniversalFallback('china-post');
  });

  it('chronopost — Chronopost', () => {
    expect(detectCarrier('XU123456785FR')).toBe('chronopost');
    expect(detectCarrier('XW123456785TS')).toBe('chronopost');
    expect(detectCarrier('PZ123456785JF')).toBe('chronopost');
    // High-impact fix: 14-digits-plus-letter was overbroad high-confidence Chronopost
    // (stole DPD trailing-L reports and La Poste Y merchant examples). Now a low candidate.
    expect(detectCarrierMatch('12345678901234Q')).toMatchObject({
      carrier: 'unknown',
      confidence: 'low',
      candidates: ['chronopost'],
    });
    // REPORTED REAL DPD Germany trailing-L report — a collision needing carrier context.
    // Source: https://www.paketda.de/fragen-antworten.php
    expect(detectCarrierMatch('01196812014637L')).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    // MERCHANT EXAMPLE labeled La Poste by Fnac Darty — same collision.
    // Source: https://marketplace.fnacdarty.com/s/article/Dois-je-obligatoirement-renseigner-un-num%C3%A9ro-de-suivi-tracking-pour-ma-commande?language=fr_BE
    expect(detectCarrierMatch('88000019255788Y')).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    // Historical XF/XA fixtures fall into La Poste S10 (only PZ/XU/XW/XY are excluded);
    // an identity nuance, not a failed lookup — both share the La Poste adapter.
    // Sources: https://gist.github.com/zxp/e83a4a1b7294a5ed6207 and Fnac Darty merchant guidance.
    expect(detectCarrier('XF918805290FR')).toBe('la-poste');
    expect(detectCarrier('XA547564856FR')).toBe('la-poste');
  });

  it('ciblex — Ciblex', () => {
    // 14-digit shipment numbers stay low-confidence suggestions.
    const match = detectCarrierMatch('12345678901234');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('ciblex');
    // REPORTED REAL 24-digit customer label IDs are rejected as-is; a documented
    // barcode-to-waybill conversion is unresolved, so never widen the regex for them.
    // Source: https://fr.trustpilot.com/review/www.ciblex.fr
    for (const number of ['560815852502035603344150', '560815852502035613344150']) {
      expect(detectCarrierMatch(number).candidates).not.toContain('ciblex');
    }
  });

  it('colis-prive — Colis Privé', () => {
    // Bare 12-character IDs are useful real inputs but not complete adapter credentials
    // (the FR adapter needs the 17-char combined credential plus postcode; BE/LU differ).
    // REPORTED REAL bare ID: https://fr-be.trustpilot.com/review/boutikplus.fr
    // MERCHANT EXAMPLES: https://marketplace.fnacdarty.com/s/article/Dois-je-obligatoirement-renseigner-un-num%C3%A9ro-de-suivi-tracking-pour-ma-commande?language=fr_BE
    for (const number of ['HS0000329755', 'R99600071550', 'ZE0000294369']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('colis-prive');
    }
  });

  it('colisweb — Colisweb', () => {
    // Synthetic baseline only (website says at least eight digits; exactly-eight is unproven).
    // Source: https://github.com/plhery/delivery-tracker/blob/739b360d45d1cf723e0058350bcf19f8e373f076/src/lib/carriers.test.ts
    const match = detectCarrierMatch('87654321');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
  });

  it('correios-br — Correios Brazil', () => {
    // OSS EXAMPLE, native BR identifier (not asserted real).
    // Source: https://github.com/guilhermechapiewski/correios-api-py
    expect(detectCarrier('ES446391025BR')).toBe('correios-br');
    // Inbound partner identifiers are different routing cases and stay with their issuer.
    // Sources: https://github.com/leandrotoledo/python-correios (CN) and https://github.com/FelipeMorandini/rastreador_correios (HK)
    expect(detectCarrier('RA222491899CN')).toBe('china-post');
    expect(detectCarrier('LB571181225HK')).toBe('hongkong-post');
    expectUniversalFallback('correios-br');
  });

  it('correos-chile — Correos de Chile', () => {
    // OSS API-usage example: 13 numerics, not the S10 structure (not asserted real).
    // Source: https://github.com/josemontesp/correos
    const match = detectCarrierMatch('3072708247886');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('correos-chile');
    expectUniversalFallback('correos-chile');
  });

  it('correos-express — Correos Express', () => {
    // REPORTED REAL 16-digit shipment IDs (separate from national operator Correos).
    // Sources: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/incidencia-env-C3-ADo-imposible-h/0052eb4a8375da7128
    // and https://www.ocu.org/reclamar/lista-reclamaciones-publicas/pedido-falsamente-entregado/09810690efcb4f7fde
    for (const number of ['7983000739053141', '3230002125829719']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('correos-express');
    }
    // QUARANTINED 23-digit user-supplied report, never carrier-validated: no oracle.
    // Source: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/problema-con-el-repartidor/e30b27faaae7c53755
    expect(detectCarrier('93005001081690801339400')).toBe('unknown');
    expectUniversalFallback('correos-express');
  });

  it('correos-spain — Correos', () => {
    // REPORTED REAL 18-char PR-prefixed specimen (national operator, separate from Correos Express).
    // Source: https://www.htcmania.com/archive/index.php/t-964137.html
    expect(detectCarrier('PR110604670130400C')).toBe('correos-spain');
    // QUARANTINED historical CV S10 shape: fails the checksum, never a positive.
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(isValidS10TrackingNumber('CV000562646ES')).toBe(false);
    expect(detectCarrier('CV000562646ES')).toBe('unknown');
    expect(CARRIERS['correos-spain'].capabilities.selectable).toBe(true);
    expect(CARRIERS['correos-spain'].capabilities.tracking).toMatchObject({ mode: 'automatic', adapter: 'correos-spain' });
    expect(tracksAutomatically('correos-spain')).toBe(true);
    expect(CARRIERS['correos-spain'].trackingUrl?.('PR110604670130400C')).toBe(
      'https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=PR110604670130400C',
    );
  });

  it('ctt — CTT Portugal', () => {
    // REPORTED REAL label (PT marks the issuing network, not necessarily the final operator).
    // Source: https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/ritardo-consegna-raccomandata/f9bc9dea8c8224161d
    expect(detectCarrier('RL402552798PT')).toBe('ctt');
    expect(CARRIERS.ctt.capabilities.selectable).toBe(true);
    expect(CARRIERS.ctt.capabilities.tracking).toMatchObject({ mode: 'automatic', adapter: 'ctt' });
    expect(tracksAutomatically('ctt')).toBe(true);
    expect(CARRIERS.ctt.trackingUrl?.('RL402552798PT')).toBe(
      'https://www.ctt.pt/feapl_2/app/open/objectSearch/objectSearch.jspx?objects=RL402552798PT',
    );
  });

  it('ctt-express — CTT Express', () => {
    // REPORTED REAL 22-digit barcodes beginning 00 (leading zeros preserved; keep
    // postal CTT separate from Express numeric identifiers).
    // Sources: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/reclamaci-C3-B3n-por-p-C3-A9rdida-de-mer/da714ccf4d8f261583
    // and https://www.ocu.org/reclamar/empresas/ctt-express/3C8C0C39-1EAE90226
    for (const number of ['0082800011298638008391', '0082800082809771393048', '0082800082809771598159']) {
      expect(detectCarrier(number)).toBe('ctt-express');
    }
    expectUniversalFallback('ctt-express');
  });

  it('dachser — Dachser', () => {
    // Synthetic baseline only (Customer Iberia needs the complete capability URL;
    // a bare number or generic freight label proves nothing about the route).
    // Source: https://github.com/plhery/delivery-tracker/blob/739b360d45d1cf723e0058350bcf19f8e373f076/src/lib/carriers.test.ts
    expect(detectCarrier('9010000001234')).toBe('unknown');
  });

  it('delhivery — Delhivery', () => {
    // OSS gist example plus one public complaint (13/14 digits; not asserted real).
    // Sources: https://gist.github.com/gauravsoti1/c2dc7e709401e89be5cf5701c917dd97 and https://www.consumercomplaints.in/delhivery-b103998
    for (const number of ['1623110010010', '32076610152736']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('delhivery');
    }
    expectUniversalFallback('delhivery');
  });

  it('delivengo — Delivengo', () => {
    // Inherited public LD…FR example overlapping La Poste on purpose (manual choice,
    // shared adapter); attribution inherited from the repo, not independently rechecked.
    // Original source (not reloaded): https://www.philaseiten.de/cgi-bin/index.pl?PR=319289
    expect(detectCarrier('LD156008025FR')).toBe('la-poste');
  });

  it('dhl — DHL', () => {
    for (const number of ['LF123456785DE', 'LX123456785DE', 'CY123456785DE']) {
      expect(detectCarrierMatch(number)).toEqual({
        carrier: 'dhl', confidence: 'high', candidates: ['dhl'],
      });
    }
    expect(detectCarrier('lf 123.456-785 de')).toBe('dhl');
    expect(detectCarrier('LF123456789DE')).toBe('unknown');
    expect(detectCarrier('LF123456785US')).toBe('intl-post');
    // MERCHANT EXAMPLE, Fnac Darty JD family (JD + 18 digits, distinct from JJD/JVGL
    // and from InPost legacy JD + 16 digits).
    // Source: https://marketplace.fnacdarty.com/s/article/Dois-je-obligatoirement-renseigner-un-num%C3%A9ro-de-suivi-tracking-pour-ma-commande?language=fr_BE
    expect(detectCarrier('JD014600011678034918')).toBe('dhl');
    // REPORTED REAL 20-digit DHL shipment in the 00340434 range.
    // Source: https://www.paketda.de/fragen-antworten
    expect(detectCarrierMatch('00340434633751428115')).toEqual({
      carrier: 'dhl', confidence: 'high', candidates: ['dhl'],
    });
    expect(detectCarrier('JJD0099999999')).toBe('dhl');
    expect(detectCarrier('JVGL0099999999')).toBe('dhl');
    expect(tracksAutomatically('dhl')).toBe(true);
    expect(carrierTrackingHintKey('dhl')).toBe('add.autoSync');
  });

  it('dhl-ecommerce — DHL eCommerce', () => {
    expect(detectCarrierMatch('33870000000000001')).toMatchObject({ carrier: 'unknown', confidence: 'low', candidates: ['dhl-ecommerce'] });
    expect(detectCarrier('GM1234567890123456')).toBe('dhl-ecommerce');
    // OFFICIAL API-doc identifiers (customer packageId vs DHL dhlPackageId).
    // Source: https://developer.dhl.com/api-reference/references-dhl-ecommerce-americas
    expect(detectCarrier('GM60511234500000001')).toBe('dhl-ecommerce');
    const numeric = detectCarrierMatch('3387191106122423');
    expect(numeric).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(numeric.candidates).toContain('dhl-ecommerce');
    // Partner-postal/USPS delivery-number fields are research-only roles, not package IDs.
    // Source: https://developer.dhl.com/api-reference/references-dhl-ecommerce-americas
    expect(detectCarrier('9361269903500011492028')).toBe('unknown');
    expect(detectCarrier('9261269903500013618305')).toBe('unknown');
    // 31-digit intelligent-mail barcodes are non-parcel inputs.
    // Source: https://developer.dhl.com/api-reference/references-dhl-ecommerce-americas
    expect(detectCarrier('0031043534391627906195625053434')).toBe('unknown');
    expect(detectCarrier('0031043534391640211895625057522')).toBe('unknown');
    expect(tracksAutomatically('dhl-ecommerce')).toBe(true);
    for (const url of [
      'https://www.dhl.com/ch-en/home/tracking.html?tracking-id=33870000000000001',
      'https://ecommerceportal.dhl.com/track/?tracking-id=ABC123456',
      'https://webtrack.dhlglobalmail.com/?trackingnumber=ABC123456',
    ]) expect(parseTrackingInput(url)).toMatchObject({ carrier: 'dhl-ecommerce', confidence: 'high', source: 'link' });
    expect(parseTrackingInput('https://www.dhl.com/ch-en/home/tracking.html?tracking-id=LF123456785DE').carrier).toBe('dhl');
    expect(parseTrackingInput('https://www.dhl.de/int-verfolgen/?piececode=1234567890').carrier).toBe('dhl');
    expect(parseTrackingInput('https://ecommerceportal.dhl.com.evil.example/?tracking-id=ABC123456').carrier).not.toBe('dhl-ecommerce');
  });

  it('dpd — DPD', () => {
    // REPORTED REAL Swiss forum sample (Swiss four-digit postcode context lives in the adapter).
    // Source: https://www.paketda.de/fragen-antworten.php
    const match = detectCarrierMatch('06086216767970');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('dpd');
  });

  it('dpd-fr — DPD France', () => {
    expect(detectCarrier('250123456789012')).toBe('dpd-fr');
    // MERCHANT EXAMPLES, Fnac Darty (never force global DPD traffic through France).
    // Source: https://marketplace.fnacdarty.com/s/article/Dois-je-obligatoirement-renseigner-un-num%C3%A9ro-de-suivi-tracking-pour-ma-commande?language=fr_BE
    for (const number of ['1595193512495', '10764000276716']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('dpd-fr');
    }
  });

  it('dtdc — DTDC', () => {
    // OSS EXAMPLE fixture (not asserted real).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('N95614372')).toBe('dtdc');
    expectUniversalFallback('dtdc');
  });

  it('ecoscooting — Ecoscooting', () => {
    // REPORTED REAL 18-digit IDs across prefixes (never steal Swiss 18-digit barcodes;
    // LP/AP marketplace formats remain unsampled).
    // Sources: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/cuidado-con-ecoscooting/eec55dfee3121ef28c
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/las-entregas-no-llegan-/a9ac02ca080289f896
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/pedido-nunca-llega/571d0533088b8ba848
    for (const number of ['081730000038942441', '380030000066362966', '380030000066782505', '083030000063547779']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('ecoscooting');
    }
    // Foreign postal identifier from a handoff report stays with its issuer.
    // Source: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/paquete-extraviado-cq34377077/a9305cbaea4cb4fa5a
    expect(detectCarrier('CQ343770772DE')).toBe('dhl');
    expectUniversalFallback('ecoscooting');
  });

  it('estafeta — Estafeta', () => {
    // OSS SDK EXAMPLE, historical 10-digit tracking code (22-digit waybill is separate).
    // Source: https://github.com/dmoralesm/estafeta-api
    const match = detectCarrierMatch('2806075762');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('estafeta');
    expectUniversalFallback('estafeta');
  });

  it('evri — Evri', () => {
    // MERCHANT EXAMPLE with internal letters (a digits-only validator would reject it;
    // distinct from Hermes Einrichtungs-Service and Hermes Germany H-digits).
    // Source: https://wobaaa.com/aliexpress-uk-tracking-numbers/
    expect(detectCarrier('H06R4A1011299623')).toBe('evri');
    expectUniversalFallback('evri');
  });

  it('fedex — FedEx', () => {
    // OSS EXAMPLE 12-digit fixtures stay ambiguous suggestions.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/fedex.json
    for (const number of ['986578788855', '477179081230']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('fedex');
    }
    const fifteen = detectCarrierMatch('041441760228964');
    expect(fifteen).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(fifteen.candidates).toContain('fedex');
    // Full 18/22/32/34 barcode fixtures need format-specific extraction; they are
    // not ordinary tracking numbers and never route to FedEx by length alone.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/fedex.json
    for (const number of [
      '1001921334250001000300779017972697',
      '32971514560102447849175802862014',
      '000123450000000027',
      '9611020987654312345672',
      '9622001900000000000000776632517510',
    ]) {
      expect(detectCarrier(number)).toBe('unknown');
      expect(detectCarrierMatch(number).candidates).not.toContain('fedex');
    }
  });

  it('four-px — 4PX', () => {
    // OSS EXAMPLE (4PX + 13 digits + CN; not asserted real).
    // Source: https://github.com/rostis232/parcelstrackingservice
    expect(detectCarrier('4PX3001521662170CN')).toBe('four-px');
    expectUniversalFallback('four-px');
  });

  it('geodis — GEODIS', () => {
    expect(detectCarrier('1G123GEODIS0')).toBe('geodis');
    // REPORTED REAL 1G… recipient-format specimen (general freight references and
    // SSCCs remain outside the demonstrated recipient route).
    // Source: https://suivi-colis.org/espacedestinataire-livraison-geodis/
    expect(detectCarrier('1GWSKFLSKX4Y')).toBe('geodis');
  });

  it('gls-ch — GLS Switzerland', () => {
    // Synthetic baseline only (Swiss origin can never come from broad lengths alone).
    // Source: https://github.com/plhery/delivery-tracker/blob/739b360d45d1cf723e0058350bcf19f8e373f076/src/lib/carriers.test.ts
    const match = detectCarrierMatch('993990103198');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('gls-ch');
  });

  it('gls-de — GLS Germany', () => {
    // REPORTED REAL eight-character and eleven-digit samples (postcode context lives
    // in the adapter; broad lengths alone prove nothing).
    // Source: https://www.paketda.de/fragen-antworten.php?suche_carrier=gls
    for (const number of ['Z6E5E29R', '10272483975']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('gls-de');
    }
  });

  it('gls-fr — GLS France', () => {
    expect(detectCarrier('00AB12CD')).toBe('gls-fr');
    // REPORTED REAL 00/other Track IDs.
    // Sources: https://forum.quechoisir.org/probleme-colis-mondial-relay-gls-t286523.html (00E7V8YY)
    // https://forum.quechoisir.org/probleme-colis-mondial-relay-gls-t286523-40.html (ZBH2FY7Q)
    expect(detectCarrier('00E7V8YY')).toBe('gls-fr');
    expect(detectCarrier('00IU9SEC')).toBe('gls-fr');
    for (const number of ['ZBH2FY7Q', '20189360332']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('gls-fr');
    }
    // MERCHANT EXAMPLE 12-digit specimen (Fnac Darty) — a low suggestion, not a win.
    // Source: https://marketplace.fnacdarty.com/s/article/Dois-je-obligatoirement-renseigner-un-num%C3%A9ro-de-suivi-tracking-pour-ma-commande?language=fr_BE
    const merchant = detectCarrierMatch('123416227171');
    expect(merchant).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(merchant.candidates).toContain('gls-fr');
  });

  it('gofo — GOFO Express', () => {
    // OSS EXAMPLES, US GFUS + 14 digits family (other regions unverified; not asserted real).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/gofo.json
    for (const number of ['GFUS01011884214464', 'GFUS01011884214272']) {
      expect(detectCarrier(number)).toBe('gofo');
    }
    expectUniversalFallback('gofo');
  });

  it('heppner — Heppner', () => {
    // Explicit synthetic existing fixture only (receipt + postcode live in the adapter).
    // Source: https://github.com/plhery/delivery-tracker/blob/739b360d45d1cf723e0058350bcf19f8e373f076/src/server/heppner.test.ts
    const match = detectCarrierMatch('23456789');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('heppner');
  });

  it('hermes — Hermes Einrichtungs-Service', () => {
    // Baseline only: repo-called official/public HES sample, not fresh verification.
    // (Furniture-service Hermes, not German small-parcel Hermes or UK Evri.)
    // Source: https://github.com/plhery/delivery-tracker/blob/739b360d45d1cf723e0058350bcf19f8e373f076/src/server/hermes.live.test.ts
    expect(detectCarrier('62162057330000611')).toBe('unknown');
  });

  it('hermes-de — Hermes Germany', () => {
    // REPORTED REAL 14-digit reports stay intentionally ambiguous with shared numerics.
    // Source: https://www.paketda.de/fragen-antworten.php?suche_carrier=hermes
    for (const number of ['02310181006981', '02180171003654', '11204181008466']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('hermes-de');
    }
    // H-prefixed numbers are recognized from text without assigning every
    // fourteen-digit number to Hermes (H… must stay distinct from Evri alphanumerics).
    expect(parseTrackingInput('Parcel H1234567890123456789 is coming')).toMatchObject({ carrier: 'hermes-de' });
    expect(parseTrackingInput('https://evil.test/myhermes.de#H1234567890123456789').trackingUrl).toBeUndefined();
  });

  it('hongkong-post — Hongkong Post', () => {
    // OSS EXAMPLE S10 fixture (not asserted real).
    // Source: https://github.com/marcoesposito1988/trackingmore-python
    expect(detectCarrier('RE113184005HK')).toBe('hongkong-post');
    expectUniversalFallback('hongkong-post');
  });

  it('india-post — India Post', () => {
    expect(detectCarrier('JN067614884IN')).toBe('india-post');
    expect(detectCarrier('jn 067.614-884 in')).toBe('india-post');
    expect(detectCarrier('JN067614885IN')).toBe('unknown');
    // OSS historical S10 fixture, checksum-valid (portal coverage is not every product).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('ED415656540IN')).toBe('india-post');
  });

  it('inpost — InPost', () => {
    // OSS legacy-Yodel 8YDR family (Yodel became InPost on 2026-07-17; keep aliases).
    // Source: https://github.com/jkeen/tracking_number_data/issues/91
    expect(detectCarrier('8YDR098765432')).toBe('inpost');
    // Legacy illustrative JD + 16 digits stays a low suggestion.
    // Source: https://github.com/jkeen/tracking_number_data/issues/91
    const jd = detectCarrierMatch('JD0002123456789012');
    expect(jd).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(jd.candidates).toContain('inpost');
    // Legacy JJD collides with the existing high-confidence DHL prefix rule:
    // official domain or explicit carrier selection must win over number alone.
    // Sources: https://wobaaa.com/aliexpress-uk-tracking-numbers/ and https://github.com/jkeen/tracking_number_data/issues/91
    expect(detectCarrier('JJD0002233564270287')).toBe('dhl');
    expect(detectCarrier('JJD0002123456789012')).toBe('dhl');
    // OSS 24-digit InPost CLI example stays ambiguous with bpost 24-digit.
    // Source: https://github.com/alufers/inpost-cli
    const long = detectCarrierMatch('642600027844200234823732');
    expect(long).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(long.candidates).toContain('inpost');
    // Legacy dotted reference normalizes to 8 digits (shared ambiguous family, not an oracle).
    // Source: https://github.com/jkeen/tracking_number_data/issues/91
    expect(detectCarrier('0980982.1')).toBe('unknown');
    expect(CARRIERS.inpost.capabilities.selectable).toBe(true);
    expect(CARRIERS.inpost.capabilities.tracking).toMatchObject({ mode: 'automatic', adapter: 'inpost' });
    expect(tracksAutomatically('inpost')).toBe(true);
  });

  it('intl-post — Unknown postal carrier', () => {
    expect(detectCarrier('RA123456785DE')).toBe('intl-post');
    expect(detectCarrier('CN987654326US')).toBe('intl-post');
    expect(tracksAutomatically('intl-post')).toBe(true);
  });

  it('j-and-t — J&T Express', () => {
    // REPORTED REAL Indonesian numeric shipment, spaces as printed (common JO/JP
    // prefixes and other regional formats remain unsampled).
    // Source: https://news.detik.com/suara-pembaca/d-3988487/paket-dinyatakan-hilang-j-t-menolak-mengganti-penuh
    const match = detectCarrierMatch('888 058 657 515');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('j-and-t');
    expectUniversalFallback('j-and-t');
  });

  it('japan-post — Japan Post', () => {
    // OSS EXAMPLE S10 fixture (not asserted real).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('CI076369983JP')).toBe('japan-post');
    // Official-page non-tracking example: fails S10, never a positive.
    // Source: https://www.post.japanpost.jp/service/send/oversea/information/ems_search_en.html
    expect(isValidS10TrackingNumber('UL123456789JP')).toBe(false);
    expect(detectCarrier('UL123456789JP')).toBe('unknown');
    expectUniversalFallback('japan-post');
  });

  it('jd-logistics — JD Logistics', () => {
    // OSS EXAMPLE fixture, VG + 11 digits (modern variants remain to be established).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('VG05778167021')).toBe('jd-logistics');
    expectUniversalFallback('jd-logistics');
  });

  it('korea-post — Korea Post', () => {
    // OSS EXAMPLE S10 fixture (not asserted real).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('EM385783825KR')).toBe('korea-post');
    expectUniversalFallback('korea-post');
  });

  it('la-poste — La Poste / Colissimo', () => {
    expect(detectCarrier('8G12345678901')).toBe('la-poste');
    expect(detectCarrier('RA123456785FR')).toBe('la-poste');
    // REPORTED REAL 8U/8G specimens.
    // Sources: https://forum.quechoisir.org/retour-colis-rue-du-commerce-t18643.html (8U01130342039)
    // and https://forum.quechoisir.org/arnaque-par-rue-du-commerce-je-demande-justice-t22371.html (8G45061126689)
    expect(detectCarrier('8U01130342039')).toBe('la-poste');
    expect(detectCarrier('8G45061126689')).toBe('la-poste');
    // MERCHANT EXAMPLES, Fnac Darty 6A families route with La Poste; bare 14-digit
    // merchant numbers stay ambiguous and need carrier confirmation.
    // Source: https://marketplace.fnacdarty.com/s/article/Dois-je-obligatoirement-renseigner-un-num%C3%A9ro-de-suivi-tracking-pour-ma-commande?language=fr_BE
    expect(detectCarrier('6A62957360897')).toBe('la-poste');
    expect(detectCarrier('6A61031888418')).toBe('la-poste');
    for (const number of ['87000918244878', '87000918635108']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    }
  });

  it('landmark-global — Landmark Global', () => {
    // OSS EXAMPLES, LTN + 8 digits + N1 (never generalize terminal N1 to all products).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/landmark.json
    for (const number of ['LTN74207623N1', 'LTN74209518N1', 'LTN74224021N1']) {
      expect(detectCarrier(number)).toBe('landmark-global');
    }
    expectUniversalFallback('landmark-global');
  });

  it('mondial-relay — Mondial Relay', () => {
    // REPORTED REAL short shipment numbers (postcode-gated in the adapter).
    // Source: https://suivi-colis.org/mondial-relay/
    for (const number of ['87778793', '98911884']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('mondial-relay');
    }
    // REPORTED REAL 10-digit shipment.
    // Source: https://suivi-colis.org/mondial-relay/
    const ten = detectCarrierMatch('4744000791');
    expect(ten).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(ten.candidates).toContain('mondial-relay');
    // REPORTED REAL 26-digit return-label barcode: checksum-validated, tracked through
    // its public 12-digit alias without a postcode (routing suffix is not a postcode).
    // Source: https://forum.quechoisir.org/probleme-colis-mondial-relay-gls-t286523-40.html
    expect(detectCarrierMatch('73800244620101503002000732')).toMatchObject({ carrier: 'mondial-relay', confidence: 'high' });
    const barcode = '12123456780101006623123454';
    expect(detectCarrierMatch(barcode)).toMatchObject({ carrier: 'mondial-relay', confidence: 'high' });
    expect(parseTrackingInput(`Parcel tracking: ${barcode}`)).toMatchObject({ carrier: 'mondial-relay', trackingNumber: barcode });
    expect(carrierRequirements('mondial-relay', barcode)).toEqual([]);
    expect(parcelTrackingLinks({ carrier: 'mondial-relay', trackingNumber: barcode })[0].url)
      .toBe('https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=121234567801');
    expect(detectCarrierMatch('0'.repeat(26)).carrier).not.toBe('mondial-relay');
    for (const number of [barcode.slice(0, -1) + '5', barcode.slice(0, 14) + '1' + barcode.slice(15)]) {
      expect(detectCarrierMatch(number).carrier).not.toBe('mondial-relay');
    }
  });

  it('mrw — MRW', () => {
    // REPORTED REAL letter-containing 12-char variants (distinctive high-confidence family).
    // Sources: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/alguien-recibi-C3-B3-mi-paquete/f4db963472379569e8 (08203F557102)
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/mi-paquete-lleva-en-22transito-22/3ca104c95fcd6886da (02680I390427)
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/paquete-no-entregado/fd09f6a9ec09f35aab (02692M027981)
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/reembolso/6d4f300aa0dd6d5c26 (02673I145025)
    for (const number of ['08203F557102', '02680I390427', '02692M027981', '02673I145025']) {
      expect(detectCarrier(number)).toBe('mrw');
    }
    // REPORTED REAL pure-numeric 12-digit variant stays ambiguous (never overrides FedEx).
    // Source: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/paquete-perdido/f8b8fd62addc12cbed
    const numeric = detectCarrierMatch('038233020970');
    expect(numeric).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(numeric.candidates).toContain('mrw');
    expectUniversalFallback('mrw');
  });

  it('nacex — NACEX', () => {
    // REPORTED REAL agency/shipment composites: the slash boundary is preserved and is
    // not a plain numeric tracking ID until carrier-specific parsing applies.
    // Sources: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/no-entrega-de-envio-a-tiempo/dca1c166a05005867c
    // and https://www.ocu.org/reclamar/lista-reclamaciones-publicas/reclamaci-C3-B3n-por-da-C3-B1o-a-mercanc/7bf1f90f3a5fe7d8cb
    expect(detectCarrier('2103/11207088')).toBe('nacex');
    expect(detectCarrier('2850/11247170')).toBe('nacex');
    // The slashed form survives pasting as well: manual entry keeps the slash for
    // saving, and label-led text extracts the composite through candidate scanning.
    expect(parseTrackingInput('2103/11207088')).toMatchObject({
      trackingNumber: '2103/11207088', carrier: 'nacex', confidence: 'high', source: 'number',
    });
    expect(parseTrackingInput('Tracking: 2103/11207088')).toMatchObject({
      trackingNumber: '2103/11207088', carrier: 'nacex', source: 'text',
    });
    expect(parseTrackingInput('Where is my parcel?')).toMatchObject({
      trackingNumber: '', carrier: 'unknown', source: 'none',
    });
    expectUniversalFallback('nacex');
  });

  it('ninja-van — Ninja Van', () => {
    // OFFICIAL API-doc examples, but prefix and length depend on shipper settings, so no
    // exclusive detector yet (around 18 chars is a default, not an invariant).
    // Source: https://api-docs.ninjavan.co/
    expect(detectCarrier('NVSGBEDBP03784ADPL')).toBe('unknown');
    const short = detectCarrierMatch('DX149431');
    expect(short).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expectUniversalFallback('ninja-van');
  });

  it('nz-post — NZ Post', () => {
    // OSS EXAMPLE S10 fixture (not asserted real).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('EP318770974NZ')).toBe('nz-post');
    // Legacy-API placeholder: fails S10, never a positive.
    // Source: https://www.nzpost.co.nz/business/developer-centre/nz-post-legacy-apis/tracking-api/track-method
    expect(isValidS10TrackingNumber('XY123456789NZ')).toBe(false);
    expect(detectCarrier('XY123456789NZ')).toBe('unknown');
    expectUniversalFallback('nz-post');
  });

  it('old-dominion — Old Dominion', () => {
    // OSS EXAMPLE freight PROs (lower parcel priority, but the repo already supports
    // freight; upstream Luhn-validates while bare numerics stay collision-prone).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/old_dominion.json
    for (const number of ['07209562763', '77767553207', '77806528897', '78045768393', '80003280379', '80993847369']) {
      expect(detectCarrier(number)).toBe('old-dominion');
    }
    expectUniversalFallback('old-dominion');
  });

  it('ontrac — OnTrac', () => {
    // OSS EXAMPLES, C/D + 14 digits.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/ontrac.json
    for (const number of ['C11031500001879', 'C11121552953069', 'D10011354453707', 'D10011345983010']) {
      expect(detectCarrier(number)).toBe('ontrac');
    }
    // OSS legacy LaserShip L-letter + 8 digits (LA/LI/LE/LH/LN forms).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/lasership.json
    for (const number of ['LX17635036', 'LI12976442', 'LA28376237', 'LH13830790', 'LE10917377', 'LN30083672']) {
      expect(detectCarrier(number)).toBe('ontrac');
    }
    // OSS 1LS families; the raw -1 suffix is preserved for the carrier-specific parser.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/lasership.json
    for (const number of ['1LS717793482164', '1LS724505321754', '1LS7119013618127-1', '1LSCXVE0058631Y', '1LSCXVE005BUEFX']) {
      expect(detectCarrier(number)).toBe('ontrac');
    }
    // Collision note: a REPORTED REAL Paack C-family identifier matches OnTrac C + 14
    // digits, so explicit carrier selection must win over number alone.
    // Source: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/entrega-no-recibida/4d61e00924bdfeea75
    expect(detectCarrier('C25062001456003')).toBe('ontrac');
    expectUniversalFallback('ontrac');
  });

  it('paack — Paack', () => {
    // No exclusive number detector by design: reported identifiers span 9–29 chars with
    // letters, and broad guesses would cause false carrier selections. All of these need
    // explicit selection plus the delivery postcode.
    // Sources (all https://www.ocu.org OCU public complaints):
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/no-me-llega-el-pedido/4032cceef0a358e05d (16-digit)
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/incumplimient-reiterado-y-bloq/23dcce3eced56549b3 (18-digit)
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/falso-intento-de-entrega/373a062914965f9e1b (9-digit)
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/mucho-retraso-en-entrega/3e6c4a88d9208bdbc4 (29-digit)
    expect(detectCarrierMatch('9451162004086887').carrier).toBe('unknown');
    expect(detectCarrierMatch('534000021250958171').carrier).toBe('unknown');
    expect(detectCarrierMatch('437650784').carrier).toBe('unknown');
    expect(detectCarrier('00100909086360120251130131718')).toBe('unknown');
  });

  it('packeta — Packeta', () => {
    // REPORTED REAL Z + 10 digits shipments plus the official docs placeholder (same family;
    // sourced web links may use the digits alone as an alternative representation).
    // Sources: https://help.orrs.de/6622/z%C3%A1silkovna-tracking-not-working and https://docs.packeta.com/docs/packet-tracking/tracking
    for (const number of ['Z8328162951', 'Z8328162946', 'Z8360329994', 'Z1234567890']) {
      expect(detectCarrier(number)).toBe('packeta');
    }
    expect(CARRIERS.packeta.trackingUrl?.('Z1234567890')).toBe('https://tracking.packeta.com/en/Z1234567890');
    expect(CARRIERS.packeta.capabilities.selectable).toBe(true);
    expect(CARRIERS.packeta.capabilities.tracking).toMatchObject({ mode: 'automatic', adapter: 'packeta' });
    expect(tracksAutomatically('packeta')).toBe(true);
  });

  it('parcelforce — Parcelforce Worldwide', () => {
    // OFFICIAL EXAMPLE distinguished from Royal Mail by its EA/EB/EC/ED/EE/CP prefix
    // (kept as a separate product/route even where infrastructure is shared).
    // Source: https://www.royalmail.com/royal-mail-you/intellectual-property-rights/linking-our-website
    expect(detectCarrier('EC080250821GB')).toBe('parcelforce');
    expectUniversalFallback('parcelforce');
  });

  it('planzer — Planzer', () => {
    // Planzer-issued 20-digit delivery IDs carry the 91346097 prefix (synthetic
    // shape checks); any other bare 20-digit number stays out of Planzer routing.
    expect(detectCarrierMatch('91346097123456789012')).toEqual({
      carrier: 'planzer', confidence: 'high', candidates: ['planzer'],
    });
    expect(detectCarrierMatch('91346 09712 34567 89012')).toEqual({
      carrier: 'planzer', confidence: 'high', candidates: ['planzer'],
    });
    expect(detectCarrier('999.90.03316119')).toBe('planzer');
    expect(detectCarrier('9999003316119')).toBe('planzer');
    expect(isPlanzerSharedTrackingNumber('999.90.03316119')).toBe(true);
    expect(isPlanzerSharedTrackingNumber('91346097123456789012')).toBe(false);
    // OSS alternate-route examples (eight-digit shipment route and IKEA composite order
    // reference) belong to a separate integration lead, not the 20-digit deliveryNumber route.
    // Source: https://github.com/ha-parcel-integrations/ha-planzer/blob/main/README.md
    expect(detectCarrier('12345678')).toBe('unknown');
    expect(detectCarrier('98765.0012345678')).toBe('unknown');
  });

  it('poczta-polska — Poczta Polska', () => {
    // OFFICIAL tracking-page placeholders (illustrative, not real shipments).
    // Source: https://www.poczta-polska.pl/en/sledzenie-przesylek/
    expect(detectCarrier('PX0000000013')).toBe('poczta-polska');
    const numeric = detectCarrierMatch('0015900773312345678');
    expect(numeric).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(numeric.candidates).toContain('poczta-polska');
    // Placeholder S10 shapes that fail the checksum are never positives.
    // Source: https://www.poczta-polska.pl/en/sledzenie-przesylek/
    for (const number of ['RR123456789PL', 'CP123456789PL', 'VV123456789PL', 'EE123456789PL']) {
      expect(isValidS10TrackingNumber(number)).toBe(false);
      expect(detectCarrier(number)).toBe('unknown');
    }
    expectUniversalFallback('poczta-polska');
  });

  it('pos-malaysia — Pos Malaysia', () => {
    // OFFICIAL API-doc examples plus OSS S10 fixtures.
    // Sources: https://api-doc.pos.com.my/ and https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('MYPM00000000015')).toBe('pos-malaysia');
    expect(detectCarrier('MYPM00000000017')).toBe('pos-malaysia');
    expect(detectCarrier('RR157638464MY')).toBe('pos-malaysia');
    expect(detectCarrier('RR158903660MY')).toBe('pos-malaysia');
    expect(CARRIERS['pos-malaysia'].capabilities.selectable).toBe(true);
    expect(CARRIERS['pos-malaysia'].capabilities.tracking).toMatchObject({ mode: 'automatic', adapter: 'pos-malaysia' });
    expect(tracksAutomatically('pos-malaysia')).toBe(true);
    // Path-form deep link: the SPA picks the code up as a chip and runs the
    // lookup automatically (verified live; ?id= and #trackingIds= do not prefill).
    expect(CARRIERS['pos-malaysia'].trackingUrl?.('MYPM00000000015')).toBe('https://tracking.pos.com.my/tracking/MYPM00000000015');
  });

  it('poste-italiane — Poste Italiane', () => {
    // REPORTED REAL specimens (RA… has no country suffix, so it is not S10; 1UW
    // samples are 13 chars, not 12; SDA stays a routing alias, not a provider).
    // Sources (all https://www.altroconsumo.it public complaints):
    // spedizione-persa/f51f02b1ee980bd0bd, nessuno-sa-dove-si-trova-il-mi/d6bbf9fcb0dad025b2,
    // posta-delivery-attesa-pi-C3-B9-di-2/862635c7ab6f209ad0 (×2),
    // poste-non-consegna-resa-al-mi/8b8789c70e8c99692a, rimborso-merce-spedizione-smar/6a89612b76f513e66c,
    // consegna-mai-ricevuta/97b85e8cbc17700047
    for (const number of [
      'RA00020974503', '1UW1G2J193065', '1UW1GF0355933', '1UW1GF0359668',
      '5P38C32989681', '3UW1GY0000066', '2IMA0051035900',
    ]) {
      expect(detectCarrier(number)).toBe('poste-italiane');
    }
    // Foreign-issued inbound NL S10 stays with PostNL.
    // Source: https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/reso-ritornato-al-mittente-e-p/5341225f84324f54e4
    expect(detectCarrier('CH166307960NL')).toBe('spring-gds');
    expect(CARRIERS['poste-italiane'].capabilities.selectable).toBe(true);
    expect(CARRIERS['poste-italiane'].capabilities.tracking).toMatchObject({ mode: 'automatic', adapter: 'poste-italiane' });
    expect(tracksAutomatically('poste-italiane')).toBe(true);
    expect(CARRIERS['poste-italiane'].trackingUrl?.('RA00020974503')).toBe(
      'https://www.poste.it/cerca/index.html#/risultati-spedizioni/RA00020974503',
    );
  });

  it('postnord — PostNord', () => {
    // OSS EXAMPLE request construction (empty shipment response: no-data handling,
    // not a delivered fixture; never classify digit-SE as S10).
    // Source: https://github.com/apoex/postnord
    expect(detectCarrier('84971563697SE')).toBe('postnord');
    expectUniversalFallback('postnord');
  });

  it('posti — Posti', () => {
    // OSS EXAMPLE inbound NL-issued identifier: an explicit-Posti parser fixture, never
    // an automatic Posti detector (native JJFI specimens remain unsampled).
    // Source: https://github.com/hatlabs/posti-cli
    expect(detectCarrier('LR288565359NL')).toBe('spring-gds');
    expectUniversalFallback('posti');
  });

  it('postlogistics — PostLogistics', () => {
    // Deliberate no-result canary only (synthetic all-zeros): no positive shipment
    // evidence, and the canary must never count as successful verification.
    // Source: https://github.com/plhery/delivery-tracker/blob/739b360d45d1cf723e0058350bcf19f8e373f076/src/server/upstreamAdapters.live.test.ts
    expect(detectCarrier('000000000000000000')).toBe('unknown');
  });

  it('purolator — Purolator', () => {
    // OSS EXAMPLE letter families (BYS excluded so Yanwen keeps its distinctive prefix).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/purolator.json
    for (const number of ['KYV009956937', 'CGK002986959', 'JFV247545960', 'TLR000083964']) {
      expect(detectCarrier(number)).toBe('purolator');
    }
    // OSS numeric family (upstream Luhn-validates; stays ambiguous here).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/purolator.json
    for (const number of ['320595463938', '287809468872', '331426749957']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('purolator');
    }
    expectUniversalFallback('purolator');
  });

  it('quickpac — Quickpac', () => {
    expect(detectCarrier('44.00.123456.12345678')).toBe('quickpac');
    expect(detectCarrier('440012345612345678')).toBe('quickpac');
  });

  it('relais-colis — Relais Colis', () => {
    expect(detectCarrier('CC200000000401')).toBe('relais-colis');
    // REPORTED REAL ten-digit numeric shipment (home-delivery multi-field flow is separate).
    // Source: https://forum.quechoisir.org/attitude-inadmissible-de-relais-colis-fuyez-t216835.html
    const match = detectCarrierMatch('338 0000 318');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('relais-colis');
  });

  it('royal-mail — Royal Mail', () => {
    // OFFICIAL linking-page examples (demo illustrations; GB suffix is an issuing
    // clue, and Parcelforce prefixes below stay excluded).
    // Source: https://www.royalmail.com/royal-mail-you/intellectual-property-rights/linking-our-website
    expect(detectCarrier('ZW924750388GB')).toBe('royal-mail');
    expect(detectCarrier('SG577041359GB')).toBe('royal-mail');
    expectUniversalFallback('royal-mail');
  });

  it('seur — SEUR', () => {
    // REPORTED REAL shipment IDs (DPD/SEUR handoffs need carrier context; REC-prefixed
    // complaint numbers are never training data).
    // Source: https://www.ocu.org/reclamar/empresas/seur/500000075
    for (const number of ['01475194188635', '046999610972820260807']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('seur');
    }
    // 7-digit shipment reference, not a parcel barcode: no standalone lookup promised.
    // Source: https://www.ocu.org/reclamar/empresas/seur/500000075
    expect(detectCarrier('1796295')).toBe('unknown');
    expectUniversalFallback('seur');
  });

  it('sf-express — SF Express', () => {
    // OSS historical 12-digit fixture (modern service variants remain to be established).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    const match = detectCarrierMatch('133938675660');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('sf-express');
    // Public-report SF-prefixed specimen with unverified attribution: low candidate only.
    // Source: https://www.paketda.de/fragen-antworten
    const prefixed = detectCarrierMatch('SF6047381042488');
    expect(prefixed).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(prefixed.candidates).toContain('sf-express');
    expectUniversalFallback('sf-express');
  });

  it('shipup — ShipUp', () => {
    // No exclusive detector: kept as a manual record through universal lookup.
    expect(detectCarrier('SHIPUP123456')).toBe('unknown');
    expect(CARRIERS.shipup.capabilities.selectable).toBe(true);
    expect(CARRIERS.shipup.capabilities.tracking.adapter).toBe('universal');
  });

  it('singapore-post — Singapore Post', () => {
    // OSS EXAMPLE S10 fixtures (not asserted real).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('RF322965566SG')).toBe('singapore-post');
    expect(detectCarrier('EX011436437SG')).toBe('singapore-post');
    // Registered-service page placeholder: fails S10, never a positive.
    // Source: https://www.singpost.com/sending-within-singapore/registered-service
    expect(isValidS10TrackingNumber('RA123456789SG')).toBe(false);
    expect(detectCarrier('RA123456789SG')).toBe('unknown');
    expectUniversalFallback('singapore-post');
  });

  it('spee-dee — Spee-Dee', () => {
    // OSS EXAMPLES, SP + 18 digits (20 chars total: keep the SP prefix, never confuse
    // with SpeedX SPX or a Planzer 20-digit number).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/speedee.json
    for (const number of ['SP029692510000920746', 'SP029692510000901479', 'SP029692450001607639']) {
      expect(detectCarrier(number)).toBe('spee-dee');
    }
    expectUniversalFallback('spee-dee');
  });

  it('speedx — SpeedX', () => {
    // REPORTED REAL SPXMIA family (SPX + three letters + 12 digits; never SPX + digits alone).
    // Source: https://es.trustpilot.com/review/speedx.io
    for (const number of ['SPXMIA056759629631', 'SPXMIA056746165383', 'SPXMIA056746185528', 'SPXMIA056745759994']) {
      expect(detectCarrier(number)).toBe('speedx');
    }
    expectUniversalFallback('speedx');
  });

  it('spring-gds — PostNL', () => {
    expect(detectCarrierMatch('LX123456785NL')).toEqual({
      carrier: 'spring-gds', confidence: 'high', candidates: ['spring-gds'],
    });
    expect(detectCarrier('lx 123.456-785 nl')).toBe('spring-gds');
    expect(detectCarrier('LX123456789NL')).toBe('unknown');
    // REPORTED REAL international shipments (foreign last-mile operator is separate).
    // Source: https://www.paketda.de/fragen-antworten.php
    expect(detectCarrier('LA681049820NL')).toBe('spring-gds');
    expect(detectCarrier('CK089862199NL')).toBe('spring-gds');
    // OFFICIAL generated-barcode examples (illustrations, not customer shipments).
    // Source: https://developer.postnl.nl/integration-with-postnl/api-overview/send-and-track/barcode-webservice/
    for (const number of [
      '3SAB83691658823', '3SABCD3427702', '3SABCD987446630',
      '3SABCD1175003', '3SABC19149187', '3SA5210528875',
      'CC123442066NL', 'CD111208171NL', 'CP112251335NL', 'LA599196732NL',
    ]) {
      expect(detectCarrier(number)).toBe('spring-gds');
    }
    // Official examples that fail S10 are quarantined, never PostNL positives.
    // Source: https://developer.postnl.nl/integration-with-postnl/api-overview/send-and-track/barcode-webservice/
    for (const number of ['UE597256100NL', 'RI543495045NL']) {
      expect(isValidS10TrackingNumber(number)).toBe(false);
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).not.toContain('spring-gds');
    }
    expect(carrierInfo('spring-gds').name).toBe('PostNL');
    expect(tracksAutomatically('spring-gds')).toBe(true);
  });

  it('sto — STO Express', () => {
    // OSS EXAMPLE fixture (recent independently attributed shipments still missing).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    const match = detectCarrierMatch('968754207139');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('sto');
    expectUniversalFallback('sto');
  });

  it('sunyou — SunYou', () => {
    // Legacy SY + 11 digits family.
    expect(detectCarrier('SY12345678901')).toBe('sunyou');
    // CLAIMED REAL CAPTURE, maintainer-captured real-shipment payload, July 2021
    // (never confuse the request orderNo with the returned last-mile trackingNumber).
    // Source: https://github.com/ha-parcel-integrations/ha-sunyou/blob/main/tests/payloads.py
    expect(detectCarrier('SYAE006809461')).toBe('sunyou');
    // FAKE/SYNTHETIC in-transit fixture from the same file (shape regression only).
    // Source: https://github.com/ha-parcel-integrations/ha-sunyou/blob/main/tests/payloads.py
    expect(detectCarrier('SYAE100000001')).toBe('sunyou');
  });

  it('swiss-post — Swiss Post', () => {
    expect(detectCarrier('99.34.123456.12345678')).toBe('swiss-post');
    expect(detectCarrier('993412345612345678')).toBe('swiss-post');
    expect(detectCarrier('98.11.223344.55667788')).toBe('swiss-post');
    expect(detectCarrier('RA123456785CH')).toBe('swiss-post');
    expect(detectCarrier('ra123456785ch')).toBe('swiss-post');
    // OSS 2015 public-testnu S10 fixture (regression specimen, not a live shipment).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('RS908247336CH')).toBe('swiss-post');
  });

  it('swiss-post-cargo — Swiss Post Cargo', () => {
    // Repository-documented official-form example only; never constrain cargo
    // identifiers to this eight-digit sample (no exclusive detector).
    // Source: https://github.com/plhery/delivery-tracker/blob/739b360d45d1cf723e0058350bcf19f8e373f076/src/server/swissPostCargo.live.test.ts
    expect(detectCarrier('12345678')).toBe('unknown');
  });

  it('thailand-post — Thailand Post', () => {
    // OSS EXAMPLE S10 fixture (not asserted real).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('EE138961080TH')).toBe('thailand-post');
    expectUniversalFallback('thailand-post');
  });

  it('the-courier-guy — The Courier Guy', () => {
    // REPORTED REAL short reference needing confirmation: far too short for an
    // exclusive detector, so no oracle is built from it.
    // Source: https://www.consumercomplaints.in/bycompany/the-courier-guy-south-africa-a266527.html
    expect(detectCarrier('QGB8C')).toBe('unknown');
    expectUniversalFallback('the-courier-guy');
  });

  it('tipsa — TIPSA', () => {
    // REPORTED REAL merchant-confirmed tracking assignment, separate from the order number.
    // Source: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/no-recibido-pedido/ca39ecd30bb517b380
    const match = detectCarrierMatch('8104405448');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('tipsa');
    expectUniversalFallback('tipsa');
  });

  it('tnt — TNT', () => {
    // OSS 9-digit fixtures (dedicated FedEx-group route, not an independent parent claim).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    for (const number of ['928567507', '211691259']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('tnt');
    }
    // Regional legacy fixtures needing confirmation stay out of exclusive routing.
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrierMatch('1158418300904').carrier).toBe('unknown');
    expect(detectCarrier('MY33217326')).toBe('unknown');
    expectUniversalFallback('tnt');
  });

  it('ukrposhta — Ukrposhta', () => {
    // OSS historical international-delivery response: an explicit-carrier parser
    // fixture, never number-only Ukrposhta detection (native S10 UA unsampled).
    // Source: https://github.com/kolyabres/ukrposhta-api
    expect(detectCarrier('RF426331371SG')).toBe('singapore-post');
    expectUniversalFallback('ukrposhta');
  });

  it('uniuni — UniUni', () => {
    // REPORTED REAL unsolicited-package label reports (identifier only, no PII; the UUS
    // sample contains an internal B, so digits-only suffixes are too restrictive).
    // Sources: https://www.bbb.org/scamtracker/lookupscam/1111994 (UUS) and https://www.bbb.org/scamtracker/lookupscam/1107364 (4C)
    expect(detectCarrier('UUS5B60564241706199')).toBe('uniuni');
    expect(detectCarrier('4C003925742US')).toBe('uniuni');
    expectUniversalFallback('uniuni');
  });

  it('unknown — Unknown carrier', () => {
    expect(detectCarrier('')).toBe('unknown');
    expect(detectCarrier('hello')).toBe('unknown');
    expect(detectCarrier('123')).toBe('unknown');
    expect(detectCarrier('DELIVERY')).toBe('unknown');
    expect(detectCarrier('00123456')).toBe('unknown');
    // S10 shapes with an invalid check digit never detect, whatever the suffix.
    expect(isValidS10TrackingNumber('RA123456785CH')).toBe(true);
    expect(isValidS10TrackingNumber('RA123456789CH')).toBe(false);
    expect(detectCarrier('RA123456789CH')).toBe('unknown');
    expect(detectCarrier('RA123456789SG')).toBe('unknown');
    expect(tracksAutomatically('unknown')).toBe(true);
  });

  it('ups — UPS', () => {
    expect(detectCarrier('1Z999AA10123456784')).toBe('ups');
    // OSS EXAMPLES, historical K/J/V waybills.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/ups.json
    expect(detectCarrier('1Z5R89390357567127')).toBe('ups');
    expect(detectCarrier('1ZXX3150YW44070023')).toBe('ups');
    // Historical fixtures stay low-confidence candidates: format evidence alone never
    // claims current endpoint support.
    for (const number of ['K1506235620', 'J4603636537', 'V0490119172']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('ups');
    }
  });

  it('usps — USPS', () => {
    // OSS EXAMPLE legacy 20-digit numbers: low suggestions outside the Planzer/DHL
    // prefixed ranges, never exclusive.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/usps.json
    for (const number of ['03071790000523483741', '71123456789123456787', '71969010756003077385']) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('usps');
    }
    // OSS EXAMPLE 22-digit legacy/IMpb numbers: ambiguous with Austrian Post.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/usps.json
    for (const number of [
      '9400111206206406260787', '9400111201080805483016', '9405803699300124287899',
      '9434611206206406227577', '9101123456789000000013', '9261290336128704042634',
    ]) {
      const match = detectCarrierMatch(number);
      expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
      expect(match.candidates).toContain('usps');
    }
    // Full 420 + ZIP routing barcodes are label constructs, not shipment IDs.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/usps.json
    for (const number of [
      '420787459400111206206406260787', '420221539101026837331000039521',
      '420902459261290336128704042634', '4201002334249200190132607600833457',
      '4201028200009261290113185417468510',
    ]) {
      expect(detectCarrier(number)).toBe('unknown');
    }
    expectUniversalFallback('usps');
  });

  it('yamato — Yamato Transport', () => {
    // OSS EXAMPLE fixture (not asserted real).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    const match = detectCarrierMatch('410569991366');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('yamato');
    expectUniversalFallback('yamato');
  });

  it('yanwen — Yanwen', () => {
    // INTEGRATION DOC examples (Tracktry API illustrations, not asserted real).
    // Source: https://www.tracktry.com/api-nodejs.html
    expect(detectCarrier('BYS006086088')).toBe('yanwen');
    expect(detectCarrier('BYS006086077')).toBe('yanwen');
    expectUniversalFallback('yanwen');
  });

  it('yto — YTO Express', () => {
    // OSS EXAMPLE fixture, D + 11 digits (not asserted real).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('D00015070907')).toBe('yto');
    expectUniversalFallback('yto');
  });

  it('yunda — Yunda Express', () => {
    // OSS EXAMPLE fixture, 13 digits (not asserted real).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    const match = detectCarrierMatch('1000478495775');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('yunda');
    expectUniversalFallback('yunda');
  });

  it('yunexpress — YunExpress', () => {
    // REPORTED REAL cross-border shipment (keep the YT identifier and any later
    // last-mile number as separate references, never substitutes).
    // Source: https://www.reddit.com/r/AirReps/comments/1vfhh53/please_help_yunexpress_alibaba_tracking_stuck_on/
    expect(detectCarrier('YT2621200705470145')).toBe('yunexpress');
    expectUniversalFallback('yunexpress');
  });

  it('zto — ZTO Express', () => {
    // OSS EXAMPLE fixture, 12 digits (not asserted real).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    const match = detectCarrierMatch('778564698005');
    expect(match).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(match.candidates).toContain('zto');
    expectUniversalFallback('zto');
  });
});

describe('ambiguous number shapes', () => {
  // Shared numeric lengths belong to no single carrier: they stay low-confidence
  // with exact candidate sets. Adding a detector must update these lists consciously.
  it('keeps non-prefixed 20-digit numbers as USPS suggestions', () => {
    // Only the 91346097 (Planzer) and 00340434 (DHL) 20-digit ranges route by number;
    // everything else stays out of Planzer/DHL routing. OSS fixtures below.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/usps.json
    expect(detectCarrierMatch('03071790000523483741')).toEqual({
      carrier: 'unknown', confidence: 'low', candidates: ['usps'],
    });
    const second = detectCarrierMatch('71123456789123456787');
    expect(second).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(second.candidates).toEqual(['usps']);
  });

  it('keeps 10-digit numbers ambiguous', () => {
    expect(detectCarrierMatch('1234567890')).toEqual({
      carrier: 'unknown',
      confidence: 'low',
      candidates: ['dhl', 'mondial-relay', 'relais-colis', 'tipsa', 'estafeta'],
    });
  });

  it('keeps 11-digit numbers ambiguous', () => {
    expect(detectCarrierMatch('36631000001')).toEqual({
      carrier: 'unknown',
      confidence: 'low',
      candidates: ['gls-ch', 'gls-fr', 'gls-de', 'blue-dart', 'aramex'],
    });
  });

  it('keeps 12-digit numbers ambiguous', () => {
    expect(detectCarrierMatch('123456789012')).toEqual({
      carrier: 'unknown',
      confidence: 'low',
      candidates: ['fedex', 'gls-ch', 'dpd-fr', 'mondial-relay', 'gls-fr', 'colis-prive', 'gls-de', 'mrw', 'purolator', 'sf-express', 'sto', 'zto', 'yamato', 'j-and-t'],
    });
  });

  it('keeps 14-digit numbers ambiguous', () => {
    expect(detectCarrierMatch('01234567890123')).toEqual({
      carrier: 'unknown',
      confidence: 'low',
      candidates: ['gls-ch', 'dpd', 'dpd-fr', 'ciblex', 'hermes-de', 'gls-de', 'seur', 'brt', 'delhivery'],
    });
    expect(detectCarrierMatch('10594002378611')).toEqual({
      carrier: 'unknown',
      confidence: 'low',
      candidates: ['gls-ch', 'dpd', 'dpd-fr', 'ciblex', 'hermes-de', 'gls-de', 'seur', 'brt', 'delhivery'],
    });
  });

  it('keeps 15-digit numbers ambiguous', () => {
    expect(detectCarrierMatch('123456789012345')).toEqual({
      carrier: 'unknown',
      confidence: 'low',
      candidates: ['fedex', 'dpd-fr'],
    });
  });

  it('keeps 8-digit numbers and mixed 8-character IDs ambiguous', () => {
    expect(detectCarrierMatch('76434219')).toEqual({
      carrier: 'unknown',
      confidence: 'low',
      candidates: ['mondial-relay', 'heppner'],
    });
    expect(detectCarrierMatch('AB12CD34')).toEqual({
      carrier: 'unknown',
      confidence: 'low',
      candidates: ['gls-ch', 'gls-fr', 'gls-de'],
    });
  });

  it('keeps combined Colis Privé credentials as low-confidence suggestions', () => {
    expect(detectCarrierMatch('99112233445575012')).toEqual({
      carrier: 'unknown',
      confidence: 'low',
      candidates: ['dhl-ecommerce', 'colis-prive'],
    });
    expect(detectCarrierMatch('99112233445500000')).toEqual({
      carrier: 'unknown',
      confidence: 'low',
      candidates: ['dhl-ecommerce'],
    });
  });
});

describe('expanded carrier catalog', () => {
  it('offers regional carriers while universal lookups stay automatic and hidden', () => {
    const choices = SELECTABLE_CARRIERS.map((c) => c.id);
    for (const carrier of ['hermes-de', 'gls-de', 'delivengo'] as const) {
      expect(choices).toContain(carrier);
      expect(tracksAutomatically(carrier)).toBe(true);
    }
    for (const carrier of ['17track', 'seventeen-track', 'parcelsapp', 'unknown', 'intl-post']) {
      expect(choices).not.toContain(carrier);
    }
    expect(tracksAutomatically('unknown')).toBe(true);
    expect(carrierTrackingHintKey('unknown')).toBe('add.autoSync');
    expect(carrierTrackingHintKey('intl-post')).toBe('add.autoSync');
    expect(carrierRequirements('gls-de', '12345678901')).toMatchObject([{ pattern: '^[0-9]{4,5}$' }]);
  });

  it.each([
    ['https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#H1234567890123456789', 'hermes-de', 'H1234567890123456789'],
    ['https://gls-group.com/DE/de/paketverfolgung?match=12345678901', 'gls-de', '12345678901'],
    ['https://gls-group.eu/FR/fr/suivi-colis?match=12345678901', 'gls-fr', '12345678901'],
    ['https://gls-group.eu/CH/en/parcel-tracking?match=12345678901', 'gls-ch', '12345678901'],
    ['https://t.17track.net/en#nums=1Z999AA10123456784', 'ups', '1Z999AA10123456784'],
    ['https://parcelsapp.com/fr/tracking/ZZ12345678900', 'unknown', 'ZZ12345678900'],
    ['https://t.17track.net/fr#nums=ZZ12345678900', 'unknown', 'ZZ12345678900'],
  ])('extracts %s', (url, carrier, trackingNumber) => {
    expect(parseTrackingInput(url)).toMatchObject({ carrier, trackingNumber, source: 'link' });
  });
});

describe('normalizeTrackingNumber', () => {
  it.each([
    ['en', 'Unknown carrier'], ['de', 'Paketdienst unbekannt'],
    ['fr', 'Transporteur inconnu'], ['it', 'Corriere sconosciuto'],
    ['es', 'Transportista desconocido'], ['pt', 'Transportadora desconhecida'],
    ['pl', 'Nieznany przewoźnik'],
  ])('names undetected carriers clearly in %s', (locale, name) => {
    expect(carrierInfo('unknown', locale).name).toBe(name);
  });
  it('uppercases and strips spaces, dots and dashes', () => {
    expect(normalizeTrackingNumber('99.34.123456.12345678')).toBe(
      '993412345612345678',
    );
    expect(normalizeTrackingNumber(' ra 123 456-789 ch ')).toBe('RA123456789CH');
  });
});

describe('supportsSwissPostHandoff', () => {
  it('requires a valid Swiss-issued tracked-letter S10 identifier', () => {
    expect(supportsSwissPostHandoff('LW230226618CH')).toBe(true);
    expect(supportsSwissPostHandoff('LW230226619CH')).toBe(false);
    expect(supportsSwissPostHandoff('RR230226618CH')).toBe(false);
  });

  it('uses Swiss Post’s URL after a DHL handoff even with a saved DHL URL', () => {
    const links = parcelTrackingLinks({
      carrier: 'dhl', trackingNumber: 'LF123456785DE', trackingSource: 'swiss-post',
      trackingUrl: 'https://www.dhl.de/en/privatkunden/dhl-sendungsverfolgung.html?piececode=LF123456785DE',
      originalCarrier: 'dhl', originalTrackingNumber: 'LF123456785DE',
    }, 'en');
    expect(links.map(({ carrier }) => carrier.id)).toEqual(['swiss-post', 'dhl']);
    expect(links[0].url).toContain('https://service.post.ch/');
    expect(links[1].url).toContain('dhl.de');
  });

  it('uses the confirmed local number after a cross-number carrier swap', () => {
    const links = parcelTrackingLinks({ carrier: 'gls-de', trackingNumber: '123456789011',
      trackingSource: 'swiss-post', activeTrackingNumber: '990000000000001',
      originalCarrier: 'gls-de', originalTrackingNumber: '123456789011',
    });
    expect(links.map(({ carrier }) => carrier.id)).toEqual(['swiss-post', 'gls-de']);
    expect(links[0].url).toContain('990000000000001');
    expect(links[0].url).not.toContain('123456789011');
    expect(links[1].url).toContain('123456789011');
  });

  it('keeps GLS identity and uses Swiss Post first for linked tracking numbers', () => {
    const parcel = {
      carrier: 'swiss-post' as const, trackingNumber: '993412345612345678',
      originalCarrier: 'gls-de' as const, originalTrackingNumber: '12345678901',
      originalTrackingUrl: 'https://www.gls-pakete.de/reach-sendungsverfolgung?match=12345678901',
    };
    expect(displayedCarrierId(parcel)).toBe('gls-de');
    const links = parcelTrackingLinks(parcel, 'fr');
    expect(links.map(({ carrier, role }) => [carrier.id, role])).toEqual([
      ['swiss-post', 'active'], ['gls-de', 'history'],
    ]);
    expect(links[0].url).toContain('993412345612345678?lang=fr');
    expect(links[1].url).toBe(parcel.originalTrackingUrl);
  });

  it('orders Cainiao first until Swiss Post becomes the active source', () => {
    const waiting = parcelTrackingLinks({
      carrier: 'swiss-post',
      trackingNumber: 'LW230226618CH',
      trackingSource: 'aliexpress',
      swissPostReady: false,
    });
    expect(waiting.map(({ carrier, role }) => [carrier.id, role])).toEqual([
      ['aliexpress', 'active'],
      ['swiss-post', 'waiting'],
    ]);

    const active = parcelTrackingLinks({
      carrier: 'swiss-post',
      trackingNumber: 'LW230226618CH',
      trackingSource: 'swiss-post',
      swissPostReady: true,
    });
    expect(active.map(({ carrier, role }) => [carrier.id, role])).toEqual([
      ['swiss-post', 'active'],
      ['aliexpress', 'history'],
    ]);
  });

  it('opens Swiss Post links in the selected app language', () => {
    const [link] = parcelTrackingLinks({
      carrier: 'swiss-post',
      trackingNumber: '993412345612345678',
      trackingUrl: 'https://service.post.ch/ekp-web/ui/entry/search/993412345612345678?lang=de',
    }, 'fr');

    expect(link.url).toBe(
      'https://service.post.ch/ekp-web/ui/entry/search/993412345612345678?lang=fr',
    );
  });
});

describe('unknown postal carrier links', () => {
  it.each(['es', 'pt', 'pl'])('uses supported external-site languages for %s', (locale) => {
    const [swissPost] = parcelTrackingLinks({ carrier: 'swiss-post', trackingNumber: '993412345612345678' }, locale);
    expect(new URL(swissPost.url).searchParams.get('lang')).toBe('en');
    const [parcels] = parcelTrackingLinks({
      carrier: 'unknown', trackingNumber: 'ZZ12345678900',
      trackingUrl: 'https://parcelsapp.com/fr/tracking/ZZ12345678900',
    }, locale);
    expect(parcels.url).toBe(`https://parcelsapp.com/${locale === 'pl' ? 'en' : locale}/tracking/ZZ12345678900`);
  });

  it.each([
    ['en', 'Unknown postal carrier'],
    ['de', 'Postanbieter unbekannt'],
    ['fr', 'Transporteur postal inconnu'],
    ['it', 'Corriere postale sconosciuto'],
    ['es', 'Operador postal desconocido'],
    ['pt', 'Operador postal desconhecido'],
    ['pl', 'Nieznany operator pocztowy'],
  ])('names the fallback and opens 17TRACK in %s', (locale, name) => {
    for (const trackingUrl of [undefined, 'https://service.post.ch/ekp-web/ui/entry/search/RA123456785DE']) {
      const [link] = parcelTrackingLinks({
        carrier: 'intl-post', trackingNumber: 'RA123456785DE', trackingUrl,
      }, locale);
      expect(carrierInfo('intl-post', locale).name).toBe(name);
      expect(link.carrier.name).toBe(name);
      expect(link.name).toBe('17TRACK');
      expect(link.url).toBe(`https://t.17track.net/${locale}#nums=RA123456785DE`);
      expect(link.role).toBe('active');
    }
    expect(tracksAutomatically('intl-post')).toBe(true);
  });

  it('uses English by default and keeps real carrier destinations', () => {
    expect(carrierInfo('intl-post').name).toBe('Unknown postal carrier');
    expect(parcelTrackingLinks({ carrier: 'intl-post', trackingNumber: 'RA123456785DE' })[0].url)
      .toBe('https://t.17track.net/en#nums=RA123456785DE');
    const [dhl] = parcelTrackingLinks({
      carrier: 'dhl', trackingNumber: 'LF123456785DE',
      trackingUrl: 'https://www.dhl.de/int-verfolgen/?piececode=LF123456785DE',
    }, 'fr');
    expect(dhl.name).toBe('DHL');
    expect(dhl.url).toBe('https://www.dhl.de/int-verfolgen/?piececode=LF123456785DE');
    const [swissPost] = parcelTrackingLinks({
      carrier: 'swiss-post', trackingNumber: 'RA123456785CH',
    }, 'fr');
    expect(swissPost.name).toBe('Swiss Post');
    expect(swissPost.url).toBe('https://service.post.ch/ekp-web/ui/entry/search/RA123456785CH?lang=fr');
  });
});

describe('formatTrackingNumber', () => {
  it('formats Swiss Post and Quickpac barcodes with dots', () => {
    expect(formatTrackingNumber('993412345612345678')).toBe(
      '99.34.123456.12345678',
    );
    expect(formatTrackingNumber('440012345612345678')).toBe(
      '44.00.123456.12345678',
    );
  });

  it('leaves other numbers as-is (normalised)', () => {
    expect(formatTrackingNumber('ra123456789ch')).toBe('RA123456789CH');
    expect(formatTrackingNumber('1Z999AA10123456784')).toBe('1Z999AA10123456784');
  });

  it('formats Planzer shared-link numbers with their original separators', () => {
    expect(formatTrackingNumber('9999003316119')).toBe('999.90.03316119');
  });
});

describe('parseTrackingInput', () => {
  it('recognises DHL and Deutsche Post links and shipping text', () => {
    for (const input of [
      'https://www.dhl.de/en/privatkunden/dhl-sendungsverfolgung.html?piececode=LF123456785DE',
      'https://nolp.dhl.de/nextt-online-public/en/search?piececode=LF123456785DE',
      'https://www.deutschepost.de/de/s/sendungsverfolgung.html?piececode=LF123456785DE',
      'https://www.dhl.com/ch-en/home/tracking.html?tracking-id=LF123456785DE',
      'Your shipment: LF123456785DE',
    ]) {
      expect(parseTrackingInput(input)).toMatchObject({
        trackingNumber: 'LF123456785DE', carrier: 'dhl', confidence: 'high',
      });
    }
    // Explicit DHL links also identify ambiguous numeric IDs.
    expect(parseTrackingInput('https://www.dhl.de/int-verfolgen/?piececode=1234567890'))
      .toMatchObject({ carrier: 'dhl', confidence: 'high', source: 'link' });
    expect(parseTrackingInput('https://dhl.de.example.com/?piececode=1234567890').carrier).not.toBe('dhl');
  });

  it('recognises PostNL numbers in carrier links and shipping messages', () => {
    for (const input of [
      'https://postnl.post/track?barcodes=LX123456785NL',
      'https://mailingtechnology.com/tracking/?tn=LX123456785NL',
      'https://postnl.post/details/LX123456785NL',
      'https://postnl.post/tracktrace?B=LX123456785NL',
      'Your Myprotein shipment: LX123456785NL',
    ]) {
      expect(parseTrackingInput(input)).toMatchObject({
        trackingNumber: 'LX123456785NL', carrier: 'spring-gds', confidence: 'high',
      });
    }
  });

  it('opens the current PostNL page and repairs previously saved obsolete links', () => {
    for (const trackingUrl of [undefined, 'https://postnl.post/details/LX123456785NL']) {
      const [link] = parcelTrackingLinks({ carrier: 'spring-gds', trackingNumber: 'LX123456785NL', trackingUrl });
      expect(link).toMatchObject({ name: 'PostNL', url: 'https://postnl.post/track?barcodes=LX123456785NL' });
    }
    const springUrl = 'https://mailingtechnology.com/tracking/?tn=LX123456785NL';
    expect(parcelTrackingLinks({ carrier: 'spring-gds', trackingNumber: 'LX123456785NL', trackingUrl: springUrl })[0].url)
      .toBe(springUrl);
  });

  it.each([
    ['swiss-post', '993412345612345678'],
    ['swiss-post-cargo', '1234ABC789'],
    ['quickpac', '440012345612345678'],
    ['planzer', '91346097123456789012'],
    ['aliexpress', 'LP123456789CN'],
    ['sunyou', 'SY12345678901'],
    ['spring-gds', 'LX123456789DE'],
    ['dhl', '1234567890'],
    ['ups', '1Z999AA10123456784'],
    ['fedex', '123456789012'],
    ['gls-ch', '993990103198'],
    ['dpd', '01234567890123'],
    ['dpd-fr', '250123456789012'],
    ['la-poste', '8G12345678901'],
    ['chronopost', '12345678901234Q'],
    ['gls-fr', '00AB12CD'],
    ['colis-prive', '99112233445575012'],
    ['geodis', '1G123GEODIS0'],
    ['colisweb', '87654321'],
    ['c-chez-vous', 'FGRC45BKLM'],
    ['ciblex', '12345678901234'],
    ['paack', 'PAACK12345'],
    ['asendia', 'ASE12345678'],
    ['packeta', 'Z1234567890'],
    ['pos-malaysia', 'MYPM00000000015'],
    ['correos-spain', 'PR110604670130400C'],
    ['poste-italiane', 'RA00020974503'],
    ['ctt', 'RL402552798PT'],
  ] as const)('round-trips a generated %s tracking link', (carrier, trackingNumber) => {
    const link = CARRIERS[carrier].trackingUrl?.(trackingNumber);
    expect(link).toBeDefined();
    expect(parseTrackingInput(`Track it here: ${link}`)).toMatchObject({
      trackingNumber,
      carrier,
      source: 'link',
    });
  });

  it('builds usable links for C Chez Vous compact credentials and Paack', () => {
    expect(CARRIERS['c-chez-vous'].trackingUrl?.('4TZKO15679059600')).toBe(
      'https://www.cchezvous.fr/suivi-colis/4TZKO156790--59600',
    );
    expect(CARRIERS.paack.trackingUrl?.('PAACK12345')).toBe(
      'https://mydeliveries.paack.app/tracking?tracking_number=PAACK12345',
    );
  });

  it('trusts a broad GLS identifier only when it comes from the official domain', () => {
    expect(parseTrackingInput('https://moncolis.gls-france.com/fr/AB12CD34')).toMatchObject({
      trackingNumber: 'AB12CD34',
      carrier: 'gls-fr',
      confidence: 'high',
      candidates: ['gls-fr'],
      source: 'link',
    });
  });

  it('trusts deep French identifiers embedded in their official carrier links', () => {
    expect(parseTrackingInput(
      'https://www.mondialrelay.fr/suivi-de-colis/?shipment=76434219',
    )).toMatchObject({
      trackingNumber: '76434219',
      carrier: 'mondial-relay',
      confidence: 'high',
      source: 'link',
    });
    expect(parseTrackingInput(
      'https://www.relaiscolis.com/colis/suivre?trackingNumber=CC200000000401',
    )).toMatchObject({
      trackingNumber: 'CC200000000401',
      carrier: 'relais-colis',
      confidence: 'high',
      source: 'link',
    });
  });

  it('captures a complete Planzer shared capability link', () => {
    const link =
      'https://trackandtrace.planzergroup.com/shared/sendungen/999.90.03316119?accessKey=abcdefghijklmnopqrstuvwxyzABCDEFGH';

    expect(parseTrackingInput(`Your delivery: ${link}.`)).toMatchObject({
      trackingNumber: '999.90.03316119',
      carrier: 'planzer',
      trackingUrl: link,
      source: 'link',
    });
  });

  it('uses the number shape to distinguish Quickpac on Planzer links', () => {
    expect(parseTrackingInput(
      'https://tracking.app.planzer.ch/delivery/info?deliveryNumber=440012345612345678',
    )).toMatchObject({
      trackingNumber: '440012345612345678',
      carrier: 'quickpac',
      confidence: 'high',
      source: 'link',
    });
  });

  it('captures a complete Dachser capability link', () => {
    const link =
      'https://customeriberia.dachser.com/customerarea/utilidades/seguimiento-publico/detalle?cliente=generico&numeroUnico=9010000001234&fecha=20260513&clave=TESTKEY9';

    expect(parseTrackingInput(`Your delivery: ${link}.`)).toMatchObject({
      trackingNumber: '9010000001234',
      carrier: 'dachser',
      confidence: 'high',
      trackingUrl: link,
      source: 'link',
    });
  });

  it('does not retain capability URLs from lookalike domains', () => {
    const result = parseTrackingInput(
      'https://trackandtrace.planzergroup.com.evil.test/shared/sendungen/999.90.03316119?accessKey=secret',
    );

    expect(result.trackingNumber).toBe('999.90.03316119');
    expect(result.carrier).toBe('planzer');
    expect(result.trackingUrl).toBeUndefined();
  });

  it('finds recognised numbers in pasted shipping text', () => {
    expect(
      parseTrackingInput('Your order is on its way. UPS tracking number: 1Z999AA10123456784.'),
    ).toMatchObject({
      trackingNumber: '1Z999AA10123456784',
      carrier: 'ups',
      source: 'text',
    });
  });

  it('extracts an unknown-format number following a tracking label', () => {
    expect(parseTrackingInput('Shipment tracking: ABC123XYZ')).toMatchObject({
      trackingNumber: 'ABC123XYZ',
      carrier: 'unknown',
      source: 'text',
    });
  });

  it('keeps plain manual numbers and rejects prose without a number', () => {
    expect(parseTrackingInput('ambiguous-123')).toMatchObject({
      trackingNumber: 'ambiguous-123',
      carrier: 'unknown',
      source: 'number',
    });
    expect(parseTrackingInput('Where is my parcel?')).toMatchObject({
      trackingNumber: '',
      carrier: 'unknown',
      source: 'none',
    });
    expect(parseTrackingInput('hello there')).toMatchObject({
      trackingNumber: '',
      carrier: 'unknown',
      source: 'none',
    });
  });
});

describe('carrier metadata', () => {
  it('links Swiss Post deliveries to the Post tracking service', () => {
    expect(CARRIERS['swiss-post'].trackingUrl?.('996013175411004730')).toBe(
      'https://service.post.ch/ekp-web/ui/entry/search/996013175411004730',
    );
  });

  it('links Planzer deliveries to the current tracking app', () => {
    expect(CARRIERS.planzer.trackingUrl?.('91346097123456789012')).toBe(
      'https://tracking.app.planzer.ch/delivery/info?deliveryNumber=91346097123456789012',
    );
  });

  it('links Quickpac deliveries to the current Planzer tracking app', () => {
    expect(CARRIERS.quickpac.trackingUrl?.('440012345612345678')).toBe(
      'https://tracking.app.planzer.ch/delivery/info?deliveryNumber=440012345612345678',
    );
  });

  it('links DPD deliveries to myDPD Switzerland', () => {
    expect(CARRIERS.dpd.trackingUrl?.('06086514587082')).toBe(
      'https://www.dpdgroup.com/ch/mydpd/my-parcels/incoming?parcelNumber=06086514587082',
    );
    expect(tracksAutomatically('dpd')).toBe(true);
  });

  it('tracks UPS deliveries automatically with browser fallback', () => {
    expect(tracksAutomatically('ups')).toBe(true);
    expect(CARRIERS.ups.trackingUrl?.('1Z999AA10123456784')).toBe(
      'https://www.ups.com/track?tracknum=1Z999AA10123456784',
    );
  });

  it('tracks Dachser capability links automatically', () => {
    expect(tracksAutomatically('dachser')).toBe(true);
    expect(carrierRequirements('dachser', '9010000001234')).toMatchObject([
      {
        field: 'trackingUrl',
        label: 'Dachser tracking URL',
        type: 'url',
      },
    ]);
  });

  it('builds encoded tracking links for every linked carrier', () => {
    const linked = Object.values(CARRIERS).filter((carrier) => carrier.trackingUrl);
    expect(linked.length).toBeGreaterThan(0);
    for (const carrier of linked) {
      if (carrier.id === 'amazon-logistics') {
        expect(carrier.trackingUrl?.('AB 12/3')).toBe('https://www.amazon.com/gp/your-account/order-history');
      } else if (carrier.id === 'amazon-shipping') {
        expect(carrier.trackingUrl?.('fr 1234-567890')).toBe('https://track.amazon.fr/tracking/FR1234567890');
      } else {
        const url = carrier.trackingUrl?.('AB 12/3') ?? '';
        // Carriers with a verified GET deep link embed the encoded number;
        // form-only official pages link to the static tracking page instead.
        if (url.includes('AB%2012%2F3')) continue;
        expect(url).toMatch(/^https:\/\/[^/]+\/.*$/);
        expect(url).not.toContain('AB 12/3');
      }
    }
  });

  it('exposes every French carrier while excluding fallback-only carriers', () => {
    const selectable = SELECTABLE_CARRIERS.map((carrier) => carrier.id);
    expect(selectable).not.toContain('unknown');
    expect(selectable).not.toContain('intl-post');
    expect(selectable).toContain('india-post');
    expect(selectable).toEqual(expect.arrayContaining([
      'dpd-fr',
      'mondial-relay',
      'relais-colis',
      'la-poste',
      'chronopost',
      'gls-fr',
      'colis-prive',
      'geodis',
    ]));
    expect(tracksAutomatically('la-poste')).toBe(true);
    expect(tracksAutomatically('chronopost')).toBe(true);
    expect(tracksAutomatically('gls-fr')).toBe(true);
    expect(tracksAutomatically('colis-prive')).toBe(true);
    expect(tracksAutomatically('geodis')).toBe(true);
    expect(tracksAutomatically('dpd-fr')).toBe(true);
    expect(tracksAutomatically('mondial-relay')).toBe(true);
    expect(tracksAutomatically('relais-colis')).toBe(true);
    expect(tracksAutomatically('india-post')).toBe(true);
    expect(carrierInfo('planzer')).toBe(CARRIERS.planzer);
  });
});

describe('parcelTrackingNumbers', () => {
  it('prioritizes the domestic number while retaining the original reference', () => {
    expect(parcelTrackingNumbers({ carrier: 'gls-de', trackingNumber: '123456789011',
      originalCarrier: 'gls-de', originalTrackingNumber: '123456789011',
      trackingSource: 'swiss-post', activeTrackingNumber: '990000000000000001',
    })).toEqual([{ carrier: 'swiss-post', number: '990000000000000001' }, { carrier: 'gls-de', number: '123456789011' }]);
  });
  it('shows shared handoff numbers only once', () => {
    expect(parcelTrackingNumbers({ carrier: 'dhl', trackingNumber: 'LF123456785DE',
      originalCarrier: 'dhl', originalTrackingNumber: 'LF123456785DE', trackingSource: 'swiss-post',
    })).toEqual([{ carrier: 'swiss-post', number: 'LF123456785DE' }]);
  });
});

describe('links follow successful tracking retrieval', () => {
  it.each([
    ['17TRACK', 'https://t.17track.net/fr#nums=TEST1234'],
    ['ParcelsApp', 'https://parcelsapp.com/fr/tracking/TEST1234'],
    ['Ship24', 'https://www.ship24.com/tracking?p=TEST1234'],
    ['Postal Ninja', 'https://postal.ninja/en/track'],
  ])('uses %s instead of the failing carrier website', (trackingProvider, expected) => {
    const [link] = parcelTrackingLinks({ carrier: 'dhl', trackingNumber: 'TEST1234', trackingProvider }, 'fr');
    expect(link.name).toBe(trackingProvider);
    expect(link.url).toBe(expected);
    expect(link.role).toBe('active');
  });
  it('uses the local number at the working universal and preserves the original journey', () => {
    const links = parcelTrackingLinks({ carrier: 'dhl', trackingNumber: 'ORIGIN1234',
      trackingSource: 'swiss-post', activeTrackingNumber: 'LOCAL1234', trackingProvider: 'Ship24',
      originalCarrier: 'dhl', originalTrackingNumber: 'ORIGIN1234' });
    expect(links.map(({ name, role }) => [name, role])).toEqual([['Ship24', 'active'], ['DHL', 'history']]);
    expect(links[0].url).toBe('https://www.ship24.com/tracking?p=LOCAL1234');
    expect(links[1].url).toContain('ORIGIN1234');
  });
  it('uses a confirmed direct source and discards another carrier’s saved URL', () => {
    const [link] = parcelTrackingLinks({ carrier: 'dhl', trackingNumber: 'TEST1234', trackingSource: 'ups',
      trackingUrl: 'https://www.dhl.de/old-capability' });
    expect(link.name).toBe('UPS');
    expect(link.url).toContain('ups.com');
    expect(link.url).toContain('TEST1234');
  });
  it('does not reuse a saved URL for a different number on the same carrier', () => {
    const [link] = parcelTrackingLinks({ carrier: 'dhl', trackingNumber: 'ORIGIN1234', trackingSource: 'dhl',
      activeTrackingNumber: 'LOCAL1234', trackingUrl: 'https://www.dhl.de/?piececode=ORIGIN1234',
      originalCarrier: 'dhl', originalTrackingNumber: 'ORIGIN1234' });
    expect(link.url).toContain('LOCAL1234');
    expect(link.url).not.toContain('ORIGIN1234');
  });
  it('ignores unknown provider names and returns to direct links without a universal result', () => {
    for (const trackingProvider of [undefined, 'https://untrusted.invalid']) {
      const [link] = parcelTrackingLinks({ carrier: 'ups', trackingNumber: 'TEST1234', trackingProvider });
      expect(link.name).toBe('UPS');
      expect(link.url).toContain('ups.com');
    }
  });
});

describe('Amazon Logistics account links', () => {
  it('replaces saved public tracker URLs with Amazon orders', () => {
    const [link] = parcelTrackingLinks({ carrier: 'amazon-logistics', trackingNumber: 'FR3000000001',
      trackingUrl: 'https://track.amazon.fr/tracking/FR3000000001', trackingProvider: 'ParcelsApp' });
    expect(link).toMatchObject({ name: 'Amazon Logistics', url: 'https://www.amazon.fr/gp/your-account/order-history' });
    expect(tracksAutomatically('amazon-logistics')).toBe(false);
  });
});
