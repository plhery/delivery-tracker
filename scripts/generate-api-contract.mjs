/*
 * The carrier folders are the source of truth. Everything else is generated
 * from them, and the merge only ever flows in this direction:
 *
 *   packages/carriers/carriers/<id>/carrier.json   (hand-edited)
 *     -> contracts/openapi.json    x-carriers, components.schemas.CarrierId.enum
 *          -> src/generated/apiContract.ts
 *          -> ios/SwissDeliveryTracker/GeneratedAPIContract.swift
 *          -> packages/carriers/generated/catalog.ts
 *
 * Editing x-carriers in contracts/openapi.json by hand is pointless: the next
 * run overwrites it from the folders. Everything else in the OpenAPI document
 * (paths, schemas, examples) is still hand-written, so the merge splices the
 * two generated members into the existing text instead of re-serializing the
 * whole document.
 *
 * `--check` regenerates in memory and fails when any of the four artifacts is
 * out of date, or when the folders and the contract disagree about which
 * carriers exist.
 */

import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv from 'ajv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = path.join(root, 'contracts', 'openapi.json');
const carriersPath = path.join(root, 'packages', 'carriers', 'carriers');
const carrierSchemaPath = path.join(root, 'packages', 'carriers', 'core', 'catalog', 'carrier.schema.json');
const typesPath = path.join(root, 'src', 'generated', 'apiContract.ts');
const swiftPath = path.join(root, 'ios', 'SwissDeliveryTracker', 'GeneratedAPIContract.swift');
const catalogPath = path.join(root, 'packages', 'carriers', 'generated', 'catalog.ts');

const contractSource = await readFile(contractPath, 'utf8');
const contract = JSON.parse(contractSource);
const schemas = contract.components?.schemas;

if (contract.openapi !== '3.1.0' || !schemas || !contract['x-carriers']) {
  throw new Error(
    'contracts/openapi.json must be an OpenAPI 3.1 document with schemas and x-carriers',
  );
}
if (!Array.isArray(schemas.CarrierId?.enum)) throw new Error('CarrierId must define an enum');

// What the contract says today. The merge below only uses it to keep the
// existing carrier and key order, so the diff stays about real changes.
const publishedCarriers = contract['x-carriers'];
const publishedCarrierIds = schemas.CarrierId.enum;

// ---------------------------------------------------------------------------
// Carrier folders
// ---------------------------------------------------------------------------

/** Reads every packages/carriers/carriers/<id>/carrier.json, in folder order. */
async function readCarrierDocuments() {
  const entries = await readdir(carriersPath, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const documents = [];
  for (const folder of folders) {
    const file = path.join(carriersPath, folder, 'carrier.json');
    const source = await readFile(file, 'utf8').catch(() => null);
    if (source === null) {
      throw new Error(
        `packages/carriers/carriers/${folder} has no carrier.json. `
        + 'Every carrier folder must define one; use npm run carrier:new to scaffold it.',
      );
    }
    let document;
    try {
      document = JSON.parse(source);
    } catch (cause) {
      throw new Error(`packages/carriers/carriers/${folder}/carrier.json is not valid JSON: ${cause.message}`);
    }
    if (document.id !== folder) {
      throw new Error(
        `packages/carriers/carriers/${folder}/carrier.json declares id ${JSON.stringify(document.id)}; `
        + 'the id must equal the folder name.',
      );
    }
    documents.push(document);
  }
  return documents;
}

/**
 * Folders that ship their own `adapter.ts`. An automatic carrier either runs a
 * universal provider or names one of these folders — its own, or the folder
 * whose adapter serves it (chronopost -> la-poste, quickpac -> planzer). There
 * is no free-text adapter name any more: a typo must fail the generator rather
 * than reach the registry.
 */
async function readAdapterFolders() {
  const entries = await readdir(carriersPath, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const withAdapter = new Set();
  for (const folder of folders) {
    const found = await access(path.join(carriersPath, folder, 'adapter.ts'))
      .then(() => true, () => false);
    if (found) withAdapter.add(folder);
  }
  return withAdapter;
}

const carrierInputValidators = {
  trackingUrl: new Set(['planzerSharedUrl', 'dachserCapabilityUrl']),
  dpdPostcode: new Set([
    'swissPostcode',
    'francePostcode',
    'swissOrFrancePostcode',
    'paackPostcode',
  ]),
};

/** Structural validation: the shape is owned by core/catalog/carrier.schema.json. */
async function validateCarrierSchema(documents) {
  const schema = JSON.parse(await readFile(carrierSchemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
  const validate = ajv.compile(schema);
  for (const carrier of documents) {
    if (!validate(carrier)) {
      const details = validate.errors
        .map((error) => `${error.instancePath || '/'} ${error.message}`)
        .join('; ');
      throw new Error(`packages/carriers/carriers/${carrier.id}/carrier.json is invalid: ${details}`);
    }
  }
}

/** Checks the schema cannot express: adapter/mode agreement, canary URLs, regexes. */
function validateCarrierSemantics(carrier, adapterFolders) {
  const where = `packages/carriers/carriers/${carrier.id}/carrier.json`;
  const { tracking, portal } = carrier;
  if (
    (tracking.mode === 'automatic' && typeof tracking.adapter !== 'string')
    || (tracking.mode === 'link-only' && tracking.adapter !== null)
  ) {
    throw new Error(`${where} has an invalid tracking adapter`);
  }
  if (
    tracking.mode === 'automatic'
    && tracking.adapter !== 'universal'
    && !adapterFolders.has(tracking.adapter)
  ) {
    throw new Error(
      `${where} names tracking.adapter ${JSON.stringify(tracking.adapter)}, which is neither `
      + '"universal" nor a carrier folder containing adapter.ts.',
    );
  }
  if (tracking.mode === 'automatic') {
    let canaryUrl;
    try {
      canaryUrl = new URL(portal.canaryUrl);
    } catch {
      throw new Error(`${where} must define a valid portal.canaryUrl`);
    }
    if (
      canaryUrl.protocol !== 'https:'
      || canaryUrl.username
      || canaryUrl.password
      || canaryUrl.search
      || canaryUrl.hash
    ) {
      throw new Error(`${where} must define a public HTTPS portal.canaryUrl`);
    }
  }
  const fields = new Set();
  for (const requirement of tracking.requirements ?? []) {
    const validators = carrierInputValidators[requirement.field];
    if (!validators || fields.has(requirement.field) || !validators.has(requirement.validator)) {
      throw new Error(`${where} has an invalid input requirement`);
    }
    fields.add(requirement.field);
    if (requirement.whenTrackingNumber) new RegExp(requirement.whenTrackingNumber);
    if (requirement.pattern) new RegExp(requirement.pattern);
  }
  for (const rule of carrier.detection) {
    new RegExp(rule.pattern);
  }
  for (const rule of carrier.links) {
    for (const field of ['path', 'pathPattern', 'fragment']) {
      if (rule[field] !== undefined) new RegExp(rule[field], 'i');
    }
  }
}

/** Detection rule ids are referenced by the sweep and the collision file. */
function validateDetectionRuleIds(documents) {
  const owners = new Map();
  for (const carrier of documents) {
    for (const rule of carrier.detection) {
      const owner = owners.get(rule.id);
      if (owner) {
        throw new Error(`Detection rule id ${rule.id} is used by both ${owner} and ${carrier.id}`);
      }
      owners.set(rule.id, carrier.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Folders -> x-carriers
// ---------------------------------------------------------------------------

// Key order used for carriers the contract does not describe yet. Existing
// entries keep the order contracts/openapi.json already uses (see
// orderedContractEntry), so adopting the folders as the source of truth does
// not reshuffle a hundred entries in the diff.
const contractKeyOrder = [
  'displayName',
  'displayNames',
  'color',
  'selectable',
  'timezone',
  'tracking',
  'canaryUrl',
  'trackingUrlTemplate',
  'trackingSiteName',
  'linkRules',
  'detectionRules',
];

function contractDetectionRule(rule) {
  // `id` stays a folder-side concept: the published contract keeps the old shape.
  const contractRule = { pattern: rule.pattern, confidence: rule.confidence };
  if (rule.checksum !== undefined) contractRule.checksum = rule.checksum;
  return contractRule;
}

function contractTracking(tracking) {
  const contractValue = { mode: tracking.mode, adapter: tracking.adapter };
  if (tracking.upstreamName !== undefined) contractValue.upstreamName = tracking.upstreamName;
  if (tracking.requirements !== undefined) contractValue.requirements = tracking.requirements;
  return contractValue;
}

/** Projects one carrier.json onto the published x-carriers entry shape. */
function contractEntry(carrier) {
  const entry = { displayName: carrier.displayName };
  if (carrier.displayNames !== undefined) entry.displayNames = carrier.displayNames;
  entry.color = carrier.brand.color;
  entry.selectable = carrier.selectable;
  entry.timezone = carrier.timezone;
  entry.tracking = contractTracking(carrier.tracking);
  if (carrier.portal.canaryUrl !== undefined) entry.canaryUrl = carrier.portal.canaryUrl;
  if (carrier.portal.url !== undefined) entry.trackingUrlTemplate = carrier.portal.url;
  if (carrier.portal.siteName !== undefined) entry.trackingSiteName = carrier.portal.siteName;
  entry.linkRules = carrier.links;
  entry.detectionRules = carrier.detection.map(contractDetectionRule);
  return entry;
}

function orderedContractEntry(entry, current) {
  const order = [...Object.keys(current ?? {}), ...contractKeyOrder, ...Object.keys(entry)];
  const ordered = {};
  for (const key of order) {
    if (key in entry && !(key in ordered)) ordered[key] = entry[key];
  }
  return ordered;
}

/** Keeps the order the contract already uses; new carriers are appended. */
function orderedCarrierIds(ids, current) {
  const known = new Set(ids);
  const kept = current.filter((id) => known.has(id));
  const seen = new Set(kept);
  return [...kept, ...ids.filter((id) => !seen.has(id))];
}

function mergeContractCarriers(documents) {
  const entries = new Map(documents.map((carrier) => [carrier.id, contractEntry(carrier)]));
  const merged = {};
  for (const id of orderedCarrierIds([...entries.keys()], Object.keys(publishedCarriers))) {
    merged[id] = orderedContractEntry(entries.get(id), publishedCarriers[id]);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// x-carriers -> contracts/openapi.json (textual splice, see the header comment)
// ---------------------------------------------------------------------------

/** End index of the JSON object or array starting at `start`. */
function endOfJsonValue(source, start) {
  const opening = source[start];
  const closing = opening === '{' ? '}' : opening === '[' ? ']' : null;
  if (!closing) throw new Error('Only object and array members can be spliced into the contract');
  let depth = 0;
  let inString = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (character === '\\') index += 1;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === opening) depth += 1;
    else if (character === closing) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error('contracts/openapi.json ends inside a value');
}

/** Start index of the value of `"<key>": ` written at exactly `indent` spaces. */
function memberValueStart(source, indent, key, from = 0, to = source.length) {
  const marker = `\n${' '.repeat(indent)}${JSON.stringify(key)}: `;
  const region = source.slice(from, to);
  const found = region.indexOf(marker);
  if (found === -1) {
    throw new Error(`contracts/openapi.json has no ${key} member indented by ${indent} spaces`);
  }
  if (region.indexOf(marker, found + 1) !== -1) {
    throw new Error(`contracts/openapi.json has several ${key} members indented by ${indent} spaces`);
  }
  return from + found + marker.length;
}

function renderContractMember(value, indent) {
  return JSON.stringify(value, null, 2).split('\n').join(`\n${' '.repeat(indent)}`);
}

function replaceContractMember(source, start, value, indent) {
  return source.slice(0, start) + renderContractMember(value, indent) + source.slice(endOfJsonValue(source, start));
}

/**
 * Rewrites only x-carriers and components.schemas.CarrierId.enum. Splicing text
 * keeps the rest of the hand-written document (and its formatting) untouched.
 */
function generatedContract(source, carriers, carrierIds) {
  const withCarriers = replaceContractMember(source, memberValueStart(source, 2, 'x-carriers'), carriers, 2);
  const carrierIdStart = memberValueStart(withCarriers, 6, 'CarrierId');
  const carrierIdEnd = endOfJsonValue(withCarriers, carrierIdStart);
  const enumStart = memberValueStart(withCarriers, 8, 'enum', carrierIdStart, carrierIdEnd);
  return replaceContractMember(withCarriers, enumStart, carrierIds, 8);
}

// ---------------------------------------------------------------------------
// Contract-wide checks (unchanged)
// ---------------------------------------------------------------------------

function resolvePointer(reference) {
  if (!reference.startsWith('#/')) throw new Error(`Only local references are supported: ${reference}`);
  let current = contract;
  for (const rawSegment of reference.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    current = current?.[segment];
    if (current === undefined) throw new Error(`Unresolved contract reference: ${reference}`);
  }
  return current;
}

function validateReferences(value) {
  if (Array.isArray(value)) {
    value.forEach(validateReferences);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string') resolvePointer(value.$ref);
  Object.values(value).forEach(validateReferences);
}

function validateOperations() {
  const operationIds = new Set();
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
  for (const [route, pathItem] of Object.entries(contract.paths ?? {})) {
    if (!route.startsWith('/')) throw new Error(`Invalid API path: ${route}`);
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method)) continue;
      if (!operation.operationId || operationIds.has(operation.operationId)) {
        throw new Error(`Missing or duplicate operationId for ${method.toUpperCase()} ${route}`);
      }
      if (!operation.responses || Object.keys(operation.responses).length === 0) {
        throw new Error(`Missing responses for ${method.toUpperCase()} ${route}`);
      }
      operationIds.add(operation.operationId);
    }
  }
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

const carrierDocuments = await readCarrierDocuments();
await validateCarrierSchema(carrierDocuments);
const adapterFolders = await readAdapterFolders();
carrierDocuments.forEach((carrier) => validateCarrierSemantics(carrier, adapterFolders));
validateDetectionRuleIds(carrierDocuments);

const carrierCapabilities = mergeContractCarriers(carrierDocuments);
const carrierIds = orderedCarrierIds(
  carrierDocuments.map((carrier) => carrier.id),
  publishedCarrierIds,
);
if (
  carrierIds.length !== Object.keys(carrierCapabilities).length
  || carrierIds.some((carrierId) => !Object.hasOwn(carrierCapabilities, carrierId))
) {
  throw new Error('x-carriers must define every CarrierId exactly once');
}

// Everything downstream reads the merged document, not the file on disk.
contract['x-carriers'] = carrierCapabilities;
schemas.CarrierId.enum = carrierIds;

validateReferences(contract);
validateOperations();

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

const enumConstants = {
  CarrierId: 'CARRIER_IDS',
  Stage: 'STAGES',
  SyncStatus: 'SYNC_STATUSES',
};

const swiftSchemaNames = {
  CarrierId: 'CarrierID',
  Stage: 'TrackingStage',
  TrackingEventRow: 'TrackingEvent',
  PackageRow: 'Parcel',
  OkResponse: 'OKResponse',
};

const swiftInlineNames = {
  'AccountExportResponse.account': 'AccountExportAccount',
  'PackageRow.carrier_data': 'CarrierData',
  'NativePushDeviceRequest.environment': 'NativePushEnvironment',
  'NativePushDeviceRequest.locale': 'NativePushLocale',
};

const swiftEnumCaseNames = {
  'CarrierId.intl-post': 'internationalPost',
  'CarrierId.spring-gds': 'springGDS',
};

function refName(ref) {
  const prefix = '#/components/schemas/';
  if (!ref.startsWith(prefix)) throw new Error(`Unsupported schema reference: ${ref}`);
  return `Api${ref.slice(prefix.length)}`;
}

function typeScriptType(schema) {
  if (schema.$ref) return refName(schema.$ref);
  if (schema.anyOf) return schema.anyOf.map(typeScriptType).join(' | ');
  if (schema.oneOf) return schema.oneOf.map(typeScriptType).join(' | ');
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (Array.isArray(schema.type)) {
    return schema.type
      .map((type) => typeScriptType({ ...schema, type }))
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(' | ');
  }
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return `Array<${typeScriptType(schema.items ?? {})}>`;
    case 'object': {
      const entries = Object.entries(schema.properties ?? {});
      if (entries.length === 0) return 'Record<string, unknown>';
      const required = new Set(schema.required ?? []);
      const fields = entries.map(
        ([name, property]) =>
          `  ${JSON.stringify(name)}${required.has(name) ? '' : '?'}: ${typeScriptType(property)};`,
      );
      return `{\n${fields.join('\n')}\n}`;
    }
    default:
      return 'unknown';
  }
}

function generatedTypeScript() {
  const lines = [
    '/* This file is generated by scripts/generate-api-contract.mjs. Do not edit. */',
    '',
    `export const CARRIER_CAPABILITIES = ${JSON.stringify(carrierCapabilities, null, 2)} as const;`,
    '',
  ];
  for (const [name, schema] of Object.entries(schemas)) {
    const constant = enumConstants[name];
    if (constant) {
      lines.push(`export const ${constant} = ${JSON.stringify(schema.enum, null, 2)} as const;`);
      lines.push(`export type Api${name} = (typeof ${constant})[number];`, '');
      continue;
    }
    if (schema.type === 'object' && schema.properties) {
      const required = new Set(schema.required ?? []);
      lines.push(`export interface Api${name} {`);
      for (const [propertyName, property] of Object.entries(schema.properties)) {
        lines.push(
          `  ${JSON.stringify(propertyName)}${required.has(propertyName) ? '' : '?'}: ${typeScriptType(property)};`,
        );
      }
      lines.push('}', '');
      continue;
    }
    lines.push(`export type Api${name} = ${typeScriptType(schema)};`, '');
  }
  return `${lines.join('\n').trim()}\n`;
}

/**
 * The carrier package consumes the merged catalog directly, without importing
 * application code: same data, package-local names.
 */
function generatedCarrierCatalog() {
  const stages = schemas.Stage?.enum;
  if (!Array.isArray(stages)) throw new Error('Stage must define an enum');
  return `${[
    '/* This file is generated by scripts/generate-api-contract.mjs. Do not edit. */',
    '',
    `export const CARRIER_CATALOG = ${JSON.stringify(carrierCapabilities, null, 2)} as const;`,
    '',
    `export const CARRIER_IDS = ${JSON.stringify(carrierIds, null, 2)} as const;`,
    'export type CarrierId = (typeof CARRIER_IDS)[number];',
    '',
    `export const STAGES = ${JSON.stringify(stages, null, 2)} as const;`,
    'export type Stage = (typeof STAGES)[number];',
  ].join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Swift
// ---------------------------------------------------------------------------

function upperFirst(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function lowerCamelIdentifier(value) {
  const words = value.split(/[-_]/).filter(Boolean);
  if (words.length === 0) throw new Error(`Cannot generate a Swift identifier for ${value}`);
  return words[0] + words.slice(1).map(upperFirst).join('');
}

function swiftPropertyName(value) {
  return lowerCamelIdentifier(value)
    .replace(/Ids$/, 'IDs')
    .replace(/Id$/, 'ID')
    .replace(/Urls$/, 'URLs')
    .replace(/Url$/, 'URL');
}

function swiftTypeName(schemaName) {
  return swiftSchemaNames[schemaName] ?? schemaName;
}

function swiftReferenceName(reference) {
  const prefix = '#/components/schemas/';
  if (!reference.startsWith(prefix)) {
    throw new Error(`Unsupported Swift schema reference: ${reference}`);
  }
  return swiftTypeName(reference.slice(prefix.length));
}

function swiftEnumCase(schemaName, value) {
  return swiftEnumCaseNames[`${schemaName}.${value}`] ?? swiftPropertyName(value);
}

function schemaAllowsNull(schema) {
  if (schema?.type === 'null') return true;
  if (Array.isArray(schema?.type) && schema.type.includes('null')) return true;
  return [...(schema?.anyOf ?? []), ...(schema?.oneOf ?? [])].some(schemaAllowsNull);
}

function schemaWithoutNull(schema) {
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type) => type !== 'null');
    if (types.length !== 1) throw new Error(`Unsupported Swift type union: ${JSON.stringify(schema.type)}`);
    return { ...schema, type: types[0] };
  }
  for (const key of ['anyOf', 'oneOf']) {
    if (schema[key]) {
      const alternatives = schema[key].filter((value) => !schemaAllowsNull(value));
      if (alternatives.length !== 1) {
        throw new Error(`Unsupported Swift ${key} union: ${JSON.stringify(schema[key])}`);
      }
      return alternatives[0];
    }
  }
  return schema;
}

const swiftInlineSchemas = new Map();

function swiftInlineTypeName(parentSchemaName, propertyName) {
  return swiftInlineNames[`${parentSchemaName}.${propertyName}`]
    ?? `${swiftTypeName(parentSchemaName)}${upperFirst(swiftPropertyName(propertyName))}`;
}

function registerSwiftInlineSchema(parentSchemaName, propertyName, schema) {
  const name = swiftInlineTypeName(parentSchemaName, propertyName);
  const existing = swiftInlineSchemas.get(name);
  if (existing && JSON.stringify(existing.schema) !== JSON.stringify(schema)) {
    throw new Error(`Conflicting inline Swift schema name: ${name}`);
  }
  swiftInlineSchemas.set(name, { name, schema, schemaName: `${parentSchemaName}.${propertyName}` });
  return name;
}

function swiftBaseType(schema, parentSchemaName, propertyName) {
  const value = schemaWithoutNull(schema);
  if (value.$ref) return swiftReferenceName(value.$ref);
  if (value.enum) return registerSwiftInlineSchema(parentSchemaName, propertyName, value);
  switch (value.type) {
    case 'string':
      return value.format === 'uuid' ? 'UUID' : 'String';
    case 'integer':
      return 'Int';
    case 'number':
      return 'Double';
    case 'boolean':
      return 'Bool';
    case 'array':
      return `[${swiftBaseType(value.items ?? {}, parentSchemaName, `${propertyName}Item`)}]`;
    case 'object':
      if (value.properties) return registerSwiftInlineSchema(parentSchemaName, propertyName, value);
      throw new Error(`Object dictionaries are not supported by the Swift generator: ${parentSchemaName}.${propertyName}`);
    default:
      throw new Error(`Unsupported Swift schema at ${parentSchemaName}.${propertyName}: ${JSON.stringify(value)}`);
  }
}

function swiftProperty(schemaName, propertyName, schema, required) {
  const specialEmptyArray = schemaName === 'PackageRow' && propertyName === 'tracking_events';
  return {
    jsonName: propertyName,
    name: swiftPropertyName(propertyName),
    type: swiftBaseType(schema, schemaName, propertyName),
    optional: !specialEmptyArray && (!required || schemaAllowsNull(schema)),
    specialEmptyArray,
  };
}

function swiftCodingKey(property) {
  const decodedName = lowerCamelIdentifier(property.jsonName);
  return property.name === decodedName
    ? `        case ${property.name}`
    : `        case ${property.name} = ${JSON.stringify(decodedName)}`;
}

function generatedSwiftEnum(schemaName, swiftName, schema) {
  const lines = [
    `enum ${swiftName}: String, Codable, CaseIterable, Hashable, Sendable, Identifiable {`,
  ];
  for (const value of schema.enum) {
    const caseName = swiftEnumCase(schemaName, value);
    lines.push(caseName === value ? `    case ${caseName}` : `    case ${caseName} = ${JSON.stringify(value)}`);
  }
  lines.push('', '    var id: String { rawValue }', '}');
  return lines;
}

function generatedSwiftCarrierIdentifier(schema) {
  const cases = schema.enum.map((value) => ({
    name: swiftEnumCase('CarrierId', value),
    value,
  }));
  const lines = [
    'struct CarrierID: RawRepresentable, Codable, CaseIterable, Hashable, Sendable, Identifiable {',
    '    let rawValue: String',
    '',
    '    init(rawValue: String) {',
    '        self.rawValue = rawValue',
    '    }',
    '',
  ];
  for (const item of cases) {
    lines.push(`    static let ${item.name} = CarrierID(rawValue: ${JSON.stringify(item.value)})`);
  }
  lines.push(
    '',
    '    static let allCases: [CarrierID] = [',
    ...cases.map((item) => `        .${item.name},`),
    '    ]',
    '',
    '    init(from decoder: Decoder) throws {',
    '        let container = try decoder.singleValueContainer()',
    '        rawValue = try container.decode(String.self)',
    '    }',
    '',
    '    func encode(to encoder: Encoder) throws {',
    '        var container = encoder.singleValueContainer()',
    '        try container.encode(rawValue)',
    '    }',
    '',
    '    var id: String { rawValue }',
    '}',
  );
  return lines;
}

function generatedSwiftStruct(schemaName, swiftName, schema) {
  const required = new Set(schema.required ?? []);
  const properties = Object.entries(schema.properties ?? {}).map(([name, value]) =>
    swiftProperty(schemaName, name, value, required.has(name)));
  const conformances = ['Codable', 'Equatable', 'Hashable', 'Sendable'];
  if (properties.some((property) => property.name === 'id')) conformances.push('Identifiable');
  const lines = [`struct ${swiftName}: ${conformances.join(', ')} {`];
  for (const property of properties) {
    const defaultValue = property.specialEmptyArray ? ' = []' : property.optional ? ' = nil' : '';
    lines.push(`    var ${property.name}: ${property.type}${property.optional ? '?' : ''}${defaultValue}`);
  }
  if (properties.some((property) => property.name !== lowerCamelIdentifier(property.jsonName))) {
    lines.push('', '    private enum CodingKeys: String, CodingKey {');
    properties.forEach((property) => lines.push(swiftCodingKey(property)));
    lines.push('    }');
  }
  lines.push('}');
  return { lines, properties };
}

function generatedParcelDecoder(properties) {
  const lines = [
    'extension Parcel {',
    '    init(from decoder: Decoder) throws {',
    '        let values = try decoder.container(keyedBy: CodingKeys.self)',
  ];
  for (const property of properties) {
    if (property.specialEmptyArray) {
      lines.push(
        `        ${property.name} = try values.decodeIfPresent(${property.type}.self, forKey: .${property.name}) ?? []`,
      );
    } else if (property.optional) {
      lines.push(
        `        ${property.name} = try values.decodeIfPresent(${property.type}.self, forKey: .${property.name})`,
      );
    } else {
      lines.push(`        ${property.name} = try values.decode(${property.type}.self, forKey: .${property.name})`);
    }
  }
  lines.push('    }', '}');
  return lines;
}

function generatedSwift() {
  swiftInlineSchemas.clear();
  const lines = [
    '// This file is generated by scripts/generate-api-contract.mjs. Do not edit.',
    '',
    'import Foundation',
    '',
  ];
  let parcelProperties = null;
  for (const [schemaName, schema] of Object.entries(schemas)) {
    const swiftName = swiftTypeName(schemaName);
    if (schema.enum) {
      const generated = schemaName === 'CarrierId'
        ? generatedSwiftCarrierIdentifier(schema)
        : generatedSwiftEnum(schemaName, swiftName, schema);
      lines.push(...generated, '');
    } else if (schema.type === 'object' && schema.properties) {
      const generated = generatedSwiftStruct(schemaName, swiftName, schema);
      lines.push(...generated.lines, '');
      if (schemaName === 'PackageRow') parcelProperties = generated.properties;
    } else {
      throw new Error(`Unsupported top-level Swift schema: ${schemaName}`);
    }
  }
  for (const { name, schema, schemaName } of swiftInlineSchemas.values()) {
    if (schema.enum) {
      lines.push(...generatedSwiftEnum(schemaName, name, schema), '');
    } else {
      lines.push(...generatedSwiftStruct(schemaName, name, schema).lines, '');
    }
  }
  if (!parcelProperties) throw new Error('PackageRow is required to generate the native Parcel model');
  lines.push(...generatedParcelDecoder(parcelProperties), '');
  return `${lines.join('\n').trim()}\n`;
}

// ---------------------------------------------------------------------------
// Write or check
// ---------------------------------------------------------------------------

const outputs = [
  [contractPath, generatedContract(contractSource, carrierCapabilities, carrierIds)],
  [typesPath, generatedTypeScript()],
  [swiftPath, generatedSwift()],
  [catalogPath, generatedCarrierCatalog()],
];

/** Reports folder/contract disagreements before the generic staleness message. */
function describeCarrierDrift() {
  const folderIds = new Set(carrierDocuments.map((carrier) => carrier.id));
  const contractIds = publishedCarrierIds;
  const added = [...folderIds].filter((id) => !contractIds.includes(id));
  const removed = contractIds.filter((id) => !folderIds.has(id));
  const problems = [];
  if (added.length > 0) {
    problems.push(`carrier folders missing from contracts/openapi.json: ${added.sort().join(', ')}`);
  }
  if (removed.length > 0) {
    problems.push(
      `contracts/openapi.json lists carriers with no packages/carriers/carriers/<id>/carrier.json: ${removed.sort().join(', ')}`,
    );
  }
  return problems;
}

if (process.argv.includes('--check')) {
  const drift = describeCarrierDrift();
  if (drift.length > 0) {
    throw new Error(`${drift.join('; ')}. Run npm run contract:generate.`);
  }
  const stale = [];
  for (const [target, expected] of outputs) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== expected) stale.push(path.relative(root, target));
  }
  if (stale.length > 0) {
    throw new Error(
      `Generated API contract files are stale: ${stale.join(', ')}. Run npm run contract:generate.`,
    );
  }
  console.log(`Generated API contract files are current for ${carrierIds.length} carriers.`);
} else {
  for (const [target, contents] of outputs) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
    console.log(`Wrote ${path.relative(root, target)}`);
  }
}
