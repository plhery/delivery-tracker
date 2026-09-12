import { describe, expect, it } from 'vitest';
import { clean, cleanScalar, escapeRegExp, textFromHtml } from './text';

describe('text helpers', () => {
  it('collapses whitespace and caps length', () => {
    expect(clean('  Livré   au\n destinataire ')).toBe('Livré au destinataire');
    expect(clean('x'.repeat(600)).length).toBe(500);
    expect(clean(12)).toBe('');
    expect(cleanScalar(12)).toBe('12');
  });

  it('escapes regular expression metacharacters', () => {
    expect(new RegExp(escapeRegExp('a.b*c')).test('a.b*c')).toBe(true);
    expect(new RegExp(escapeRegExp('a.b*c')).test('aXbbbc')).toBe(false);
  });

  it('extracts readable text from short HTML fragments', () => {
    expect(textFromHtml('<b>Delivered</b>&nbsp;to <i>neighbour</i>')).toBe('Delivered to neighbour');
    expect(textFromHtml(null)).toBe('');
  });
});
