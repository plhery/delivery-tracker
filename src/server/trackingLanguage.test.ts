import { describe, expect, it } from 'vitest';
import type { Stage } from '../types';
import { trackingLanguageStage } from './trackingLanguage';
import { inferStage, buildEvents } from './trackingSync';
import { event } from './universalTrackingResult';
import { parseDHLEcommerceResponse } from './dhlEcommerce';
import { parseDHLTrackingResponse } from './dhl';

// GENERATED contrasts, not observed carrier scans. These intuitive equivalents
// test the semantic boundaries around the real histories and remain overridable.
const contrasts: { expected: Stage; en: string; fr: string; de: string; it: string }[] = [
  { expected: 'returned', en: 'Returned to sender', fr: "Retourné à l'expéditeur",
    de: 'Zurück an den Absender', it: 'Restituito al mittente' },
  { expected: 'failed_attempt', en: 'Delivery attempt failed', fr: 'Échec de la tentative de livraison',
    de: 'Zustellversuch fehlgeschlagen', it: 'Tentativo di consegna non riuscito' },
  { expected: 'in_transit', en: 'Delivered to the local carrier', fr: 'Livré au transporteur local',
    de: 'An den lokalen Zusteller übergeben', it: 'Consegnato al corriere locale' },
  { expected: 'ready_for_pickup', en: 'Ready for collection', fr: 'Disponible au point de retrait',
    de: 'Zur Abholung bereit', it: 'Disponibile per il ritiro' },
  { expected: 'in_transit', en: 'Will be available for pickup tomorrow', fr: 'Sera disponible au point de retrait demain',
    de: 'Wird morgen zur Abholung verfügbar sein', it: 'Sarà disponibile per il ritiro domani' },
  { expected: 'registered', en: 'Will be delivered tomorrow', fr: 'Sera livré demain',
    de: 'Wird morgen zugestellt', it: 'Sarà consegnato domani' },
  { expected: 'out_for_delivery', en: 'Loaded into the delivery vehicle', fr: 'Chargé dans le véhicule de livraison',
    de: 'In das Zustellfahrzeug geladen', it: 'Caricato nel veicolo di consegna' },
  { expected: 'in_transit', en: 'Customs clearance completed', fr: 'Dédouanement terminé',
    de: 'Zollabfertigung abgeschlossen', it: 'Sdoganamento completato' },
  { expected: 'customs', en: 'Customs clearance has not been completed', fr: "Le dédouanement n'est pas terminé",
    de: 'Zollabfertigung nicht abgeschlossen', it: 'Sdoganamento non completato' },
  { expected: 'registered', en: 'Label created; the carrier has not received the parcel yet',
    fr: "Étiquette créée ; le transporteur n'a pas encore reçu le colis",
    de: 'Versandetikett erstellt; der Zusteller hat das Paket noch nicht erhalten',
    it: 'Etichetta creata; il corriere non ha ancora ricevuto il pacco' },
  { expected: 'accepted', en: 'Parcel handed to DPD', fr: 'Colis remis à DPD',
    de: 'Paket an DPD übergeben', it: 'Pacco affidato a DPD' },
  { expected: 'delivered', en: 'Delivered', fr: 'Livré', de: 'Zugestellt', it: 'Consegnato' },
];

describe('intuitive language contrasts', () => {
  it.each(contrasts.flatMap(({ expected, ...translations }) =>
    Object.entries(translations).map(([language, description]) => ({ expected, language, description })),
  ))('[generated $language] $description', ({ expected, description }) => {
    expect(trackingLanguageStage(description)).toBe(expected);
    expect(inferStage(description, 'pending')).toBe(expected);
    expect(event('2026-01-01T12:00:00Z', description)?.stage).toBe(expected);
  });

  it.each(['Un livre dans notre boutique', 'Carrier-specific wording', 'Texte non reconnu',
    'Unbekannter Wortlaut', 'Testo sconosciuto',
  ])('[generated unknown] does not invent progress for %s', (description) => {
    expect(trackingLanguageStage(description)).toBeUndefined();
    expect(event('2026-01-01T12:00:00Z', description)?.stage).toBe('pending');
  });

  it.each(['ÉTIQUETTE CRÉÉE', 'Etiquette creee', 'Colis annoncé électroniquement',
    'Colis annonce electroniquement', 'Colis en préparation chez l’expéditeur',
    "Colis en préparation chez l'expéditeur",
  ])('[generated orthography] understands %s', (description) => {
    expect(trackingLanguageStage(description)).toBe('registered');
  });

  it('keeps verified structured stages ahead of inferred translations', () => {
    for (const description of ['Livré', 'Zugestellt', 'Consegnato']) {
      expect(buildEvents({ id: 'synthetic', carrier: 'swiss-post' }, {
        events: [{ time: '2026-01-01T12:00:00Z', description, stage: 'ready_for_pickup' }],
      })[0].stage).toBe('ready_for_pickup');
      expect(event('2026-01-01T12:00:00Z', description, 'AvailableForPickup')?.stage).toBe('ready_for_pickup');
    }
    const scan = { timestamp: '2026-01-01T12:00:00Z', description: 'Étiquette créée', statusCode: 'delivered' };
    expect(parseDHLEcommerceResponse({ shipments: [{
      id: 'synthetic', service: 'ecommerce', status: scan, events: [scan],
    }] }).current_stage).toBe('delivered');
  });

  it('does not generalize Planzer’s observed Shipped=delivered convention', () => {
    for (const description of ['Shipped', 'Expédié', 'Versandt', 'Spedito']) {
      expect(trackingLanguageStage(description)).not.toBe('delivered');
    }
  });

  it.each(['Will be delivered tomorrow', 'Sera livré demain',
    'Wird morgen zugestellt', 'Sarà consegnato domani',
  ])('[generated DHL forecast] preserves structured progress for %s', (description) => {
    for (const [progress, expected] of [[1, 'registered'], [3, 'in_transit']] as const) {
      expect(parseDHLTrackingResponse({ sendungen: [{
        id: 'SYNTHETIC0001', sendungsdetails: {
          sendungsverlauf: { status: description, fortschritt: progress, events: [] },
        },
      }] }, 'SYNTHETIC0001').current_stage).toBe(expected);
    }
  });

  it.each([
    'Delivered, signed by [recipient]',
    'Livré, signé par [recipient]',
    'Zugestellt, unterschrieben von [recipient]',
    'Consegnato, firmato da [recipient]',
  ])('[generated privacy] reduces delivery wording to a safe description: %s', (description) => {
    expect(event('2026-01-01T12:00:00Z', description)?.description).toBe('Delivered');
  });

  it.each([
    'Ready for pickup; collection code: [code]',
    'Disponible au point de retrait ; code de retrait : [code]',
    'Zur Abholung bereit; Abholcode: [code]',
    'Disponibile per il ritiro; codice di ritiro: [code]',
  ])('[generated privacy] excludes access details: %s', (description) => {
    expect(event('2026-01-01T12:00:00Z', description)).toBeNull();
  });
});
