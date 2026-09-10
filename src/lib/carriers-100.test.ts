import { describe, expect, it } from 'vitest';
import { CARRIERS, detectCarrier, detectCarrierMatch, tracksAutomatically } from './carriers';

/**
 * 100-carrier initial detection pass.
 *
 * Every number below comes from delivery-tracker-100-carriers/global-carrier-corpus.json
 * (research date 2026-09-10, baseline 739b360d45d1cf723e0058350bcf19f8e373f076).
 * Each case keeps its source URL and evidence role in a comment. "REPORTED REAL"
 * means publicly reported, not independently live-verified. OSS/official/merchant
 * examples are fixtures, not asserted-real shipments. Quarantined and full-barcode
 * records must NOT become positive carrier oracles.
 *
 * New carriers use the universal adapter (ParcelsApp/17TRACK/Ship24 fallback),
 * color #8e8e93 (same as unknown) and no dedicated scraper yet.
 */
describe('100-carrier detection: new universal carriers are selectable with fallback', () => {
  it('registers all 65 new carriers as selectable universal fallback with the default color', () => {
    const added = [
      'royal-mail', 'parcelforce', 'evri', 'inpost', 'an-post', 'bpost', 'austrian-post',
      'postnord', 'posti', 'correos-express', 'seur', 'mrw', 'nacex', 'ctt', 'ctt-express',
      'poste-italiane', 'brt', 'ecoscooting', 'tipsa', 'ukrposhta', 'usps', 'canada-post',
      'purolator', 'canpar', 'ontrac', 'speedx', 'uniuni', 'landmark-global', 'old-dominion',
      'spee-dee', 'gofo', 'estafeta', 'correios-br', 'correos-chile', 'yunexpress', 'four-px',
      'blue-dart', 'delhivery', 'nz-post', 'singapore-post', 'japan-post', 'sf-express', 'sto',
      'yunda', 'yto', 'zto', 'jd-logistics', 'yamato', 'korea-post', 'thailand-post', 'dtdc',
      'australia-post', 'hongkong-post', 'pos-malaysia', 'ninja-van', 'china-post', 'packeta',
      'poczta-polska', 'bring-posten', 'aramex', 'tnt', 'correos-spain', 'yanwen',
      'the-courier-guy', 'j-and-t',
    ];
    expect(added).toHaveLength(65);
    for (const id of added) {
      const carrier = CARRIERS[id as keyof typeof CARRIERS];
      expect(carrier, id).toBeDefined();
      expect(carrier.capabilities.selectable, id).toBe(true);
      expect(carrier.capabilities.tracking.mode, id).toBe('automatic');
      expect(carrier.capabilities.tracking.adapter, id).toBe('universal');
      expect(carrier.color, id).toBe('#8e8e93');
      expect(tracksAutomatically(id as never), id).toBe(true);
    }
  });
});

describe('100-carrier detection: high-impact fixes to existing carriers', () => {
  it('keeps bare 20-digit numbers ambiguous between Planzer and USPS (no blanket Planzer high)', () => {
    // REPORTED REAL DHL shipment, paketda April 2026 — 20 digits are not exclusive to Planzer.
    // Source: https://www.paketda.de/fragen-antworten
    expect(detectCarrierMatch('00340434633751428115')).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    expect(detectCarrierMatch('00340434633751428115').candidates).toEqual(expect.arrayContaining(['planzer', 'usps']));
    // OSS USPS fixtures — same collision family.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/usps.json
    for (const number of ['03071790000523483741', '71123456789123456787', '71969010756003077385']) {
      expect(detectCarrierMatch(number).candidates).toEqual(expect.arrayContaining(['planzer', 'usps']));
    }
  });

  it('detects the SunYou SYAE family from the captured payload', () => {
    // CLAIMED REAL CAPTURE, maintainer says captured from a real shipment, July 2021.
    // Source: https://github.com/ha-parcel-integrations/ha-sunyou/blob/main/tests/payloads.py
    expect(detectCarrier('SYAE006809461')).toBe('sunyou');
    // FAKE/SYNTHETIC fixture from the same file — shape regression only.
    // Source: https://github.com/ha-parcel-integrations/ha-sunyou/blob/main/tests/payloads.py
    expect(detectCarrier('SYAE100000001')).toBe('sunyou');
  });

  it('detects PostNL domestic 3S barcodes (13/15 chars)', () => {
    // OFFICIAL EXAMPLES, PostNL barcode webservice docs (demo illustrations, not real shipments).
    // Source: https://developer.postnl.nl/integration-with-postnl/api-overview/send-and-track/barcode-webservice/
    for (const number of [
      '3SAB83691658823', '3SABCD3427702', '3SABCD987446630',
      '3SABCD1175003', '3SABC19149187', '3SA5210528875',
    ]) {
      expect(detectCarrier(number)).toBe('spring-gds');
    }
  });

  it('keeps 14-digits-plus-letter ambiguous instead of high-confidence Chronopost', () => {
    // REPORTED REAL DPD Germany trailing-L report — collides with the old Chronopost high rule.
    // Source: https://www.paketda.de/fragen-antworten.php
    expect(detectCarrierMatch('01196812014637L')).toMatchObject({ carrier: 'unknown', confidence: 'low' });
    // MERCHANT EXAMPLE labeled La Poste by Fnac Darty — same collision, needs carrier confirmation.
    // Source: https://marketplace.fnacdarty.com/s/article/Dois-je-obligatoirement-renseigner-un-num%C3%A9ro-de-suivi-tracking-pour-ma-commande?language=fr_BE
    expect(detectCarrierMatch('88000019255788Y')).toMatchObject({ carrier: 'unknown', confidence: 'low' });
  });

  it('detects the DHL JD merchant family without claiming the InPost JD legacy range', () => {
    // MERCHANT EXAMPLE, Fnac Darty integration guidance (JD + 18 digits, 20 total).
    // Source: https://marketplace.fnacdarty.com/s/article/Dois-je-obligatoirement-renseigner-un-num%C3%A9ro-de-suivi-tracking-pour-ma-commande?language=fr_BE
    expect(detectCarrier('JD014600011678034918')).toBe('dhl');
  });

  it('keeps historical UPS K/J/V waybills as low-confidence candidates (no endpoint claim)', () => {
    // OSS EXAMPLES, historical fixtures (not proof of current endpoint support).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/ups.json
    for (const number of ['K1506235620', 'J4603636537', 'V0490119172']) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toContain('ups');
    }
  });

  it('does not treat FedEx full barcodes as ordinary tracking numbers', () => {
    // OSS full-barcode fixtures (18/22/32/34 chars) — need format-specific extraction.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/fedex.json
    expect(detectCarrierMatch('1001921334250001000300779017972697').carrier).not.toBe('fedex');
    expect(detectCarrierMatch('32971514560102447849175802862014').carrier).not.toBe('fedex');
    expect(detectCarrierMatch('9622001900000000000000776632517510').carrier).not.toBe('fedex');
    expect(detectCarrier('986578788855')).toBe('unknown'); // 12-digit stays ambiguous
  });

  it('detects the reported-real Amazon TBA label while leaving TBC/TBM/C families alone', () => {
    // REPORTED REAL TBA label.
    // Source: https://github.com/jkeen/tracking_number_data/issues/2
    expect(detectCarrier('TBA333656997000')).toBe('amazon-logistics');
    // TBC/TBM/C fixtures need regional endpoint verification — not the France route.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/amazon.json
    expect(detectCarrier('TBM502887274000')).toBe('unknown');
    expect(detectCarrier('C1004444443')).toBe('unknown');
  });

  it('suggests Relais Colis for the reported 10-digit numeric shipment', () => {
    // REPORTED REAL 10-digit numeric shipment (spaces as printed).
    // Source: https://forum.quechoisir.org/attitude-inadmissible-de-relais-colis-fuyez-t216835.html
    const match = detectCarrierMatch('338 0000 318');
    expect(match.carrier).toBe('unknown');
    expect(match.candidates).toContain('relais-colis');
  });

  it('suggests Colis Prive for bare 12-character IDs without claiming full credentials', () => {
    // REPORTED REAL bare ID (full adapter needs the 17-char combined credential + postcode).
    // Source: https://fr-be.trustpilot.com/review/boutikplus.fr
    for (const number of ['HS0000329755', 'R99600071550', 'ZE0000294369']) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toContain('colis-prive');
    }
    // Sources: merchant examples https://marketplace.fnacdarty.com/s/article/Dois-je-obligatoirement-renseigner-un-num%C3%A9ro-de-suivi-tracking-pour-ma-commande?language=fr_BE
  });

  it('suggests GLS France for the 12-digit merchant specimen', () => {
    // MERCHANT EXAMPLE, Fnac Darty.
    // Source: https://marketplace.fnacdarty.com/s/article/Dois-je-obligatoirement-renseigner-un-num%C3%A9ro-de-suivi-tracking-pour-ma-commande?language=fr_BE
    const match = detectCarrierMatch('123416227171');
    expect(match.carrier).toBe('unknown');
    expect(match.candidates).toContain('gls-fr');
  });
});

describe('100-carrier detection: UK, Ireland and Benelux S10', () => {
  it('detects Royal Mail GB S10 outside Parcelforce prefixes', () => {
    // OFFICIAL EXAMPLES, Royal Mail linking page (demo illustrations).
    // Source: https://www.royalmail.com/royal-mail-you/intellectual-property-rights/linking-our-website
    expect(detectCarrier('ZW924750388GB')).toBe('royal-mail');
    expect(detectCarrier('SG577041359GB')).toBe('royal-mail');
  });

  it('detects Parcelforce by its EA/EB/EC/ED/EE/CP service prefixes', () => {
    // OFFICIAL EXAMPLE, same linking page.
    // Source: https://www.royalmail.com/royal-mail-you/intellectual-property-rights/linking-our-website
    expect(detectCarrier('EC080250821GB')).toBe('parcelforce');
  });

  it('detects Evri H-alphanumerics distinctly from Hermes Germany H-digits', () => {
    // MERCHANT EXAMPLE with internal letters (digits-only validator would fail).
    // Source: https://wobaaa.com/aliexpress-uk-tracking-numbers/
    expect(detectCarrier('H06R4A1011299623')).toBe('evri');
  });

  it('detects An Post IE S10', () => {
    // REPORTED REAL label report.
    // Source: https://www.trustpilot.com/review/www.anpost.com
    expect(detectCarrier('CP476340265IE')).toBe('an-post');
  });

  it('detects bpost BE S10 and keeps 18/24-digit numerics ambiguous', () => {
    // REPORTED REAL label reports.
    // Sources: https://www.test-achats.be/plainte/plaintes-publiques/site-de-plainte-et-suivi-colis/CPTBE01224677-52
    // and https://www.test-achats.be/plainte/plaintes-publiques/colis-perdu-%28voire-vol-C3-A9-en-int/925248238424196550
    expect(detectCarrier('CE500137339BE')).toBe('bpost');
    expect(detectCarrier('UI539489067BE')).toBe('bpost');
    // REPORTED REAL 18/24-digit forms (leading zeros preserved).
    // Sources: https://www.test-achats.be/plainte/plaintes-publiques/absence-de-possibilit-C3-A9-de-gara/b9311a48ffb765e0aa
    // and https://www.test-achats.be/plainte/plaintes-publiques/facteur-qui-a-renvoyer-un-coli/d5dc57a15ab2b157c6
    for (const number of ['323245067847491492', '323211216300000593107030']) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toContain('bpost');
    }
  });
});

describe('100-carrier detection: Nordics and InPost legacy', () => {
  it('detects PostNord digit-SE without treating it as S10', () => {
    // OSS EXAMPLE, request example with empty shipment response (no-data handling, not delivery proof).
    // Source: https://github.com/apoex/postnord
    expect(detectCarrier('84971563697SE')).toBe('postnord');
  });

  it('detects InPost 8YDR and keeps JJD/JD legacy ranges out of exclusive DHL routing', () => {
    // OSS EXAMPLES, legacy Yodel ranges.
    // Source: https://github.com/jkeen/tracking_number_data/issues/91
    expect(detectCarrier('8YDR098765432')).toBe('inpost');
    const jd = detectCarrierMatch('JD0002123456789012');
    expect(jd.carrier).toBe('unknown');
    expect(jd.candidates).toContain('inpost');
    // JJD collides with the existing DHL high rule — official domain or explicit selection must win.
    // Sources: https://wobaaa.com/aliexpress-uk-tracking-numbers/ and https://github.com/jkeen/tracking_number_data/issues/91
    expect(detectCarrier('JJD0002233564270287')).toBe('dhl');
    expect(detectCarrier('JJD0002123456789012')).toBe('dhl');
    // InPost 24-digit CLI example stays ambiguous with bpost 24-digit.
    // Source: https://github.com/alufers/inpost-cli
    const long = detectCarrierMatch('642600027844200234823732');
    expect(long.carrier).toBe('unknown');
    expect(long.candidates).toEqual(expect.arrayContaining(['inpost', 'bpost']));
  });

  it('leaves Posti NL-handoff sample to PostNL instead of inventing a Posti detector', () => {
    // OSS EXAMPLE, inbound NL-issued identifier (explicit-Posti parser fixture, not auto-detection).
    // Source: https://github.com/hatlabs/posti-cli
    expect(detectCarrier('LR288565359NL')).toBe('spring-gds');
  });
});

describe('100-carrier detection: Spain, Portugal, Italy', () => {
  it('keeps Correos Express 16-digit ambiguous', () => {
    // REPORTED REAL 16-digit shipment IDs.
    // Sources: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/incidencia-env-C3-ADo-imposible-h/0052eb4a8375da7128
    // and https://www.ocu.org/reclamar/lista-reclamaciones-publicas/pedido-falsamente-entregado/09810690efcb4f7fde
    for (const number of ['7983000739053141', '3230002125829719']) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toContain('correos-express');
    }
  });

  it('detects MRW letter variants and keeps pure-numeric 12-digit ambiguous', () => {
    // REPORTED REAL 12-char variants (numeric + 5-digits-letter-6-digits).
    // Sources: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/paquete-perdido/f8b8fd62addc12cbed
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/alguien-recibi-C3-B3-mi-paquete/f4db963472379569e8
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/mi-paquete-lleva-en-22transito-22/3ca104c95fcd6886da
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/paquete-no-entregado/fd09f6a9ec09f35aab
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/reembolso/6d4f300aa0dd6d5c26
    expect(detectCarrier('08203F557102')).toBe('mrw');
    expect(detectCarrier('02680I390427')).toBe('mrw');
    expect(detectCarrier('02692M027981')).toBe('mrw');
    expect(detectCarrier('02673I145025')).toBe('mrw');
    const numeric = detectCarrierMatch('038233020970');
    expect(numeric.carrier).toBe('unknown');
    expect(numeric.candidates).toContain('mrw');
  });

  it('detects NACEX agency/shipment composites with their slash boundary', () => {
    // REPORTED REAL agency/shipment composites (slash preserved, not a plain numeric ID).
    // Sources: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/no-entrega-de-envio-a-tiempo/dca1c166a05005867c
    // and https://www.ocu.org/reclamar/lista-reclamaciones-publicas/reclamaci-C3-B3n-por-da-C3-B1o-a-mercanc/7bf1f90f3a5fe7d8cb
    expect(detectCarrier('2103/11207088')).toBe('nacex');
    expect(detectCarrier('2850/11247170')).toBe('nacex');
  });

  it('detects SEUR 14/21-digit shipment IDs while leaving the 7-digit reference alone', () => {
    // REPORTED REAL shipment IDs (DPD/SEUR handoffs need carrier context).
    // Source: https://www.ocu.org/reclamar/empresas/seur/500000075
    for (const number of ['01475194188635', '046999610972820260807']) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toContain('seur');
    }
    // 7-digit shipment reference — separate from parcel barcodes, no standalone lookup promised.
    // Source: https://www.ocu.org/reclamar/empresas/seur/500000075
    expect(detectCarrier('1796295')).toBe('unknown');
  });

  it('detects CTT Portugal S10 and CTT Express 00-prefixed 22-digit barcodes', () => {
    // REPORTED REAL CTT label (PT issuer, final mile may differ).
    // Source: https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/ritardo-consegna-raccomandata/f9bc9dea8c8224161d
    expect(detectCarrier('RL402552798PT')).toBe('ctt');
    // REPORTED REAL CTT Express 22-digit barcodes (leading zeros preserved).
    // Sources: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/reclamaci-C3-B3n-por-p-C3-A9rdida-de-mer/da714ccf4d8f261583
    // and https://www.ocu.org/reclamar/empresas/ctt-express/3C8C0C39-1EAE90226
    for (const number of ['0082800011298638008391', '0082800082809771393048', '0082800082809771598159']) {
      expect(detectCarrier(number)).toBe('ctt-express');
    }
  });

  it('detects Poste Italiane RA/1UW/3UW/5P/2IMA families and leaves the NL handoff to PostNL', () => {
    // REPORTED REAL Poste Italiane/SDA specimens (RA is not S10 — no country suffix).
    // Sources (altroconsumo public complaints):
    // https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/spedizione-persa/f51f02b1ee980bd0bd (RA00020974503)
    // https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/nessuno-sa-dove-si-trova-il-mi/d6bbf9fcb0dad025b2 (1UW1G2J193065)
    // https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/posta-delivery-attesa-pi-C3-B9-di-2/862635c7ab6f209ad0 (1UW1GF0355933, 1UW1GF0359668)
    // https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/poste-non-consegna-resa-al-mi/8b8789c70e8c99692a (5P38C32989681)
    // https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/rimborso-merce-spedizione-smar/6a89612b76f513e66c (3UW1GY0000066)
    // https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/consegna-mai-ricevuta/97b85e8cbc17700047 (2IMA0051035900)
    for (const number of [
      'RA00020974503', '1UW1G2J193065', '1UW1GF0355933', '1UW1GF0359668',
      '5P38C32989681', '3UW1GY0000066', '2IMA0051035900',
    ]) {
      expect(detectCarrier(number)).toBe('poste-italiane');
    }
    // Foreign-issued inbound NL S10 stays with PostNL.
    // Source: https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/reso-ritornato-al-mittente-e-p/5341225f84324f54e4
    expect(detectCarrier('CH166307960NL')).toBe('spring-gds');
  });

  it('keeps BRT 14-digit ambiguous', () => {
    // REPORTED REAL shipment vs BRTcode (both 14 digits, roles preserved).
    // Source: https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/brt-non-mi-consegna-il-pacco-n/c869ef987b19acc348
    for (const number of ['25003180070704', '08454077486990']) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toContain('brt');
    }
  });

  it('detects Correos PR-prefixed 18-char report', () => {
    // REPORTED REAL 18-char specimen (historical CV S10 shape stays quarantined below).
    // Source: https://www.htcmania.com/archive/index.php/t-964137.html
    expect(detectCarrier('PR110604670130400C')).toBe('correos-spain');
  });

  it('keeps TIPSA 10-digit ambiguous', () => {
    // REPORTED REAL merchant-confirmed TIPSA tracking number (separate from order number).
    // Source: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/no-recibido-pedido/ca39ecd30bb517b380
    const match = detectCarrierMatch('8104405448');
    expect(match.carrier).toBe('unknown');
    expect(match.candidates).toContain('tipsa');
  });

  it('keeps Ecoscooting 18-digit ambiguous and leaves the DE handoff to DHL', () => {
    // REPORTED REAL 18-digit Ecoscooting IDs (multiple prefixes, do not steal Swiss 18-digit).
    // Sources: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/cuidado-con-ecoscooting/eec55dfee3121ef28c
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/las-entregas-no-llegan-/a9ac02ca080289f896
    // https://www.ocu.org/reclamar/lista-reclamaciones-publicas/pedido-nunca-llega/571d0533088b8ba848
    for (const number of ['081730000038942441', '380030000066362966', '380030000066782505', '083030000063547779']) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toContain('ecoscooting');
    }
    // Foreign postal handoff report stays with its issuer route.
    // Source: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/paquete-extraviado-cq34377077/a9305cbaea4cb4fa5a
    expect(detectCarrier('CQ343770772DE')).toBe('dhl');
  });
});

describe('100-carrier detection: Americas', () => {
  it('keeps USPS 22-digit ambiguous with Austrian Post', () => {
    // OSS EXAMPLES, legacy/IMpb (service identifier + check digit matter, not length alone).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/usps.json
    for (const number of [
      '9400111206206406260787', '9400111201080805483016', '9405803699300124287899',
      '9434611206206406227577', '9101123456789000000013', '9261290336128704042634',
    ]) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toEqual(expect.arrayContaining(['usps', 'austrian-post']));
    }
    // 22-digit Austrian Post official example stays on the same ambiguous family.
    // Source: https://www.post.at/
    const at = detectCarrierMatch('1011236513864670170531');
    expect(at.carrier).toBe('unknown');
    expect(at.candidates).toEqual(expect.arrayContaining(['austrian-post', 'usps']));
  });

  it('keeps Canada Post 16-digit ambiguous', () => {
    // OSS EXAMPLES (leading zeros + mod-10 matter; notice cards are a different input type).
    // Sources: https://github.com/jkeen/tracking_number_data/blob/main/couriers/canadapost.json
    // and https://github.com/karrioapi/karrio/blob/deea10f8568b2d48c71bbcc11ec11c62cdaf2a6a/modules/connectors/canadapost/tests/canadapost/test_tracking.py
    for (const number of ['0073938000549297', '7035114477138472', '4002847016405018', '7023210039414604']) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toContain('canada-post');
    }
  });

  it('detects Purolator letter prefixes and keeps numeric 12-digit ambiguous', () => {
    // OSS EXAMPLES, both numeric (Luhn) and alphabetic families.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/purolator.json
    for (const number of ['KYV009956937', 'CGK002986959', 'JFV247545960', 'TLR000083964']) {
      expect(detectCarrier(number)).toBe('purolator');
    }
    for (const number of ['320595463938', '287809468872', '331426749957']) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toContain('purolator');
    }
  });

  it('detects Canpar letter-plus-21-digits', () => {
    // OSS EXAMPLES, D/L/S sampled (preserve first letter + leading zeros).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/canpar.json
    for (const number of [
      'D576002440000001718010', 'D576002440000001428004',
      'L576002440000000001004', 'S576002440000000004001',
    ]) {
      expect(detectCarrier(number)).toBe('canpar');
    }
  });

  it('detects OnTrac and legacy LaserShip families', () => {
    // OSS EXAMPLES, C/D + 14 digits.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/ontrac.json
    for (const number of ['C11031500001879', 'C11121552953069', 'D10011354453707', 'D10011345983010']) {
      expect(detectCarrier(number)).toBe('ontrac');
    }
    // OSS LaserShip L-letter + 8 digits.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/lasership.json
    for (const number of ['LX17635036', 'LI12976442', 'LA28376237', 'LH13830790', 'LE10917377', 'LN30083672']) {
      expect(detectCarrier(number)).toBe('ontrac');
    }
    // OSS 1LS families (raw -1 suffix preserved for the carrier parser).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/lasership.json
    for (const number of ['1LS717793482164', '1LS724505321754', '1LS7119013618127-1', '1LSCXVE0058631Y', '1LSCXVE005BUEFX']) {
      expect(detectCarrier(number)).toBe('ontrac');
    }
  });

  it('detects SpeedX SPX-letter, UniUni UUS/4C, Landmark LTN, Old Dominion PRO, Spee-Dee SP and GOFO GFUS', () => {
    // REPORTED REAL SpeedX MIA family (SPX + 3 letters + 12 digits, not SPX + digits).
    // Source: https://es.trustpilot.com/review/speedx.io
    for (const number of ['SPXMIA056759629631', 'SPXMIA056746165383', 'SPXMIA056746185528', 'SPXMIA056745759994']) {
      expect(detectCarrier(number)).toBe('speedx');
    }
    // REPORTED REAL UniUni label reports (BBB scam-tracker, identifier only, no PII).
    // Sources: https://www.bbb.org/scamtracker/lookupscam/1111994 (UUS) and https://www.bbb.org/scamtracker/lookupscam/1107364 (4C)
    expect(detectCarrier('UUS5B60564241706199')).toBe('uniuni');
    expect(detectCarrier('4C003925742US')).toBe('uniuni');
    // OSS Landmark fixtures (do not generalize terminal N1).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/landmark.json
    for (const number of ['LTN74207623N1', 'LTN74209518N1', 'LTN74224021N1']) {
      expect(detectCarrier(number)).toBe('landmark-global');
    }
    // OSS Old Dominion PROs (freight; Luhn-validated upstream, collision-prone numerics).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/old_dominion.json
    for (const number of ['07209562763', '77767553207', '77806528897', '78045768393', '80003280379', '80993847369']) {
      expect(detectCarrier(number)).toBe('old-dominion');
    }
    // OSS Spee-Dee SP + 18 digits (20 total — not a Planzer 20-digit number, keep the SP prefix).
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/speedee.json
    for (const number of ['SP029692510000920746', 'SP029692510000901479', 'SP029692450001607639']) {
      expect(detectCarrier(number)).toBe('spee-dee');
    }
    // OSS GOFO GFUS + 14 digits.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/gofo.json
    for (const number of ['GFUS01011884214464', 'GFUS01011884214272']) {
      expect(detectCarrier(number)).toBe('gofo');
    }
  });

  it('keeps Estafeta 10-digit and Correos de Chile 13-digit ambiguous', () => {
    // OSS Estafeta SDK example (10-digit tracking code vs 22-digit waybill).
    // Source: https://github.com/dmoralesm/estafeta-api
    const estafeta = detectCarrierMatch('2806075762');
    expect(estafeta.carrier).toBe('unknown');
    expect(estafeta.candidates).toContain('estafeta');
    // OSS Correos de Chile API example (13 numerics, not S10).
    // Source: https://github.com/josemontesp/correos
    const chile = detectCarrierMatch('3072708247886');
    expect(chile.carrier).toBe('unknown');
    expect(chile.candidates).toContain('correos-chile');
  });

  it('detects Correios Brazil native BR S10 and routes inbound partner S10 to its issuer', () => {
    // OSS EXAMPLE, native BR identifier.
    // Source: https://github.com/guilhermechapiewski/correios-api-py
    expect(detectCarrier('ES446391025BR')).toBe('correios-br');
    // Inbound partner identifiers stay with the issuing post (different routing cases).
    // Sources: https://github.com/leandrotoledo/python-correios (CN) and https://github.com/FelipeMorandini/rastreador_correios (HK)
    expect(detectCarrier('RA222491899CN')).toBe('china-post');
    expect(detectCarrier('LB571181225HK')).toBe('hongkong-post');
  });

  it('detects YunExpress YT + 16 digits', () => {
    // REPORTED REAL cross-border shipment (keep YT ID + last-mile number separate).
    // Source: https://www.reddit.com/r/AirReps/comments/1vfhh53/please_help_yunexpress_alibaba_tracking_stuck_on/
    expect(detectCarrier('YT2621200705470145')).toBe('yunexpress');
  });
});

describe('100-carrier detection: APAC, Middle East, Africa', () => {
  it('detects 4PX, Blue Dart lows, Delhivery lows and NZ/SG/JP S10', () => {
    // OSS 4PX example (4PX + 13 digits + CN).
    // Source: https://github.com/rostis232/parcelstrackingservice
    expect(detectCarrier('4PX3001521662170CN')).toBe('four-px');
    // OFFICIAL Blue Dart write-to-us examples + one public complaint shipment (11 digits, waybill vs reference separate).
    // Sources: https://www.bluedart.com/write-to-us and https://www.consumercomplaints.in/blue-dart-express-b100070
    for (const number of ['79034111122', '79034111041', '90617363115']) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toContain('blue-dart');
    }
    // OSS Delhivery gist + one public complaint (13/14 digits).
    // Sources: https://gist.github.com/gauravsoti1/c2dc7e709401e89be5cf5701c917dd97 and https://www.consumercomplaints.in/delhivery-b103998
    for (const number of ['1623110010010', '32076610152736']) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toContain('delhivery');
    }
    // OSS NZ Post S10 (historical gist fixture).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('EP318770974NZ')).toBe('nz-post');
    // OSS Singapore Post S10 fixtures.
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('RF322965566SG')).toBe('singapore-post');
    expect(detectCarrier('EX011436437SG')).toBe('singapore-post');
    // OSS Japan Post S10 fixture.
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('CI076369983JP')).toBe('japan-post');
  });

  it('keeps SF/STO/Yunda/ZTO/Yamato 12-13-digit numerics ambiguous and detects YTO/DTDC/JD-Logistics distinctly', () => {
    // OSS historical fixtures (single-family samples, not exhaustive validators).
    // Source for all: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    for (const [number, carrier] of [
      ['133938675660', 'sf-express'], ['968754207139', 'sto'], ['1000478495775', 'yunda'],
      ['778564698005', 'zto'], ['410569991366', 'yamato'],
    ] as const) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toContain(carrier);
    }
    // Distinctive alphanumeric families.
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('D00015070907')).toBe('yto');
    expect(detectCarrier('VG05778167021')).toBe('jd-logistics');
    expect(detectCarrier('N95614372')).toBe('dtdc');
  });

  it('detects Korea/Thailand/Hongkong/China Post S10', () => {
    // OSS S10 fixtures (issuer context, not proof of last-mile operator).
    // Source for all: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('EM385783825KR')).toBe('korea-post');
    expect(detectCarrier('EE138961080TH')).toBe('thailand-post');
    // Source: https://github.com/marcoesposito1988/trackingmore-python
    expect(detectCarrier('RE113184005HK')).toBe('hongkong-post');
    // Sources: https://github.com/trackingmore100/tracking-sdk-php/blob/master/README.md
    expect(detectCarrier('RP325552475CN')).toBe('china-post');
    expect(detectCarrier('LZ448865302CN')).toBe('china-post');
  });

  it('detects Pos Malaysia MYPM + S10 MY, Packeta Z + 10 digits and Poczta PX', () => {
    // OFFICIAL Pos Malaysia API-doc examples + OSS S10 fixtures.
    // Sources: https://api-doc.pos.com.my/ and https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('MYPM00000000015')).toBe('pos-malaysia');
    expect(detectCarrier('MYPM00000000017')).toBe('pos-malaysia');
    expect(detectCarrier('RR157638464MY')).toBe('pos-malaysia');
    expect(detectCarrier('RR158903660MY')).toBe('pos-malaysia');
    // REPORTED REAL Packeta/Zasilkovna Z + 10 digits + official placeholder (same family).
    // Sources: https://help.orrs.de/6622/z%C3%A1silkovna-tracking-not-working and https://docs.packeta.com/docs/packet-tracking/tracking
    for (const number of ['Z8328162951', 'Z8328162946', 'Z8360329994', 'Z1234567890']) {
      expect(detectCarrier(number)).toBe('packeta');
    }
    // OFFICIAL Poczta Polska tracking-page placeholders (illustrative, not real shipments).
    // Source: https://www.poczta-polska.pl/en/sledzenie-przesylek/
    expect(detectCarrier('PX0000000013')).toBe('poczta-polska');
    const numeric = detectCarrierMatch('0015900773312345678');
    expect(numeric.carrier).toBe('unknown');
    expect(numeric.candidates).toContain('poczta-polska');
  });

  it('detects Bring NO S10, keeps Aramex 11-digit ambiguous and detects Yanwen BYS', () => {
    // OSS Bring S10 fixture.
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrier('CD656914836NO')).toBe('bring-posten');
    // OSS Aramex 11-digit fixture.
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    const aramex = detectCarrierMatch('30109165494');
    expect(aramex.carrier).toBe('unknown');
    expect(aramex.candidates).toContain('aramex');
    // INTEGRATION DOC Yanwen examples (Tracktry API docs illustrations).
    // Source: https://www.tracktry.com/api-nodejs.html
    expect(detectCarrier('BYS006086088')).toBe('yanwen');
    expect(detectCarrier('BYS006086077')).toBe('yanwen');
  });

  it('keeps TNT 9-digit ambiguous and J&T 12-digit ambiguous', () => {
    // OSS TNT 9-digit fixtures (dedicated FedEx-group route, not an independent parent claim).
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    for (const number of ['928567507', '211691259']) {
      const match = detectCarrierMatch(number);
      expect(match.carrier).toBe('unknown');
      expect(match.candidates).toContain('tnt');
    }
    // REPORTED REAL Indonesian J&T numeric shipment (spaces as printed; regional formats differ).
    // Source: https://news.detik.com/suara-pembaca/d-3988487/paket-dinyatakan-hilang-j-t-menolak-mengganti-penuh
    const jt = detectCarrierMatch('888 058 657 515');
    expect(jt.carrier).toBe('unknown');
    expect(jt.candidates).toContain('j-and-t');
  });
});

describe('100-carrier detection: quarantined, negative and barcode research cases', () => {
  it('never uses checksum-failing S10 shapes as positive oracles', () => {
    // OFFICIAL placeholders / quarantined attributions (keep source strings unchanged).
    const quarantined: Array<[string, string]> = [
      // Source: https://www.post.at/ (fails S10)
      ['CA482156827DE', 'fails S10; inbound/handoff example, not an Austrian-issuer rule'],
      // Source: https://developer.postnl.nl/integration-with-postnl/api-overview/send-and-track/barcode-webservice/
      ['UE597256100NL', 'fails S10; not a PostNL positive'],
      ['RI543495045NL', 'fails S10; not a PostNL positive'],
      // Source: https://www.nzpost.co.nz/business/developer-centre/nz-post-legacy-apis/tracking-api/track-method
      ['XY123456789NZ', 'placeholder, fails S10; not an NZ Post positive'],
      // Source: https://www.singpost.com/sending-within-singapore/registered-service
      ['RA123456789SG', 'placeholder, fails S10; not a Singapore Post positive'],
      // Source: https://www.post.japanpost.jp/service/send/oversea/information/ems_search_en.html
      ['UL123456789JP', 'non-tracking example, fails S10; not a Japan Post positive'],
      // Source: https://www.poczta-polska.pl/en/sledzenie-przesylek/
      ['RR123456789PL', 'placeholder, fails S10'],
      ['CP123456789PL', 'placeholder, fails S10'],
      ['VV123456789PL', 'placeholder, fails S10'],
      ['EE123456789PL', 'placeholder, fails S10'],
      // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
      ['CV000562646ES', 'historical shape, fails S10; not a Correos positive'],
    ];
    for (const [number] of quarantined) {
      expect(isValidS10(number), number).toBe(false);
    }
    function isValidS10(raw: string): boolean {
      const value = raw.toUpperCase().replace(/[\s.-]/g, '');
      if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(value)) return false;
      const weights = [8, 6, 4, 2, 3, 5, 9, 7];
      const sum = weights.reduce((total, weight, index) => total + Number(value[index + 2]) * weight, 0);
      const rawCheck = 11 - (sum % 11);
      const expected = rawCheck === 10 ? 0 : rawCheck === 11 ? 5 : rawCheck;
      return Number(value[10]) === expected;
    }
  });

  it('does not route full routing barcodes as ordinary shipment IDs', () => {
    // OSS full-barcode fixtures — validate-then-strip constructs, not interchangeable shipment IDs.
    // Source: https://github.com/jkeen/tracking_number_data/blob/main/couriers/usps.json
    for (const number of [
      '420787459400111206206406260787', '420221539101026837331000039521',
      '420902459261290336128704042634', '4201002334249200190132607600833457',
      '4201028200009261290113185417468510',
    ]) {
      expect(detectCarrier(number)).toBe('unknown');
    }
    // REPORTED REAL 24-digit Ciblex customer labels — rejected as-is, conversion unresolved.
    // Source: https://fr.trustpilot.com/review/www.ciblex.fr
    for (const number of ['560815852502035603344150', '560815852502035613344150']) {
      expect(detectCarrierMatch(number).candidates).not.toContain('ciblex');
    }
    // Quarantined 23-digit Correos Express assignment and 15-digit BRT correction.
    // Sources: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/problema-con-el-repartidor/e30b27faaae7c53755
    // and https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/firma-falsificata-e-pacco-mai-/f6a66bc9986923ffcf
    expect(detectCarrier('93005001081690801339400')).toBe('unknown');
    expect(detectCarrierMatch('027280011093919').carrier).toBe('unknown');
  });

  it('keeps research-only attributions out of exclusive routing', () => {
    // OSS DHL eCommerce partner-postal/USPS delivery-number fields (not interchangeable package IDs).
    // Source: https://developer.dhl.com/api-reference/references-dhl-ecommerce-americas
    expect(detectCarrier('9361269903500011492028')).toBe('unknown');
    expect(detectCarrier('9261269903500013618305')).toBe('unknown');
    // 31-digit intelligent-mail barcodes are non-parcel inputs.
    // Source: https://developer.dhl.com/api-reference/references-dhl-ecommerce-americas
    expect(detectCarrier('0031043534391627906195625053434')).toBe('unknown');
    // Australia Post tutorial fixtures need corroboration (not exclusive detectors).
    // Source: https://github.com/clooney/australia-post-tracking-api/blob/master/australia-post-tracking-api-python.md
    expect(detectCarrier('0301006785462006320995')).toBe('unknown');
    // TNT regional legacy fixtures need confirmation.
    // Source: https://gist.github.com/zxp/e83a4a1b7294a5ed6207
    expect(detectCarrierMatch('1158418300904').carrier).toBe('unknown');
    expect(detectCarrier('MY33217326')).toBe('unknown');
    // The Courier Guy 5-char short reference is not a standalone tracking oracle.
    // Source: https://www.consumercomplaints.in/bycompany/the-courier-guy-south-africa-a266527.html
    expect(detectCarrier('QGB8C')).toBe('unknown');
    // SF Express unattributed public report stays a low candidate only.
    // Source: https://www.paketda.de/fragen-antworten
    const sf = detectCarrierMatch('SF6047381042488');
    expect(sf.carrier).toBe('unknown');
    expect(sf.candidates).toContain('sf-express');
  });

  it('documents shared-adapter and handoff identities without inventing routes', () => {
    // Historical Chronopost XF/XA fixtures fall into La Poste S10 (shared la-poste adapter covers both).
    // Sources: https://gist.github.com/zxp/e83a4a1b7294a5ed6207 and Fnac Darty merchant guidance.
    expect(detectCarrier('XF918805290FR')).toBe('la-poste');
    expect(detectCarrier('XA547564856FR')).toBe('la-poste');
    // Inbound/handoff S10 samples stay with the issuing post; Ukrposhta has no number-only detector.
    // Source: https://github.com/kolyabres/ukrposhta-api
    expect(detectCarrier('RF426331371SG')).toBe('singapore-post');
    // Delivengo LD overlap with La Poste is intentional (manual choice, shared adapter).
    // Original source (not reloaded): https://www.philaseiten.de/cgi-bin/index.pl?PR=319289
    expect(detectCarrier('LD156008025FR')).toBe('la-poste');
    // Paack C-family collision: C + 14 digits matches OnTrac high — explicit selection must win.
    // Source: https://www.ocu.org/reclamar/lista-reclamaciones-publicas/entrega-no-recibida/4d61e00924bdfeea75
    expect(detectCarrier('C25062001456003')).toBe('ontrac');
    // Ninja Van official examples need a broader spec before exclusive detection.
    // Source: https://api-docs.ninjavan.co/
    expect(detectCarrier('NVSGBEDBP03784ADPL')).toBe('unknown');
  });
});
