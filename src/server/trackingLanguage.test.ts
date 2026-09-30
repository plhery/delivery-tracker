import { describe, expect, it } from 'vitest';
import type { Stage } from '../types';
import { trackingLanguageStage } from '@carriers/core/status';
import { inferStage, buildEvents } from './trackingSync';
import { event } from '@carriers/providers/shared/result';
import { parseDHLEcommerceResponse } from '@carriers/carriers/dhl-ecommerce/adapter';
import { parseDHLTrackingResponse } from '@carriers/carriers/dhl/adapter';

// GENERATED contrasts, not observed carrier scans. These intuitive equivalents
// test the semantic boundaries around the real histories and remain overridable.
// Spanish and Portuguese cover the delivery-side milestones only.
const contrasts: { expected: Stage; en: string; fr: string; de: string; it: string; es?: string; pt?: string }[] = [
  { expected: 'returned', en: 'Returned to sender', fr: "Retourné à l'expéditeur",
    de: 'Zurück an den Absender', it: 'Restituito al mittente', es: 'Devuelto al remitente', pt: 'Devolvido ao remetente' },
  { expected: 'failed_attempt', en: 'Delivery attempt failed', fr: 'Échec de la tentative de livraison',
    de: 'Zustellversuch fehlgeschlagen', it: 'Tentativo di consegna non riuscito',
    es: 'Intento de entrega fallido', pt: 'Tentativa de entrega falhada' },
  { expected: 'failed_attempt', en: 'Attempted delivery, recipient not available', fr: 'Destinataire absent',
    de: 'Empfänger nicht angetroffen', it: 'Destinatario assente', es: 'Destinatario ausente', pt: 'Destinatário ausente' },
  { expected: 'failed_attempt', en: 'Business closed', fr: 'Entreprise fermée',
    de: 'Geschäft geschlossen', it: 'Attività chiusa', es: 'Establecimiento cerrado', pt: 'Estabelecimento fechado' },
  { expected: 'in_transit', en: 'Delivered to the local carrier', fr: 'Livré au transporteur local',
    de: 'An den lokalen Zusteller übergeben', it: 'Consegnato al corriere locale',
    es: 'Entregado al transportista local', pt: 'Entregue à transportadora local' },
  { expected: 'ready_for_pickup', en: 'Ready for collection', fr: 'Disponible au point de retrait',
    de: 'Zur Abholung bereit', it: 'Disponibile per il ritiro', es: 'Disponible para recoger', pt: 'Disponível para levantamento' },
  { expected: 'in_transit', en: 'Will be available for pickup tomorrow', fr: 'Sera disponible au point de retrait demain',
    de: 'Wird morgen zur Abholung verfügbar sein', it: 'Sarà disponibile per il ritiro domani',
    es: 'Estará disponible para recoger mañana', pt: 'Estará disponível para levantamento amanhã' },
  { expected: 'registered', en: 'Will be delivered tomorrow', fr: 'Sera livré demain',
    de: 'Wird morgen zugestellt', it: 'Sarà consegnato domani', es: 'Será entregado mañana', pt: 'Será entregue amanhã' },
  { expected: 'out_for_delivery', en: 'Loaded into the delivery vehicle', fr: 'Chargé dans le véhicule de livraison',
    de: 'In das Zustellfahrzeug geladen', it: 'Caricato nel veicolo di consegna',
    es: 'Cargado en el vehículo de reparto', pt: 'Carregado no veículo de entrega' },
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
  { expected: 'delivered', en: 'Delivered', fr: 'Livré', de: 'Zugestellt', it: 'Consegnato', es: 'Entregado', pt: 'Entregue' },
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
    'Unbekannter Wortlaut', 'Testo sconosciuto', 'Texto desconocido', 'Texto desconhecido',
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
    for (const description of ['Livré', 'Zugestellt', 'Consegnato', 'Entregado', 'Entregue']) {
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

  it.each([
    'Shipment recorded by sender (data delivered)',
    'Consignment recorded by the foreign sender (data delivered)',
  ])('treats sender pre-advice with "data delivered" as registered: %s', (description) => {
    expect(trackingLanguageStage(description)).toBe('registered');
    expect(inferStage(description, 'pending')).toBe('registered');
    expect(event('2026-01-01T12:00:00Z', description)?.stage).toBe('registered');
  });

  // OBSERVED universal-provider wording where the provider rules ("handed over",
  // "out for delivery") used to decide before the language rules.
  it.each([
    ['We have received a notification from your shipper that they are preparing an item for you. The tracking information will be updated when the parcel is handed over to PostNord.', 'registered'],
    ['Shipper generated a new shipment label, but the shipment has not been handed over to Aramex, yet. Shipment will be updated once collected from shipper and received in Aramex offices', 'registered'],
    ['Item handed over to delivery partner', 'in_transit'],
    ['The customer has shared new delivery instructions and the status will be updated once shipment is out for delivery', 'in_transit'],
    ["We've attempted to deliver the shipment, but the customer was not available at the time. Not to worry, the delivery has been rescheduled", 'failed_attempt'],
  ] as const)('[observed universal] stages "%s" as %s', (description, expected) => {
    expect(inferStage(description, 'pending')).toBe(expected);
    expect(event('2026-01-01T12:00:00Z', description)?.stage).toBe(expected);
  });

  it('[observed universal] reduces a delivery that names its recipient to a safe description', () => {
    expect(event('2026-01-01T12:00:00Z', 'Delivery complete. Recipient : () Result : Delivery complete'))
      .toMatchObject({ stage: 'delivered', description: 'Delivered' });
  });

  // GENERATED phrasings around the bare word "delivered": handoffs, pickup
  // points, returns, forecasts and negations must not read as a delivery.
  it.each([
    ['Delivered to airline', 'in_transit'],
    ['Parcel delivered to courier', 'in_transit'],
    ['Delivered to the carrier for transport', 'in_transit'],
    ['Delivered to sorting center', 'in_transit'],
    ['Delivered to hub', 'in_transit'],
    ['Delivered to the local post office for final delivery', 'in_transit'],
    ['Delivered to destination postal operator', 'in_transit'],
    ['Item delivered to the destination country', 'in_transit'],
    ['Delivered to Swiss Post', 'in_transit'],
    ['Consignment delivered to the transport company', 'in_transit'],
    ['Consegnato al corriere', 'in_transit'],
    ['Delivered to ParcelShop', 'ready_for_pickup'],
    ['Delivered to Packstation', 'ready_for_pickup'],
    ['Delivered to the pickup point', 'ready_for_pickup'],
    ['Colis livré au point relais', 'ready_for_pickup'],
    ['Votre colis est disponible dans votre point de retrait. Il vous sera remis sur présentation d’une pièce d’identité.', 'ready_for_pickup'],
    ['Delivered to the sender', 'returned'],
    ['Returned and delivered to sender', 'returned'],
    ['Expected to be delivered on Monday', 'in_transit'],
    ['Voraussichtlich zugestellt am Montag', 'registered'],
    ['Not yet delivered', 'failed_attempt'],
    ['Undelivered', 'failed_attempt'],
    ['Your parcel is being delivered', 'out_for_delivery'],
    ['Order information delivered to carrier', 'registered'],
    ['Data delivered to Swiss Post', 'registered'],
    ['Daten übermittelt', 'registered'],
    ['Prenotification Received', 'registered'],
    ['Data Received With Prefix Label', 'registered'],
  ] as const)('[generated] does not read "%s" as a delivery', (description, expected) => {
    expect(trackingLanguageStage(description)).toBe(expected);
    expect(inferStage(description, 'pending')).toBe(expected);
    expect(event('2026-01-01T12:00:00Z', description)?.stage).toBe(expected);
  });

  it.each([
    'Delivered', 'Delivered to neighbour', 'Delivered to the mailbox', 'Delivered to the parcel box',
    'Delivered to the post box', 'Delivered to recipient', 'Package delivered', 'Delivery successful.',
  ])('[generated] still reads "%s" as a delivery', (description) => {
    expect(trackingLanguageStage(description)).toBe('delivered');
    expect(event('2026-01-01T12:00:00Z', description)?.stage).toBe('delivered');
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
    'Entregado, firmado por [recipient]',
    'Entregue, assinado por [recipient]',
    'Entregado; código de entrega: [code]',
    'Entregue; código de levantamento: [code]',
  ])('[generated privacy] reduces delivery wording to a safe description: %s', (description) => {
    expect(event('2026-01-01T12:00:00Z', description)?.description).toBe('Delivered');
  });

  it.each([
    'Ready for pickup; collection code: [code]',
    'Disponible au point de retrait ; code de retrait : [code]',
    "Disponible au point de retrait ; code d'accès : [code]",
    'Destinataire absent, numéro de maison [number]',
    'Zur Abholung bereit; Abholcode: [code]',
    'Disponibile per il ritiro; codice di ritiro: [code]',
    'Ausente. Código de recogida: [code]',
    'Disponible en el punto; codigo de retirada [code]',
    'Aviso de llegada firmado por [recipient]',
    'Destinatario ausente en el número de portal [number]',
    'Disponível para levantamento; código de levantamento: [code]',
    'Aviso assinado por [recipient]',
    'Não entregue, porta nº [number]',
  ])('[generated privacy] excludes access details: %s', (description) => {
    expect(event('2026-01-01T12:00:00Z', description)).toBeNull();
  });

  it.each([
    'Recibido por Estafeta', 'Objeto recebido pelos Correios do Brasil', 'Firma geschlossen', 'Código de envío [number]',
  ])('[generated privacy] keeps carrier handoffs and references: %s', (description) => {
    expect(event('2026-01-01T12:00:00Z', description)).not.toBeNull();
  });
});
