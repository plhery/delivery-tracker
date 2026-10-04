import { describe, expect, it } from 'vitest';
import de from '../../shared/locales/de.json';
import en from '../../shared/locales/en.json';
import { jsonForScript, landingStructuredData } from './landingStructuredData';

describe('landingStructuredData', () => {
  const data = landingStructuredData({ origin: new URL('https://peek.example.test'), url: 'https://peek.example.test/', locale: 'en' });

  it('names the site, with the names people search for taken from its host', () => {
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@graph'][0]).toEqual({
      '@type': 'WebSite',
      name: 'Peek',
      alternateName: ['Peek Tracker', 'peek.example.test'],
      url: 'https://peek.example.test/',
      inLanguage: ['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'],
    });
    const local = landingStructuredData({ origin: new URL('http://127.0.0.1:3000'), url: 'http://127.0.0.1:3000/', locale: 'en' });
    expect(local['@graph'][0].alternateName).toEqual(['Peek Tracker', '127.0.0.1']);
  });

  it('describes the app with the page’s own words, free of charge, and claims nothing else', () => {
    expect(data['@graph'][1]).toEqual({
      '@type': 'WebApplication',
      name: 'Peek',
      alternateName: 'Peek — Universal Parcel Tracker',
      url: 'https://peek.example.test/',
      description: en['preview.landing.description'],
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Web, iOS',
      inLanguage: 'en',
      isAccessibleForFree: true,
    });
    const german = landingStructuredData({ origin: new URL('https://peek.example.test'), url: 'https://peek.example.test/de', locale: 'de' });
    expect(german['@graph'][1]).toMatchObject({ url: 'https://peek.example.test/de', inLanguage: 'de', description: de['preview.landing.description'] });
    // Two things are told, and nothing about what others think of them.
    expect(data['@graph']).toHaveLength(2);
  });
});

describe('jsonForScript', () => {
  it('writes JSON that reads back the same and cannot end its element', () => {
    const value = { text: '</script><script>alert(1)</script><!-- & -->', nested: ['a<b', 'c>d', 'e&f', 'Où est mon colis ?'] };
    const written = jsonForScript(value);
    expect(written).not.toMatch(/[<>&]/);
    expect(written).toContain('\\u003c/script\\u003e');
    expect(JSON.parse(written)).toEqual(value);
  });
});
