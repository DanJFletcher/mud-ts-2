import test from 'node:test';
import assert from 'node:assert/strict';
import * as world from '../dist/src/world.js';
import * as contracts from '../dist/src/index.js';

test('world entry preserves authored, runtime, and shared contract exports', () => {
  for (const name of [
    'WorldPackDraftSchema',
    'validateDraftWorldGraph',
    'LocationProjectionSchema',
    'WorldMapProjectionSchema',
    'NpcDialogueChoiceCommandSchema',
    'MapTerrainSchema',
    'MapColorSchema',
    'ReadActionSchema',
    'ContainerKindSchema',
    'NpcCombatDispositionSchema',
  ]) {
    assert.ok(name in world, `${name} should be exported from world.ts`);
    assert.equal(world[name], contracts[name], `${name} should retain the package export identity`);
  }
});
