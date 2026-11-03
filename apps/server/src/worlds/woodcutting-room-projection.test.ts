import { describe, expect, it } from 'vitest';
import { LocationProjectionSchema } from '@mudd/contracts';
import { orravethWorld } from '@mudd/world-orraveth';
import { projectWoodcuttingTreePresence } from '@mudd/core-plugins';
import { projectWoodcuttingRoom } from './woodcutting-room-projection.js';

const location = LocationProjectionSchema.parse({
  worldInstanceId: 'orraveth-bellwold-instance',
  locationId: 'bellwold-southbound-track',
  revision: 1,
  title: 'Southbound Track',
  shortName: 'Southbound Track',
  qualifiedName: 'Southbound Track',
  locationGroups: [],
  description: 'Wind stirs the grass beside the packed road.',
  exits: [],
  objects: [],
  occupants: [],
  safeResting: false,
});

describe('woodcutting room projection', () => {
  const tree = orravethWorld.woodcuttingTrees[0]!;

  it('describes a cut tree as a stump without exposing its regrowth time', () => {
    const now = new Date('2026-10-27T12:00:00.000Z');
    const trees = projectWoodcuttingTreePresence([tree], [{
      type: 'world.tree_harvested',
      payload: {
        treeId: tree.id,
        characterId: 'woodcutter',
        remainingLogs: 0,
        respawnsAt: new Date(now.getTime() + 60_000).toISOString(),
      },
    }], now);
    const result = projectWoodcuttingRoom(location, trees);

    expect(result.location.description).toContain('The stump of a pine stands beside the packed road.');
    expect(result.location.description).not.toContain('regrow');
    expect(result.availableTrees).toEqual([]);
  });

  it('shows the authored tree description and makes the tree available after regrowth', () => {
    const now = new Date('2026-10-27T12:02:00.000Z');
    const trees = projectWoodcuttingTreePresence([tree], [{
      type: 'world.tree_harvested',
      payload: {
        treeId: tree.id,
        characterId: 'woodcutter',
        remainingLogs: 0,
        respawnsAt: new Date(now.getTime() - 1_000).toISOString(),
      },
    }], now);
    const result = projectWoodcuttingRoom(location, trees);

    expect(result.location.description).toContain(tree.roomDescription);
    expect(result.availableTrees).toEqual([{ id: tree.id, label: tree.label }]);
  });
});
