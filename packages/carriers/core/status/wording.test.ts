import { describe, expect, it } from 'vitest';
import { classifyWording, wordingStage } from './wording';

describe('classifyWording', () => {
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
    expect(wordingStage('Przesyłka zatrzymana')).toBe('exception');
  });

  it('keeps missed delivery attempts and returns out of exception', () => {
    expect(wordingStage('Delivery attempt, recipient absent')).toBe('failed_attempt');
    expect(wordingStage('Non livré, destinataire absent')).toBe('failed_attempt');
    expect(wordingStage('Retour à l\'expéditeur')).toBe('returned');
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
    ]) expect(classifyWording(wording)).toEqual({ stage: 'in_transit', source: 'wording:language' });
    expect(wordingStage('On vehicle for delivery')).toBe('out_for_delivery');
    expect(wordingStage('On FedEx vehicle for delivery')).toBe('out_for_delivery');
    expect(wordingStage('Delivery successful.')).toBe('delivered');
    expect(wordingStage('Parcel Data Received')).toBe('registered');
    expect(wordingStage('Shipment information sent to FedEx')).toBe('registered');
    // A parcel left with the recipient is a delivery, not a departure.
    expect(wordingStage('Delivered, left at front door')).toBe('delivered');
  });

  it('falls back without a rule id when nothing matches', () => {
    expect(classifyWording('Estado interno 99', 'pending')).toEqual({ stage: 'pending', source: 'none' });
    expect(wordingStage('Estado interno 99')).toBe('in_transit');
  });
});
