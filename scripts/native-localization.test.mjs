import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nativeLocalizationReferences } from './native-localization.mjs';
import { validateLocalizationCatalogs } from './localization-catalog.mjs';

describe('Shared localization catalogs', () => {
  const catalogs = () => Object.fromEntries(['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'].map((locale) => [locale, {
    'passport.stampsEarned': '{{count}} / {{total}}',
    'arrival.tapToOpen': 'Open',
  }]));

  it('requires every platform and language to use the same keys', () => {
    const value = catalogs();
    delete value.fr['arrival.tapToOpen'];
    assert.throws(() => validateLocalizationCatalogs(value), /fr.*arrival.tapToOpen/);
  });

  it('rejects translations that lose interpolation variables', () => {
    const value = catalogs();
    value.de['passport.stampsEarned'] = '{{count}}';
    assert.throws(() => validateLocalizationCatalogs(value), /de.passport.stampsEarned.*variables/);
  });

  it('allows a translation to reorder variables', () => {
    const value = catalogs();
    value.it['passport.stampsEarned'] = '{{total}}: {{count}}';
    assert.doesNotThrow(() => validateLocalizationCatalogs(value));
  });
});

const catalogKeys = ['welcome.title', 'auth.title'];

describe('Native localization references', () => {
  it('ignores literal accessibility identifiers that share a localization prefix', () => {
    const source = `
      Text(localizer.text("welcome.title"))
        .accessibilityIdentifier("welcome.openParcel")
        .accessibilityIdentifier(
          "auth.google"
        )
    `;
    assert.deepEqual([...nativeLocalizationReferences(source, catalogKeys)], ['welcome.title']);
  });

  it('keeps missing translations in labels and accessibility copy', () => {
    const source = `
      Text(localizer.text("welcome.missingTitle"))
        .accessibilityLabel(localizer.text("welcome.missingLabel"))
        .accessibilityHint(localizer.text("welcome.missingHint"))
    `;
    assert.deepEqual([...nativeLocalizationReferences(source, catalogKeys)], [
      'welcome.missingTitle', 'welcome.missingLabel', 'welcome.missingHint',
    ]);
  });

  it('keeps a translation reference even when the same key is also an identifier', () => {
    const source = `
      Button(localizer.text("welcome.openParcel"), action: unwrap)
        .accessibilityIdentifier("welcome.openParcel")
    `;
    assert.deepEqual([...nativeLocalizationReferences(source, catalogKeys)], ['welcome.openParcel']);
  });

  it('checks localization calls inside accessibility identifier expressions', () => {
    const source = '.accessibilityIdentifier(localizer.text("welcome.missingTitle"))';
    assert.deepEqual([...nativeLocalizationReferences(source, catalogKeys)], ['welcome.missingTitle']);
  });

  it('deduplicates references and ignores unrelated Swift string literals', () => {
    const source = `
      Image(systemName: "shippingbox.fill")
      Text(localizer.text("welcome.title"))
        .accessibilityLabel(localizer.text("welcome.title"))
    `;
    assert.deepEqual([...nativeLocalizationReferences(source, catalogKeys)], ['welcome.title']);
  });
});
