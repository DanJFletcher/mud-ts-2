import type { CapabilityToken } from '@mudd/contracts';
import type { EngineCommandContext } from '@mudd/engine-core';
import type { ActiveRoomCharacter } from './combat-presence.js';

export interface TeamCombatRosterPolicy {
  resolve(
    context: EngineCommandContext,
    initiatorCharacterId: string,
    locationId: string,
  ): Promise<Readonly<{
    sourceGroupId?: string;
    maxPlayers: number;
    players: readonly ActiveRoomCharacter[];
  }>>;
}

export const teamCombatRosterPolicyCapability = Object.freeze({
  id: 'mudd.combat.team-roster-policy.v1',
  version: '1',
}) satisfies CapabilityToken<TeamCombatRosterPolicy>;
