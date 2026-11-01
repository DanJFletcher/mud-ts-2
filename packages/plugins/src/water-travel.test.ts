import { describe, expect, it } from 'vitest';
import { WorldPackDraftSchema, type SessionContext } from '@mudd/contracts';
import { EngineHost, InMemoryEventStore, replayCharacter } from '@mudd/engine-core';
import { characterPlugin } from './character.js';
import { movementPlugin } from './movement.js';
import { worldItemsPlugin } from './world-items.js';

describe('water travel authority', () => {
  it('rejects direct movement into water without committing movement, spending stamina or changing discovery', async () => {
    const world = WorldPackDraftSchema.parse({
      formatVersion: 1, packId: 'water-test', packVersion: '1.0.0', displayName: 'Water test',
      locations: [
        { id: 'shore', name: 'Shore', description: 'Dry ground.', exits: [
          { id: 'shore-to-water', fromLocationId: 'shore', toLocationId: 'water', label: 'Water' },
        ] },
        { id: 'water', name: 'Water', description: 'Open water.', requiresWaterTravel: true, exits: [] },
      ],
    });
    const store = new InMemoryEventStore();
    const session: SessionContext = {
      sessionId: 'water-session', playerId: 'water-player', actorId: 'water-player',
      worldInstanceId: 'water-world', grantedPermissions: [], authenticated: true,
    };
    let nextId = 0;
    const engine = new EngineHost([worldItemsPlugin, characterPlugin, movementPlugin], store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true }, world,
      () => `water-test-${++nextId}`);
    await engine.start();
    try {
      const created = await engine.dispatch({ type: 'character.create', version: 1, commandId: 'water-create',
        worldInstanceId: session.worldInstanceId, payload: { name: 'Water Tester' } }, session);
      const characterId = created.streamId;
      if (!characterId) throw new Error('Character creation did not return a stream.');
      const before = await store.readStream(session.worldInstanceId, characterId);
      const character = replayCharacter(before);
      if (!character) throw new Error('Missing character projection.');
      const result = await engine.dispatch({ type: 'character.move', version: 1, commandId: 'water-move',
        worldInstanceId: session.worldInstanceId, characterId, expectedVersion: character.revision,
        payload: { exitId: 'shore-to-water' } }, session);
      expect(result.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
      if (result.receipt.ok) throw new Error('Water movement unexpectedly succeeded.');
      expect(result.receipt.message).toContain('swim or use a boat');
      expect(result.events).toEqual([]);
      expect(await store.readStream(session.worldInstanceId, characterId)).toEqual(before);
    } finally {
      await engine.stop();
    }
  });
});
