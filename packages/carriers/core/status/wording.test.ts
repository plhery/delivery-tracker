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

  it('falls back without a rule id when nothing matches', () => {
    expect(classifyWording('Estado interno 99', 'pending')).toEqual({ stage: 'pending', source: 'none' });
    expect(wordingStage('Estado interno 99')).toBe('in_transit');
  });
});
