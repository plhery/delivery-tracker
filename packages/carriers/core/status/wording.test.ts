import { describe, expect, it } from 'vitest';
import { classifyWording, wordingStage } from './wording';
import { trackingLanguageStage } from './language';

describe('classifyWording', () => {
  it.each(['Not delivered to sender', 'Will be delivered back to sender', 'May have been delivered to the sender',
    "Wasn't delivered back to shipper", 'To be delivered to the shipper', 'Being delivered back to sender', 'Will not be delivered to sender'])(
    'does not complete sender delivery from %s', wording => {
      expect(trackingLanguageStage(wording)).toBe('exception');
      expect(wordingStage(wording)).toBe('exception');
    },
  );
  it.each(['Returning to sender', 'Return to sender', 'The item will be returned to sender',
    'To be returned to the sender', 'The item is being returned to the sender', 'Return initiated',
    'Will soon be returned to sender', 'Not yet returned to sender', 'Could not be returned to sender',
    'Cannot be returned to sender', 'Will not be returned to sender', "Hasn't been returned to sender",
    'Hasn’t yet been returned to the sender', "Won't be returned to sender", "Wasn't returned to sender",
    'May be returned to sender', 'Should be returned to sender', 'Might have been returned to sender',
    'Will have been returned to sender', 'Could already have been returned to sender'])(
    'keeps %s nonterminal', wording => {
      expect(wordingStage(wording)).toBe('exception');
    },
  );

  it.each(['Returned to sender', 'Has been returned to the sender', 'Delivered back to sender',
    'Delivered to the shipper', 'Has been delivered back to the sender',
    'Has already been returned to sender', 'The item was not delivered and has been returned to sender',
    'Not delivered to recipient; delivered back to sender'])(
    'recognizes completed sender delivery: %s', wording => {
      expect(wordingStage(wording)).toBe('returned');
    },
  );

  it('names the rule that decided the stage', () => {
    expect(classifyWording('Delivery attempt failed')).toEqual({ stage: 'failed_attempt', source: 'wording:language' });
    expect(classifyWording('Confirmation of receipt')).toEqual({ stage: 'delivered', source: 'wording:delivered' });
    expect(classifyWording('Parcel is out for delivery')).toEqual({ stage: 'out_for_delivery', source: 'wording:language' });
    expect(classifyWording('Reported')).toEqual({ stage: 'registered', source: 'wording:language' });
  });

  it('classifies carrier-reported problems as exception', () => {
    expect(classifyWording('Colis endommagé')).toEqual({ stage: 'exception', source: 'wording:language' });
    expect(classifyWording('Package refused by the recipient')).toEqual({ stage: 'exception', source: 'wording:language' });
    expect(classifyWording('Indirizzo errato')).toEqual({ stage: 'exception', source: 'wording:language' });
    expect(classifyWording('Carrier exception')).toEqual({ stage: 'exception', source: 'wording:exception_incident' });
    expect(classifyWording('Updated delivery address required from customer')).toEqual({ stage: 'exception', source: 'wording:language' });
    expect(wordingStage('Przesyłka zatrzymana')).toBe('exception');
  });

  it('keeps missed delivery attempts and returns out of exception', () => {
    expect(wordingStage('Delivery attempt, recipient absent')).toBe('failed_attempt');
    expect(wordingStage('Non livré, destinataire absent')).toBe('failed_attempt');
    expect(wordingStage('Retour à l\'expéditeur')).toBe('returned');
  });

  it('reads missed rounds worded around the attempt, the absent recipient or a closed business', () => {
    for (const wording of [
      "We've attempted to deliver the shipment, but the customer was not available at the time. Not to worry, the delivery has been rescheduled",
      "We've attempted to deliver the shipment, but the customer was not available at the time. Not to worry, the delivery will be re-attempted",
      'Attempted delivery - receiver unavailable',
      'Absence. Attempted delivery.',
      '<User not at home>',
      'Unsuccessful delivery. Reason : Absence of addressee Result :',
      "We're sorry but we were unable to complete your delivery. Please continue to check your tracking for real time updates",
      'The driver tried to deliver the package, but the business was closed. We will reattempt up to 3 times. Contact us with any access or delivery instructions',
      'Business closed. Please provide hours',
    ]) expect(classifyWording(wording)).toEqual({ stage: 'failed_attempt', source: 'wording:language' });
    // A scheduled attempt, a sender pickup attempt or a hypothetical absence is not a missed round.
    for (const wording of [
      'Attempted delivery tomorrow', 'Attempted delivery scheduled for tomorrow', 'Delivery will be attempted tomorrow',
      'Pickup attempted', 'Pickup attempted - business closed', 'Attempted pickup, customer not available',
      'If you are not at home, the courier will leave the parcel with a neighbour',
      'If the recipient is not available, the parcel goes to the nearest pickup point',
    ]) expect(wordingStage(wording, 'pending')).not.toBe('failed_attempt');
  });

  it('reads the postal and aggregator labels of first scans, the round and delivery', () => {
    for (const [wording, stage] of [
      ['Posting/Collection', 'accepted'],
      ['Posted', 'accepted'],
      ['Origin Scan', 'accepted'],
      ['The shipment has been received at our Aramex origin office and will continue its journey to the destination country', 'accepted'],
      ['The shipment item has been dropped off after latest drop-off time.', 'accepted'],
      ['Item created', 'registered'],
      ['Item out for physical delivery', 'out_for_delivery'],
      ['Final delivery', 'delivered'],
    ] as const) expect(classifyWording(wording)).toEqual({ stage, source: 'wording:language' });
    for (const wording of ['Final delivery attempt tomorrow', 'Posted to the wrong address']) {
      expect(wordingStage(wording, 'pending')).not.toBe('delivered');
      expect(wordingStage(wording, 'pending')).not.toBe('accepted');
    }
  });

  it('tells a courier on the round from a notice that only mentions the round', () => {
    expect(classifyWording("An Aramex Delivery Champion has the shipment and is expected to reach the customer's doorstep shortly"))
      .toEqual({ stage: 'out_for_delivery', source: 'wording:language' });
    // New instructions with the round still to come, like "Delivery option requested".
    expect(wordingStage('The customer has shared new delivery instructions and the status will be updated once shipment is out for delivery'))
      .toBe('in_transit');
  });

  it('keeps sender pre-advice and labels the carrier has not received at registered', () => {
    for (const wording of [
      'We have received a notification from your shipper that they are preparing an item for you. The tracking information will be updated when the parcel is handed over to PostNord.',
      'Shipper generated a new shipment label, but the shipment has not been handed over to Aramex, yet. Shipment will be updated once collected from shipper and received in Aramex offices',
      'The package data was sent to OnTrac, but we have yet to receive the package from the sender. Tracking will update once it arrives. Please contact the sender for more information',
    ]) expect(classifyWording(wording)).toEqual({ stage: 'registered', source: 'wording:language' });
    // The carrier itself taking the parcel is still acceptance.
    expect(wordingStage('The parcel was handed over to GLS.')).toBe('accepted');
  });

  it('keeps postal storage wording (a parcel waiting for collection) out of exception', () => {
    expect(wordingStage('In giacenza presso l\'ufficio postale')).not.toBe('exception');
    expect(wordingStage('Colis en souffrance au bureau de poste')).not.toBe('exception');
  });

  it('recognizes a parcel waiting at a pickup point in the wording carriers actually use', () => {
    for (const wording of [
      'Votre colis vous attend dans votre point de retrait. Le délai de retrait est de 5 jours.',
      'Colis mis à disposition au point de retrait',
      'Le message de mise à disposition en point relais a été reçu par le destinataire.',
      '5 jours restants pour retirer le colis en Locker',
      'Delivered to an access point location and awaiting customer pickup.',
    ]) expect(classifyWording(wording)).toEqual({ stage: 'ready_for_pickup', source: 'wording:language' });
    // Travelling to the pickup point, or handed back to the seller, is not availability.
    expect(wordingStage('Colis en cours de livraison au point de retrait')).toBe('in_transit');
    expect(wordingStage('Colis mis à disposition du vendeur suite à un retour')).toBe('returned');
  });

  it('reads French missed attempts, same-day delivery notices and mailbox deliveries', () => {
    expect(wordingStage('Nous sommes passés mais nous n\'avons pu vous remettre votre colis. Il va être acheminé vers votre point de retrait.')).toBe('failed_attempt');
    expect(wordingStage('Votre envoi n\'a pas pu être distribué ce jour.')).toBe('failed_attempt');
    expect(wordingStage('Le destinataire est informé par SMS de la livraison de son colis ce jour')).toBe('out_for_delivery');
    expect(wordingStage('Le destinataire est informé par e-mail de la livraison de son colis ce jour')).toBe('out_for_delivery');
    expect(wordingStage('Votre envoi a été distribué dans la boîte à lettres.')).toBe('delivered');
    // An announced distribution is not a delivery.
    expect(wordingStage('Votre envoi sera distribué dans la journée.')).toBe('in_transit');
    expect(wordingStage('Votre colis va être distribué à votre adresse.')).toBe('in_transit');
    expect(wordingStage('Instruction de livraison reçue')).toBe('in_transit');
    expect(wordingStage('Colis expédié depuis le site logistique')).toBe('in_transit');
  });

  it('separates customs formalities in progress from their completion', () => {
    expect(wordingStage('Les formalités import/export sont en cours sur votre colis.')).toBe('customs');
    expect(wordingStage('Les formalités import/export de votre colis sont terminées et il poursuit son acheminement.')).toBe('in_transit');
    expect(wordingStage('Import customs clearance started')).toBe('customs');
    for (const wording of ['Import customs clearance complete', 'Export clearance success', 'Leaving customs', 'Departed from customs']) {
      expect(wordingStage(wording)).toBe('in_transit');
    }
  });

  it('reads verb-first clearance as completed and keeps negated or pending clearance in customs', () => {
    for (const wording of [
      'Your parcel cleared customs successfully', 'Cleared customs', 'Shipment cleared by customs',
      'The parcel has been cleared through customs',
    ]) {
      expect(classifyWording(wording)).toEqual({ stage: 'in_transit', source: 'wording:language' });
    }
    for (const wording of [
      'The parcel has not cleared customs yet', 'Parcel has not yet been cleared through customs',
      "Shipment hasn't cleared customs", 'Your parcel will be cleared through customs',
      'Parcel is being cleared by customs',
    ]) {
      expect(wordingStage(wording)).toBe('customs');
    }
  });

  it('maps sender drop-off and carrier pickup scans to accepted', () => {
    for (const wording of [
      'Drop-Off', 'Pickup Scan', 'Pick-up scan',
      'The UPS Access Point™ location has prepared the package for return to UPS or pickup by UPS.',
    ]) expect(classifyWording(wording)).toEqual({ stage: 'accepted', source: 'wording:language' });
    // Recipient-side pickup wording must not be read as the carrier accepting the parcel.
    expect(wordingStage('Ready for pickup')).toBe('ready_for_pickup');
    expect(wordingStage('Drop-off point closed, delivery attempt failed')).toBe('failed_attempt');
    // Only the bare scan label is the sender's hand-in; a parcel left at the recipient's pickup shop is not.
    expect(wordingStage('Your parcel has been dropped off at your chosen pickup shop')).not.toBe('accepted');
  });

  it('maps facility scans, handovers and notices that carry no milestone of their own', () => {
    for (const wording of [
      'At local carrier facility', 'Left origin facility', 'Parcel is leaving airport', 'Item Dispatched', 'Delay',
      'Received by local delivery company', 'Received by logistics company', 'Delivery option requested',
      'The notification for delivery has been sent to the recipient',
      'Item handed over to delivery partner', 'Item distributed', 'The shipment item has been loaded.',
      'Your package has been loaded onto a vehicle',
    ]) expect(classifyWording(wording)).toEqual({ stage: 'in_transit', source: 'wording:language' });
    expect(wordingStage('On vehicle for delivery')).toBe('out_for_delivery');
    expect(wordingStage('On FedEx vehicle for delivery')).toBe('out_for_delivery');
    expect(wordingStage('Loaded onto the delivery vehicle')).toBe('out_for_delivery');
    expect(wordingStage('Delivery successful.')).toBe('delivered');
    expect(wordingStage('Delivery complete. Recipient : () Result : Delivery complete')).toBe('delivered');
    expect(wordingStage('Delivery completion expected tomorrow', 'pending')).not.toBe('delivered');
    expect(wordingStage('Parcel Data Received')).toBe('registered');
    expect(wordingStage('Shipment information sent to FedEx')).toBe('registered');
    // A parcel left with the recipient is a delivery, not a departure.
    expect(wordingStage('Delivered, left at front door')).toBe('delivered');
  });

  it('reads the Spanish and Portuguese labels carriers send', () => {
    // Labels from the carrier vocabularies (statuses.json) and TIPSA's history on ParcelsApp.
    for (const [wording, stage] of [
      ['ENTREGADO', 'delivered'],
      ['EL ENVÍO HA SIDO ENTREGADO A UN VECINO.', 'delivered'],
      ['Entregue', 'delivered'],
      ['Objeto entregue ao destinatário', 'delivered'],
      ['REPARTO', 'out_for_delivery'],
      ['EL ENVÍO ESTÁ EN REPARTO.', 'out_for_delivery'],
      ['En proceso de entrega a domicilio', 'out_for_delivery'],
      ['Objeto saiu para entrega ao destinatário', 'out_for_delivery'],
      ['Ausente', 'failed_attempt'],
      ['Intento de entrega. Ausente', 'failed_attempt'],
      ['Realizado intento de entrega', 'failed_attempt'],
      ['Disponible en punto NACEX', 'ready_for_pickup'],
      ['Disponible en Punto Collectt Express', 'ready_for_pickup'],
      ['DEVUELTO', 'returned'],
      ['En devolución', 'exception'],
      ['LECTURA EN AGENCIA DESTINO [location]', 'in_transit'],
      ['LEIDO EN DESTINO', 'in_transit'],
      ['Clasificado', 'in_transit'],
      ['Alta en la unidad de reparto', 'in_transit'],
      ['EN RUTA A LOCALIDAD DE DESTINO', 'in_transit'],
      ['Objeto em transferência - por favor aguarde', 'in_transit'],
      ['Saída do Centro Internacional', 'in_transit'],
      ['PENDIENTE DE ENTREGAR A TIPSA', 'registered'],
      ['Pendiente de recepción en CTT Express', 'registered'],
    ] as const) expect(classifyWording(wording)).toEqual({ stage, source: 'wording:language' });
    // Carriers disagree on a new round, and a failed pickup or a cancelled round is
    // not a missed delivery: the carrier maps decide these.
    for (const wording of ['NUEVO REPARTO', 'Recogida fallida', 'Saída para entrega cancelada']) {
      expect(trackingLanguageStage(wording)).toBeUndefined();
    }
  });

  it('keeps Spanish and Portuguese negations, handoffs, returns and forecasts apart from delivery', () => {
    for (const [wording, stage] of [
      ['No entregado', 'failed_attempt'],
      ['No se ha podido entregar', 'failed_attempt'],
      ['Não entregue', 'failed_attempt'],
      ['Não foi possível efetuar a entrega', 'failed_attempt'],
      ['Objeto não entregue - carteiro não atendido', 'failed_attempt'],
      ['Estabelecimento fechado', 'failed_attempt'],
      ['Em distribuição', 'out_for_delivery'],
      ['Está a ser entregue', 'out_for_delivery'],
      ['Chegada ao centro de distribuição', 'in_transit'],
      ['Entregado al transportista', 'in_transit'],
      ['Entregue à transportadora', 'in_transit'],
      ['Entregado en el punto de recogida', 'ready_for_pickup'],
      ['Entregue no cacifo', 'ready_for_pickup'],
      ['Disponível para levantamento', 'ready_for_pickup'],
      ['Entregado al remitente', 'returned'],
      ['Devolvido ao remetente', 'returned'],
      ['Será devuelto al remitente', 'exception'],
      ['O envio está a ser devolvido ao remetente', 'exception'],
      ['Não foi devolvido', 'exception'],
      ['Será entregado mañana', 'registered'],
      ['Será entregue amanhã', 'registered'],
      ['Pendiente de entrega', 'in_transit'],
      ['Estará disponible para recoger mañana', 'in_transit'],
    ] as const) expect(classifyWording(wording)).toEqual({ stage, source: 'wording:language' });
    // A condition, a scheduled attempt, a sender pickup or a delivery still to come.
    for (const wording of [
      'Si el destinatario está ausente, el paquete irá al punto de recogida',
      'Em caso de ausência, o envio fica no ponto de recolha',
      'Intento de entrega programado para mañana',
      'Intento de recogida, cliente ausente',
      'Recibirás un SMS una vez entregado',
      'Quando for entregue, receberá um SMS',
      'Fecha de entrega modificada',
      'No disponible para recoger',
    ]) expect(['delivered', 'failed_attempt', 'ready_for_pickup']).not.toContain(wordingStage(wording, 'pending'));
  });

  it('falls back without a rule id when nothing matches', () => {
    expect(classifyWording('Estado interno 99', 'pending')).toEqual({ stage: 'pending', source: 'none' });
    expect(wordingStage('Estado interno 99')).toBe('in_transit');
  });
});
