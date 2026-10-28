import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocationGroupDefinitionSchema,
  LocationGroupUpdateSchema,
  locationGroupMembershipsForLocation,
  projectVisibleLocationGroups,
  resolveLocationDisplayName,
} from '../dist/src/index.js';

const group = (overrides = {}) => ({
  id: 'bellwold',
  name: 'Bellwold',
  type: 'town',
  description: 'The homes and roads around Bellwold.',
  metadata: { region: 'orraveth' },
  memberships: [
    { locationId: 'market-square', isPrimary: true },
    { locationId: 'south-bridge', isPrimary: false },
  ],
  ...overrides,
});

test('location-group schemas normalize authoring values and reject empty updates', () => {
  const parsed = LocationGroupDefinitionSchema.parse({
    id: 'bellwold',
    name: ' Bellwold ',
    type: ' town ',
  });
  assert.equal(parsed.name, 'Bellwold');
  assert.equal(parsed.type, 'town');
  assert.deepEqual(parsed.memberships, []);
  assert.equal(LocationGroupUpdateSchema.safeParse({}).success, false);
  assert.equal(LocationGroupUpdateSchema.safeParse({ description: null, metadata: null }).success, true);
  assert.equal(LocationGroupDefinitionSchema.safeParse(group({
    memberships: [{ locationId: 'market-square', isPrimary: true, ignored: true }],
  })).success, false);
});

test('projects matching location memberships with and without optional metadata', () => {
  const groups = [
    group(),
    group({
      id: 'district',
      name: 'South Common',
      type: 'district',
      description: undefined,
      metadata: undefined,
      memberships: [{ locationId: 'market-square', isPrimary: false }],
    }),
  ];
  assert.deepEqual(locationGroupMembershipsForLocation(groups, 'market-square'), [
    {
      id: 'bellwold',
      name: 'Bellwold',
      type: 'town',
      description: 'The homes and roads around Bellwold.',
      metadata: { region: 'orraveth' },
      isPrimary: true,
    },
    {
      id: 'district',
      name: 'South Common',
      type: 'district',
      isPrimary: false,
    },
  ]);
  assert.deepEqual(locationGroupMembershipsForLocation(groups, 'unmapped-room'), []);
});

test('resolves qualified display names and projects only visible group locations', () => {
  const memberships = locationGroupMembershipsForLocation([group()], 'market-square');
  assert.deepEqual(resolveLocationDisplayName('Market Square', memberships), {
    shortName: 'Market Square',
    qualifiedName: 'Bellwold: Market Square',
    primaryLocationGroupId: 'bellwold',
  });
  assert.deepEqual(resolveLocationDisplayName('Roadside Cairn', [], ' / '), {
    shortName: 'Roadside Cairn',
    qualifiedName: 'Roadside Cairn',
  });

  assert.deepEqual(projectVisibleLocationGroups([
    group(),
    group({
      id: 'hidden',
      name: 'Hidden place',
      type: 'district',
      memberships: [{ locationId: 'unvisited' }],
    }),
  ], new Set(['market-square', 'unmapped-room'])), [{
    id: 'bellwold',
    name: 'Bellwold',
    type: 'town',
    description: 'The homes and roads around Bellwold.',
    metadata: { region: 'orraveth' },
    locationIds: ['market-square'],
    primaryLocationIds: ['market-square'],
  }]);
});
