import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorldLocationsFileSchema,
  WorldLocationGroupsFileSchema,
  WorldRoadsFileSchema,
  WorldPackDraftSchema,
  composeWorldPackDraft,
} from '../dist/src/index.js';

const header = { formatVersion: 1, packId: 'test.world' };
const location = (id, overrides = {}) => ({
  id, name: id, description: 'An authored room.', exits: [], ...overrides,
});
const road = { id: 'trail', name: 'Trail', locationIds: ['start', 'middle', 'end'] };
const rules = {
  encounterChancePercent: 10,
  encounters: [{ id: 'rat', name: 'Rat', combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' } }],
};
const map = () => ({
  locations: WorldLocationsFileSchema.parse({
    ...header,
    locations: [location('start'), location('middle', { mapAreaId: 'cave' }), location('end')],
  }),
  locationGroups: WorldLocationGroupsFileSchema.parse({
    ...header,
    locationGroups: [{ id: 'village', name: 'Village', type: 'settlement', memberships: [{ locationId: 'start' }] }],
  }),
  roads: WorldRoadsFileSchema.parse({ ...header, roads: [road] }),
});
const content = () => ({
  ...header, packVersion: '1.0.0', displayName: 'Test world',
  locationContent: { start: { safeResting: false, readables: [] } },
  roadRules: { trail: rules },
});

test('locations file reuses strict location layout, exit and map position schemas', () => {
  const input = {
    ...header,
    locations: [location('start', {
      regionId: 'region', mapAreaId: 'cave',
      mapPosition: { x: 1, y: 2, z: -1, terrain: 'gravel', mapColor: '#112233', visibleWhenUnvisited: true },
      exits: [{ id: 'out', fromLocationId: 'start', toLocationId: 'end', label: 'Out',
        fromStateId: 'open', toStateId: 'outside', requiredInteractionId: 'unlock',
        roadId: 'trail', mapLineGapAtLocationId: 'start', direction: 'up' }],
    })],
  };
  assert.deepEqual(WorldLocationsFileSchema.parse(input), input);
  for (const invalid of [
    { ...input, ignored: true },
    { ...header, locations: [location('start', { safeResting: true })] },
    { ...header, locations: [location('start', { id: '' })] },
    { ...header, locations: [location('start', { description: '' })] },
    { ...header, locations: [location('start', { mapPosition: { x: 0.5, y: 0 } })] },
    { ...header, locations: [location('start', { mapPosition: { x: 0, y: 0, terrain: 'river', mapColor: '#112233' } })] },
    { ...header, locations: [location('start', { exits: [{ id: 'out', fromLocationId: 'start', toLocationId: 'end' }] })] },
    { ...header, locations: [location('start', { exits: [{ ...input.locations[0].exits[0], ignored: true }] })] },
  ]) {
    assert.equal(WorldLocationsFileSchema.safeParse(invalid).success, false);
  }
});

test('location-groups file reuses group validation and defaults', () => {
  const parsed = map().locationGroups;
  assert.deepEqual(parsed.locationGroups[0].memberships, [{ locationId: 'start', isPrimary: false }]);
  assert.equal(WorldLocationGroupsFileSchema.safeParse({ ...parsed, ignored: true }).success, false);
  assert.equal(WorldLocationGroupsFileSchema.safeParse({
    ...header, locationGroups: [{ id: 'village', name: 'Village', type: 'settlement', ignored: true }],
  }).success, false);
});

test('roads file contains only layout and retains road constraints', () => {
  const input = { ...header, roads: [road] };
  assert.deepEqual(WorldRoadsFileSchema.parse(input), input);
  assert.equal(WorldRoadsFileSchema.safeParse({ ...input, ignored: true }).success, false);
  assert.equal(WorldRoadsFileSchema.safeParse({ ...header, roads: [{ ...road, locationIds: ['start', 'end'] }] }).success, false);
  assert.equal(WorldRoadsFileSchema.safeParse({ ...header, roads: [{ ...road, ...rules }] }).success, false);
});

for (const [schema, field] of [
  [WorldLocationsFileSchema, 'locations'],
  [WorldLocationGroupsFileSchema, 'locationGroups'],
  [WorldRoadsFileSchema, 'roads'],
]) {
  test(`${field} file accepts only formatVersion 1 and a valid packId`, () => {
    for (const formatVersion of [0, 2, '1', null, undefined]) {
      assert.equal(schema.safeParse({ ...header, formatVersion, [field]: [] }).success, false);
    }
    assert.equal(schema.safeParse({ ...header, packId: '', [field]: [] }).success, false);
  });
}

test('composition preserves all array order and input objects, and leaves defaults to the pack schema', () => {
  const layout = map();
  layout.locations.locations[0].exits = [
    { id: 'second', fromLocationId: 'start', toLocationId: 'end', label: 'Second' },
    { id: 'first', fromLocationId: 'start', toLocationId: 'middle', label: 'First' },
  ];
  layout.locationGroups.locationGroups.push({ id: 'district', name: 'District', type: 'district', memberships: [] });
  layout.roads.roads.push({ ...road, id: 'another-trail' });
  const authored = content();
  authored.roadRules['another-trail'] = rules;
  const before = structuredClone({ layout, authored });
  const draft = composeWorldPackDraft(layout, authored);
  assert.deepEqual(draft, {
    ...header, packVersion: '1.0.0', displayName: 'Test world',
    locations: layout.locations.locations.map((room) => ({ ...room, ...(authored.locationContent[room.id] ?? {}) })),
    locationGroups: layout.locationGroups.locationGroups,
    roads: layout.roads.roads.map((entry) => ({ ...entry, ...rules })),
  });
  assert.deepEqual({ layout, authored }, before);
  assert.equal(Object.hasOwn(draft, 'locationContent'), false);
  assert.equal(Object.hasOwn(draft, 'roadRules'), false);
  // This fixture has roads without road-tagged exits; full graph validation remains the caller's job.
  assert.equal(draft.corpseLifecycle, undefined);
  assert.equal(WorldPackDraftSchema.safeParse({ ...draft, roads: [] }).success, true);
});

test('composition rejects content for an unknown location', () => {
  const authored = content();
  authored.locationContent.missing = {};
  assert.throws(() => composeWorldPackDraft(map(), authored), /unknown map location missing/);
});

test('composition rejects rules for an unknown road', () => {
  const authored = content();
  authored.roadRules.missing = rules;
  assert.throws(() => composeWorldPackDraft(map(), authored), /unknown map road missing/);
});

test('composition rejects a road without rules', () => {
  assert.throws(() => composeWorldPackDraft(map(), { ...content(), roadRules: {} }), /trail has no road rules/);
});

test('composition does not use inherited properties as location content or road rules', () => {
  const layout = map();
  layout.locations.locations[0].id = 'constructor';
  assert.equal(Object.hasOwn(composeWorldPackDraft(layout, { ...content(), locationContent: {} }).locations[0], 'safeResting'), false);
  layout.roads.roads[0].id = 'constructor';
  assert.throws(() => composeWorldPackDraft(layout, { ...content(), locationContent: {}, roadRules: {} }), /constructor has no road rules/);
});

test('composition rejects duplicate location IDs', () => {
  const layout = map();
  layout.locations.locations.push(location('start', { mapAreaId: 'another-area' }));
  assert.throws(() => composeWorldPackDraft(layout, content()), /Duplicate location ID start/);
});

for (const field of ['locations', 'locationGroups', 'roads']) {
  test(`composition rejects a packId mismatch in the ${field} file`, () => {
    const layout = map();
    layout[field].packId = 'another.world';
    assert.throws(() => composeWorldPackDraft(layout, content()), /packId another.world does not match content packId test.world/);
  });
}

test('composition rejects content whose packId disagrees with all map files', () => {
  assert.throws(() => composeWorldPackDraft(map(), { ...content(), packId: 'another.world' }), /does not match content packId another.world/);
});
