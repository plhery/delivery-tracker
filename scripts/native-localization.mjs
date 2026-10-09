import fs from 'node:fs';
import path from 'node:path';

// The app and both extensions take their copy from Localization.json.
const nativeSourceDirectories = ['PeekDeliveryTracker', 'DeliveryWidgetExtension', 'ShareExtension'];

// iOS shows these Info.plist strings before Peek runs, so each target ships them as
// InfoPlist.strings in one lproj per catalog language, named like the project's knownRegions.
const infoPlistCopy = [
  ['PeekDeliveryTracker/Resources', { NSCameraUsageDescription: 'native.cameraUsage' }],
  ['ShareExtension', { CFBundleDisplayName: 'shareExtension.title' }],
];

export function nativeSwiftSources(iosDirectory) {
  return nativeSourceDirectories
    .flatMap((directory) => fs.readdirSync(path.join(iosDirectory, directory))
      .filter((name) => name.endsWith('.swift'))
      .map((name) => fs.readFileSync(path.join(iosDirectory, directory, name), 'utf8')))
    .join('\n');
}

export function nativeLocalizationReferences(swiftSource, localizationKeys) {
  // Accessibility identifiers are stable UI automation hooks, not display copy.
  // Only skip literal arguments so localization calls inside expressions are checked.
  const source = swiftSource.replace(
    /\.\s*accessibilityIdentifier\s*\(\s*"(?:\\.|[^"\\])*"\s*\)/g,
    '',
  );
  const prefixes = new Set(localizationKeys.map((key) => key.split('.')[0]));
  return new Set(
    [...source.matchAll(/"([a-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)"/g)]
      .map((match) => match[1])
      .filter((key) => prefixes.has(key.split('.')[0])),
  );
}

const stringsEscapes = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
const stringsLiteral = (text) => `"${text.replace(/[\\"\n\r\t]/g, (character) => stringsEscapes[character])}"`;

/** Every target's InfoPlist.strings in every language, as [path under ios/, contents]. */
export function infoPlistStrings(catalogs) {
  return infoPlistCopy.flatMap(([directory, keys]) => Object.entries(catalogs).map(([language, catalog]) => {
    const lines = Object.entries(keys).map(([plistKey, key]) => {
      if (typeof catalog[key] !== 'string') throw new Error(`Missing Info.plist translation: ${language}.${key}`);
      return `${stringsLiteral(plistKey)} = ${stringsLiteral(catalog[key])};\n`;
    });
    return [
      `${directory}/${language}.lproj/InfoPlist.strings`,
      `/* Generated from shared/locales by npm run ios:resources. */\n${lines.join('')}`,
    ];
  }));
}
