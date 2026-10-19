import type { EnginePlugin } from '@mudd/engine-core';
import {
  combatRoomPresenceCapability,
  type CombatRoomPresenceCapability,
} from '@mudd/core-plugins';
import { listActiveRoomCharacters } from './room-presence-service.js';

export const combatPresencePlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.room-combat-presence',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    provides: [combatRoomPresenceCapability.id],
  },
  register({ provideCapability }) {
    const implementation: CombatRoomPresenceCapability = {
      listActiveCharacters: (context, locationId) =>
        listActiveRoomCharacters(
          context.store,
          context.worldInstanceId,
          locationId,
        ),
    };
    provideCapability(combatRoomPresenceCapability, implementation);
  },
};
