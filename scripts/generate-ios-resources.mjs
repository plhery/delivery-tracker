import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBrandData, renderBrandJson } from './generate-brand.mjs';
import { nativeLocalizationReferences } from './native-localization.mjs';
import { readLocalizationCatalogs } from './localization-catalog.mjs';

const root = path.resolve(import.meta.dirname, '..');
const languages = readLocalizationCatalogs(path.join(root, 'shared', 'locales'));
const trackingMessagesSource = fs.readFileSync(path.join(root, 'shared', 'tracking-messages.json'), 'utf8');
const trackingMessages = JSON.parse(trackingMessagesSource);
for (const message of Object.values(trackingMessages.events)) {
  const text = languages.en[message.key];
  if (!text) throw new Error(`Missing tracking message translation: ${message.key}`);
  const variables = [...text.matchAll(/\{\{([^}]+)\}\}/g)].map(match => match[1]).sort();
  if (JSON.stringify(variables) !== JSON.stringify(Object.keys(message.variables).sort())) {
    throw new Error(`Invalid tracking message variables: ${message.key}`);
  }
}
for (const key of Object.values(trackingMessages.failures)) {
  if (!languages.en[key]) throw new Error(`Missing tracking failure translation: ${key}`);
}

const swiftSources = ['SwissDeliveryTracker', 'DeliveryWidgetExtension']
  .flatMap((directory) => fs.readdirSync(path.join(root, 'ios', directory))
    .filter((name) => name.endsWith('.swift'))
    .map((name) => fs.readFileSync(path.join(root, 'ios', directory, name), 'utf8')))
  .join('\n');
const referencedKeys = nativeLocalizationReferences(swiftSources, Object.keys(languages.en));
const missingNativeReferences = [...referencedKeys].filter((key) => !(key in languages.en));
if (missingNativeReferences.length) {
  throw new Error(
    `Native localization references are missing from the generated catalog: ${missingNativeReferences.sort().join(', ')}`,
  );
}

const resources = path.join(root, 'ios', 'SwissDeliveryTracker', 'Resources');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'openapi.json'), 'utf8'));
const apiFixture = JSON.parse(fs.readFileSync(
  path.join(root, 'contracts', 'fixtures', 'delivery-api.json'),
  'utf8',
));
const outputs = new Map([
  ['TrackingMessages.json', trackingMessagesSource],
  ['Analytics.json', fs.readFileSync(path.join(root, 'shared', 'analytics.json'), 'utf8')],
  ['Localization.json', `${JSON.stringify(languages, null, 2)}\n`],
  ['CarrierCatalog.json', `${JSON.stringify({ 'x-carriers': contract['x-carriers'] }, null, 2)}\n`],
  // The sample parcels with every language's translation of their text.
  ['DeliveryDemo.json', `${JSON.stringify({
    parcels: JSON.parse(fs.readFileSync(path.join(root, 'shared', 'delivery-demo.json'), 'utf8')),
    translations: Object.fromEntries(Object.keys(languages).filter((language) => language !== 'en').sort().map((language) => [
      language, JSON.parse(fs.readFileSync(path.join(root, 'shared', 'demo-locales', `${language}.json`), 'utf8')),
    ])),
  }, null, 2)}\n`],
  ['FriendsDemo.json', fs.readFileSync(path.join(root, 'shared', 'friends-demo.json'), 'utf8')],
  ['ContractFixtures.json', `${JSON.stringify(apiFixture, null, 2)}\n`],
  // Replayed by the native detection test so the Swift port cannot drift from the shared engine.
  ['DetectionGolden.json', fs.readFileSync(fileURLToPath(import.meta.resolve('universal-parcel-scraper/data/detection-golden.json')), 'utf8')],
  // Read by BrandParityTests so the SwiftUI livery and truck cannot drift from
  // src/brand, which the web renders.
  ['Brand.json', renderBrandJson(readBrandData())],
  // The parcel map draws the same Natural Earth countries as the web map.
  ['World.json', fs.readFileSync(path.join(root, 'src', 'components', 'map', 'world.json'), 'utf8')],
]);

if (process.argv.includes('--check')) {
  const stale = [...outputs].flatMap(([name, expected]) => {
    const target = path.join(resources, name);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    return current === expected ? [] : [path.relative(root, target)];
  });
  if (stale.length) {
    throw new Error(`Generated iOS resources are stale: ${stale.join(', ')}. Run npm run ios:resources.`);
  }
  console.log('Generated iOS resources are current.');
} else {
  fs.mkdirSync(resources, { recursive: true });
  for (const [name, contents] of outputs) {
    fs.writeFileSync(path.join(resources, name), contents);
  }
  console.log(`Generated iOS resources for ${Object.keys(languages).length} languages and ${Object.keys(contract['x-carriers']).length} carriers.`);
}
