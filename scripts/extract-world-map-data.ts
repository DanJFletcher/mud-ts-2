/** One-time ADR 0042 migration. After building the original packs: node --experimental-strip-types scripts/extract-world-map-data.ts */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import {
  WorldLocationsFileSchema,
  WorldLocationGroupsFileSchema,
  WorldRoadsFileSchema,
  WorldPackDraftSchema,
  composeWorldPackDraft,
  type WorldPackDraft,
  type WorldPackContent,
} from '@mudd/contracts';
import { orravethWorld } from '@mudd/world-orraveth';
import { demoWorld } from '@mudd/world-demo';

const layoutFields = new Set(['id', 'name', 'description', 'regionId', 'mapAreaId', 'mapPosition', 'exits']);
const roadLayoutFields = new Set(['id', 'name', 'locationIds']);
const root = new URL('../', import.meta.url);

function splitPack(pack: WorldPackDraft) {
  const { locations, locationGroups, roads, ...rest } = pack;
  const locationContent: WorldPackContent['locationContent'] = {};
  const roadRules: WorldPackContent['roadRules'] = {};
  const map = {
    locations: WorldLocationsFileSchema.parse({
      formatVersion: 1,
      packId: pack.packId,
      locations: locations.map(({ id, name, description, regionId, mapAreaId, mapPosition, exits, ...content }) => {
        locationContent[id] = content;
        return { id, name, description, ...(regionId === undefined ? {} : { regionId }),
          ...(mapAreaId === undefined ? {} : { mapAreaId }),
          ...(mapPosition === undefined ? {} : { mapPosition }), exits };
      }),
    }),
    locationGroups: WorldLocationGroupsFileSchema.parse({ formatVersion: 1, packId: pack.packId, locationGroups }),
    roads: WorldRoadsFileSchema.parse({
      formatVersion: 1,
      packId: pack.packId,
      roads: roads.map(({ id, name, locationIds, ...rules }) => {
        roadRules[id] = rules;
        return { id, name, locationIds };
      }),
    }),
  };
  assert.deepEqual(WorldPackDraftSchema.parse(composeWorldPackDraft(map, { ...rest, locationContent, roadRules })), pack);
  return map;
}

function propertyName(node: ts.ObjectLiteralElementLike): string {
  if (!ts.isPropertyAssignment(node) || !(ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
    throw new Error('Migration requires explicit named properties');
  }
  return node.name.text;
}

function rewriteContent(source: string, path: string, pack: WorldPackDraft): string {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const declarations = file.statements.filter(ts.isVariableStatement).flatMap((statement) => statement.declarationList.declarations);
  const draft = declarations.find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'draft');
  if (!draft?.initializer) throw new Error(`${path}: original draft not found; migration must run only once`);
  const initializer = draft.initializer;
  const literal = ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer) ? initializer.expression : initializer;
  if (!ts.isObjectLiteralExpression(literal)) throw new Error(`${path}: draft must be an object literal`);
  const edits: { start: number; end: number; text: string }[] = [];
  for (const property of literal.properties) {
    const name = propertyName(property);
    if (name === 'locationGroups') {
      edits.push({ start: property.getFullStart(), end: property.end + (source[property.end] === ',' ? 1 : 0), text: '' });
      continue;
    }
    if (name !== 'locations' && name !== 'roads') continue;
    if (!ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) {
      throw new Error(`${path}: ${name} must be an array literal`);
    }
    const excluded = name === 'locations' ? layoutFields : roadLayoutFields;
    const entries = property.initializer.elements.map((element, index) => {
      if (!ts.isObjectLiteralExpression(element)) throw new Error(`${path}: ${name}[${index}] must be an object literal`);
      const id = element.properties.find((entry) => propertyName(entry) === 'id');
      if (!id || !ts.isPropertyAssignment(id) || !ts.isStringLiteral(id.initializer)) {
        throw new Error(`${path}: ${name}[${index}] needs a literal ID`);
      }
      const expected = name === 'locations' ? pack.locations[index] : pack.roads[index];
      assert.equal(id.initializer.text, expected?.id, 'Source and built pack must have identical order');
      const content = element.properties.filter((entry) => !excluded.has(propertyName(entry)));
      if (!content.length) return '';
      const key = ts.createPrinter().printNode(ts.EmitHint.Expression, ts.factory.createStringLiteral(id.initializer.text, true), file);
      return `    ${key}: {${content.map((entry) => entry.getFullText(file)).join(',')},\n    },`;
    }).filter(Boolean);
    edits.push({ start: property.getFullStart(), end: property.end,
      text: `\n  ${name === 'locations' ? 'locationContent' : 'roadRules'}: {\n${entries.join('\n')}\n  }` });
  }
  assert.equal(edits.length, 3, 'Expected locations, locationGroups and roads');
  edits.push({ start: draft.name.getStart(file), end: draft.name.end, text: 'content' });
  edits.push({ start: literal.end, end: initializer.end, text: ' satisfies WorldPackContent' });
  // Keep the original shared fish data and encounter helper, with authoring types.
  const fish = declarations.find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'lowerRillFishSpecies');
  if (fish?.initializer && ts.isAsExpression(fish.initializer)) {
    edits.push({ start: fish.initializer.expression.end, end: fish.initializer.end, text: ' satisfies FishingSpeciesDefinition[]' });
  }
  const bandit = file.statements.filter(ts.isFunctionDeclaration).find((declaration) => declaration.name?.text === 'banditEncounter');
  if (bandit?.body) {
    edits.push({ start: bandit.body.getFullStart(), end: bandit.body.getFullStart(),
      text: ": WorldPackContent['roadRules'][string]['encounters'][number]" });
  }
  // Apply from the end so earlier source offsets stay valid.
  edits.sort((left, right) => right.start - left.start);
  let result = source;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  result = result.replace('  WorldPackDraftSchema,', `  WorldPackDraftSchema,\n  WorldLocationsFileSchema,\n  WorldLocationGroupsFileSchema,\n  WorldRoadsFileSchema,\n  composeWorldPackDraft,`)
    .replace('  type WorldPackDraft,', '  type WorldPackDraft,\n  type WorldPackContent,')
    .replace('  type WorldPackDraftInput,\n', '')
    .replace('WorldPackDraftSchema.parse(draft)', `WorldPackDraftSchema.parse(composeWorldPackDraft({
  locations: WorldLocationsFileSchema.parse(locations),
  locationGroups: WorldLocationGroupsFileSchema.parse(locationGroups),
  roads: WorldRoadsFileSchema.parse(roads),
}, content))`);
  if (fish) result = result.replace('  type WorldPackContent,', '  type WorldPackContent,\n  type FishingSpeciesDefinition,');
  const importEnd = result.indexOf("from '@mudd/contracts';") + "from '@mudd/contracts';".length;
  result = result.slice(0, importEnd) + `
import locations from './map/locations.json' with { type: 'json' };
import locationGroups from './map/location-groups.json' with { type: 'json' };
import roads from './map/roads.json' with { type: 'json' };` + result.slice(importEnd);
  return result;
}

for (const [name, pack] of [['orraveth', orravethWorld], ['demo', demoWorld]] as const) {
  const path = `packages/world-${name}/src/index.ts`;
  const source = await readFile(new URL(path, root), 'utf8');
  const rewritten = rewriteContent(source, path, pack);
  const map = splitPack(pack);
  const directory = new URL(`packages/world-${name}/src/map/`, root);
  await mkdir(directory, { recursive: true });
  for (const [file, data] of [['locations', map.locations], ['location-groups', map.locationGroups], ['roads', map.roads]] as const) {
    await writeFile(new URL(`${file}.json`, directory), JSON.stringify(data, null, 2) + '\n');
  }
  await writeFile(new URL(path, root), rewritten);
  console.log(`${name}: extracted ${pack.locations.length} locations, ${pack.locationGroups.length} groups and ${pack.roads.length} roads; composition equals original pack`);
}
