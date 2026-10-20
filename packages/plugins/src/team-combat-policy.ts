import type { CapabilityToken } from '@mudd/contracts';
import type { CharacterProjection, RoadEncounterDefinition, TeamRoadTravelSnapshot } from '@mudd/contracts';
import type { CommandPlan, EngineCommandContext } from '@mudd/engine-core';
import type { ActiveRoomCharacter } from './combat-presence.js';

export interface TeamCombatRoster {
  readonly sourceGroupId?: string;
  readonly maxPlayers: number;
  readonly players: readonly ActiveRoomCharacter[];
}

export interface TeamCombatRosterPolicy {
  resolve(
    context: EngineCommandContext,
    initiatorCharacterId: string,
    locationId: string,
  ): Promise<TeamCombatRoster>;
  resolveIfPartyPresent(
    context: EngineCommandContext,
    initiatorCharacterId: string,
    locationId: string,
  ): Promise<TeamCombatRoster | undefined>;
}

export interface TeamRoadEncounterCapability {
  plan(
    context: EngineCommandContext,
    initiator: CharacterProjection,
    opponent: RoadEncounterDefinition,
    roadTravel: TeamRoadTravelSnapshot,
  ): Promise<CommandPlan | undefined>;
}

export const teamCombatRosterPolicyCapability = Object.freeze({
  id: 'mudd.combat.team-roster-policy.v1',
  version: '1',
}) satisfies CapabilityToken<TeamCombatRosterPolicy>;

export const teamRoadEncounterCapability = Object.freeze({
  id: 'mudd.team-combat.road-encounter.v1',
  version: '1',
}) satisfies CapabilityToken<TeamRoadEncounterCapability>;
