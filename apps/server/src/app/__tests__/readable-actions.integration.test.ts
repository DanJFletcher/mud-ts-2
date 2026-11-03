import { describe, expect, it } from 'vitest';
import { LocationProjectionSchema } from '@mudd/contracts';
import { useServerHarness, state, instanceId } from './server-harness.js';

describe('readable action HTTP compatibility', () => {
  const harness = useServerHarness();
  const object = { id: 'notice', label: 'Board', description: 'A board.', readable: true, takeable: false,
    readAction: { type: 'daily-board' as const, boardId: 'jobs' } };
  const location = { worldInstanceId: instanceId, locationId: 'npc-room', revision: 0,
    title: 'Room', shortName: 'Room', qualifiedName: 'Room', locationGroups: [], description: 'Room',
    exits: [], objects: [object], occupants: [] };
  const legacyObject = LocationProjectionSchema.shape.objects.element.omit({ readAction: true });

  it.each([undefined, '1', '2'])('negotiates version %s across every location response without mutating shared data', async (version) => {
    await harness.enterWorld('alice', 'character-alice');
    state.queryOverrides.set('location.describe', { ok: true, value: location });
    const headers: Record<string, string> = { 'x-test-user': 'alice', 'content-type': 'application/json' };
    if (version) headers['x-mudd-readable-actions'] = version;
    const snapshot = await fetch(`${harness.baseUrl}/api/game`, { headers }).then((res) => res.json());
    const query = await fetch(`${harness.baseUrl}/api/queries`, { headers, method: 'POST', body: JSON.stringify({
      type: 'location.describe', version: 1, queryId: 'look', characterId: 'character-alice',
      worldInstanceId: instanceId, payload: {},
    }) }).then((res) => res.json());
    const locations = [snapshot.location, query.value];
    for (const projection of [false, true]) {
      const result = await fetch(`${harness.baseUrl}/api/commands`, { method: 'POST', headers: {
        ...headers, ...(projection ? { 'x-mudd-command-projection': 'game' } : {}),
      }, body: JSON.stringify({ type: 'character.move', version: 1, commandId: `move-${projection}-${version}`,
        worldInstanceId: instanceId, characterId: 'character-alice', expectedVersion: 0, payload: { exitId: 'arrival' } })
      }).then((res) => res.json());
      locations.push((result.gameProjection ?? result.movementProjection)?.location);
    }
    for (const view of locations) {
      expect(view).toBeDefined();
      const projected = view.objects.find((entry: { id: string }) => entry.id === object.id);
      expect(projected.readAction).toEqual(version === '1' ? object.readAction : undefined);
      expect(legacyObject.safeParse(projected).success).toBe(version !== '1');
    }
    expect(object.readAction).toEqual({ type: 'daily-board', boardId: 'jobs' });
  });
});
