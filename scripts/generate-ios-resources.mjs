import fs from 'node:fs';
import path from 'node:path';
import { nativeLocalizationReferences } from './native-localization.mjs';
import { readLocalizationCatalogs } from './localization-catalog.mjs';

const root = path.resolve(import.meta.dirname, '..');
const languages = readLocalizationCatalogs(path.join(root, 'shared', 'locales'));

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
  ['Analytics.json', fs.readFileSync(path.join(root, 'shared', 'analytics.json'), 'utf8')],
  ['Localization.json', `${JSON.stringify(languages, null, 2)}\n`],
  ['CarrierCatalog.json', `${JSON.stringify({ 'x-carriers': contract['x-carriers'] }, null, 2)}\n`],
  ['DeliveryDemo.json', fs.readFileSync(path.join(root, 'shared', 'delivery-demo.json'), 'utf8')],
  ['FriendsDemo.json', fs.readFileSync(path.join(root, 'shared', 'friends-demo.json'), 'utf8')],
  ['ContractFixtures.json', `${JSON.stringify(apiFixture, null, 2)}\n`],
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
