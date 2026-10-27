import { describe, expect, it, vi } from 'vitest';

const { listActiveRoomCharacters } = vi.hoisted(() => ({
  listActiveRoomCharacters: vi.fn(),
}));

vi.mock('./room-presence-service.js', () => ({ listActiveRoomCharacters }));

import { combatRoomPresenceCapability } from '@mudd/core-plugins';
import { combatPresencePlugin } from './combat-presence-plugin.js';

describe('combat room presence capability', () => {
  it('provides the capability backed by the server room-presence service', async () => {
    const store = { readStream: vi.fn() };
    const rows = [{ characterId: 'character-1', displayName: 'Traveler' }];
    listActiveRoomCharacters.mockResolvedValue(rows);
    let registered: unknown;
    let implementation: { listActiveCharacters: (context: any, locationId: string) => Promise<unknown> } | undefined;

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
  });
});
