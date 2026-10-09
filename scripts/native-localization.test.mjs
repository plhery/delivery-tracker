import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { infoPlistStrings, nativeLocalizationReferences, nativeSwiftSources } from './native-localization.mjs';
import { locales, validateLocalizationCatalogs } from './localization-catalog.mjs';

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

  it('keeps French punctuation from starting a line', () => {
    const value = catalogs();
    value.fr['arrival.tapToOpen'] = 'Ouvrir ?';
    assert.throws(() => validateLocalizationCatalogs(value), /fr.arrival.tapToOpen.*no-break space/);
    value.fr['arrival.tapToOpen'] = '« Ouvrir » ?';
    assert.throws(() => validateLocalizationCatalogs(value), /fr.arrival.tapToOpen/);
    value.fr['arrival.tapToOpen'] = '«\u00a0Ouvrir\u00a0»\u202f?';
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

  it('checks the Share extension copy along with the app and the widget', () => {
    const keys = ['shareExtension.title', 'common.cancel', 'native.done', 'widget.galleryName'];
    const references = nativeLocalizationReferences(nativeSwiftSources(fileURLToPath(new URL('../ios', import.meta.url))), keys);
    for (const key of ['shareExtension.title', 'shareExtension.notFound', 'common.cancel', 'native.done', 'widget.galleryName']) {
      assert.ok(references.has(key), key);
    }
  });
});

describe('Localized Info.plist strings', () => {
  const catalogs = () => Object.fromEntries(locales.map((locale) => [locale, {
    'native.cameraUsage': `Camera ${locale}`,
    'shareExtension.title': `Add to Peek ${locale}`,
  }]));

  it('writes one InfoPlist.strings per target and language', () => {
    const files = infoPlistStrings(catalogs());
    assert.deepEqual(files.map(([file]) => file), [
      ...locales.map((locale) => `PeekDeliveryTracker/Resources/${locale}.lproj/InfoPlist.strings`),
      ...locales.map((locale) => `ShareExtension/${locale}.lproj/InfoPlist.strings`),
    ]);
    assert.match(files[1][1], /^"NSCameraUsageDescription" = "Camera de";$/m);
    assert.match(files.at(-1)[1], /^"CFBundleDisplayName" = "Add to Peek pl";$/m);
  });

  it('names each lproj after a project region and ships it in both targets', () => {
    const project = fs.readFileSync(new URL('../ios/PeekDeliveryTracker.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
    const regions = project.match(/knownRegions = \(([^)]*)\)/)[1].split(',').map((region) => region.trim());
    for (const locale of locales) {
      assert.ok(regions.includes(locale), locale);
      assert.equal(project.split(`path = ${locale}.lproj/InfoPlist.strings;`).length - 1, 2, locale);
    }
  });

  it('escapes quotes, backslashes and line breaks', () => {
    const value = catalogs();
    value.fr['shareExtension.title'] = 'Say "hi" \\ then\nadd';
    const [, contents] = infoPlistStrings(value).find(([file]) => file === 'ShareExtension/fr.lproj/InfoPlist.strings');
    assert.match(contents, /^"CFBundleDisplayName" = "Say \\"hi\\" \\\\ then\\nadd";$/m);
  });

  it('fails when a language lacks the copy', () => {
    const value = catalogs();
    delete value.pl['native.cameraUsage'];
    assert.throws(() => infoPlistStrings(value), /pl\.native\.cameraUsage/);
  });
});
