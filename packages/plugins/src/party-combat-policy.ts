import {
  PvpEncounterProjectionSchema,
} from '@mudd/contracts';
import type { EnginePlugin } from '@mudd/engine-core';
import { RuleViolationError } from '@mudd/engine-core';
import {
  characterStateCapability,
  type CharacterStateCapability,
} from './character.js';
import {
  combatRoomPresenceCapability,
  type CombatRoomPresenceCapability,
} from './combat-presence.js';
import {
  interactionStreamId,
  projectInteractionEvents,
} from './interactions.js';
import {
  partyStateCapability,
  type PartyStateCapability,
} from './parties.js';
import {
  teamCombatRosterPolicyCapability,
  type TeamCombatRosterPolicy,
} from './team-combat-policy.js';

export const partyCombatPolicyPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.party-combat-policy',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
    provides: [teamCombatRosterPolicyCapability.id],
    requires: [
      partyStateCapability.id,
      characterStateCapability.id,
      combatRoomPresenceCapability.id,
    ],
    requiredPlugins: {
      'mudd.party': '^1.0.0',
      'mudd.character': '^1.0.0',
      'mudd.room-combat-presence': '^1.0.0',
    },
  },
  register({ provideCapability, requireCapability }) {
    const parties = requireCapability<PartyStateCapability>(partyStateCapability);
    const characterState = requireCapability<CharacterStateCapability>(characterStateCapability);
    const roomPresence = requireCapability<CombatRoomPresenceCapability>(combatRoomPresenceCapability);

    const policy: TeamCombatRosterPolicy = {
      async resolve(context, initiatorCharacterId, locationId) {
        const party = await parties.activePartyForPlayer(context, context.session.playerId);
        if (!party) throw new RuleViolationError('Join or create a party before starting cooperative combat.');

        const pvpEvents = await context.store.readStream(
          context.worldInstanceId,
          interactionStreamId(context.worldInstanceId),
        );
        const activePvp = PvpEncounterProjectionSchema.safeParse(
          projectInteractionEvents(pvpEvents).latestEncounterEvent?.payload.encounter,
        );
        const pvpParticipants = activePvp.success && activePvp.data.status !== 'completed'
          ? new Set(activePvp.data.participants.map((participant) => participant.characterId))
          : new Set<string>();

        const activeCharacters = await roomPresence.listActiveCharacters(context, locationId);
        const partyPlayerIds = new Set(party.members.map((member) => member.playerId));
        const candidates = activeCharacters.filter((candidate) => partyPlayerIds.has(candidate.playerId));
        const eligible = [];
        for (const candidate of candidates) {
          if (pvpParticipants.has(candidate.characterId)) continue;
          const character = await characterState.load(context, candidate.characterId);
          if (
            !character ||
            character.archived ||
            character.locationId !== locationId ||
            character.health?.current === 0 ||
            character.combat?.status === 'active' ||
            character.combat?.status === 'defeat'
          ) continue;
          eligible.push(candidate);
        }
        if (!eligible.some((player) =>
          player.playerId === context.session.playerId && player.characterId === initiatorCharacterId)) {
          throw new RuleViolationError('You must be online, alive, and in this room to begin the party encounter.');
        }
        return {
          sourceGroupId: party.groupId,
          maxPlayers: party.maxMembers,
          players: eligible.slice(0, party.maxMembers),
        };
      },
    };
    provideCapability<TeamCombatRosterPolicy>(teamCombatRosterPolicyCapability, policy);
  },
};
