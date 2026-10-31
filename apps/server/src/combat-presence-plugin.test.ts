import { describe, expect, it, vi } from 'vitest';

const { getCharacterPresenceAnchors, listActiveRoomCharacters } = vi.hoisted(() => ({
  getCharacterPresenceAnchors: vi.fn(),
  listActiveRoomCharacters: vi.fn(),
}));

vi.mock('./room-presence-service.js', () => ({
  getCharacterPresenceAnchors,
  listActiveRoomCharacters,
}));

import {
  combatRoomPresenceCapability,
  type CombatRoomPresenceCapability,
} from '@mudd/core-plugins';
import { combatPresencePlugin } from './combat-presence-plugin.js';

describe('combat room presence capability', () => {
  it('provides the capability backed by the server room-presence service', async () => {
    const store = { readStream: vi.fn() };
    const rows = [{ characterId: 'character-1', displayName: 'Traveler' }];
    listActiveRoomCharacters.mockResolvedValue(rows);
    let registered: unknown;
    let implementation: CombatRoomPresenceCapability | undefined;

    combatPresencePlugin.register({
      provideCapability: (capability: unknown, value: typeof implementation) => {
        registered = capability;
        implementation = value;
      },
    } as never);

    expect(combatPresencePlugin.manifest.id).toBe('mudd.room-combat-presence');
    expect((registered as { id: string }).id).toBe(combatRoomPresenceCapability.id);
    await expect(implementation!.listActiveCharacters({
      store,
      worldInstanceId: 'world-1',
    }, 'market-square')).resolves.toBe(rows);
    expect(listActiveRoomCharacters).toHaveBeenCalledWith(store, 'world-1', 'market-square');
    const anchors = new Map([['character-1', new Date('2026-10-23T12:00:00.000Z')]]);
    getCharacterPresenceAnchors.mockResolvedValue(anchors);
    await expect(implementation!.getPresenceAnchors('world-1', ['character-1'])).resolves.toBe(anchors);
    expect(getCharacterPresenceAnchors).toHaveBeenCalledWith('world-1', ['character-1']);
  });
});
