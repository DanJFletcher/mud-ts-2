import {
  CharacterMovedEventSchema,
  RoadStepCommandSchema,
  type RoadDefinition,
  type CharacterProjection,
  type TeamRoadTravelSnapshot,
} from '@mudd/contracts';
import type { EnginePlugin, ProposedDomainEvent } from '@mudd/engine-core';
import { RuleViolationError } from '@mudd/engine-core';
import { assertCharacterAlive, characterStateCapability, type CharacterStateCapability } from './character.js';
import { createRoadEncounterStartEvent } from './combat.js';
import { movementPolicyCapability, type MovementPolicyCapability } from './movement.js';
import { teamRoadEncounterCapability, type TeamRoadEncounterCapability } from './team-combat-policy.js';

export const roadTravelPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.road-travel',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
    requiredPlugins: {
      'mudd.character': '^1.0.0',
      'mudd.combat': '^1.0.0',
      'mudd.movement': '^1.0.0',
      'mudd.team-combat': '^1.0.0',
    },
    requires: [
      characterStateCapability.id,
      movementPolicyCapability.id,
      teamRoadEncounterCapability.id,
    ],
    eventSchemaVersions: {
      'character.combat_encounter_started': 1,
    },
  },
  register({ registerCommand, requireCapability }) {
    const characterState = requireCapability<CharacterStateCapability>(characterStateCapability);
    const movementPolicy = requireCapability<MovementPolicyCapability>(movementPolicyCapability);
    const teamRoadEncounter = requireCapability<TeamRoadEncounterCapability>(teamRoadEncounterCapability);

    registerCommand('character.road.step', RoadStepCommandSchema, async (command, context) => {
      const character = await characterState.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      const movement = movementPolicy.plan(
        context.world,
        character,
        command.payload.exitId,
        true,
        context.now(),
        context.presenceAnchorAt,
      );
      const roadId = movement.exit.roadId;
      if (!roadId) throw new RuleViolationError('That exit is not part of a road.');
      const road = context.world.roads.find((candidate) => candidate.id === roadId);
      if (!road) throw new Error(`Exit ${movement.exit.id} references missing road ${roadId}.`);
      const fromIndex = road.locationIds.indexOf(movement.exit.fromLocationId);
      const toIndex = road.locationIds.indexOf(movement.exit.toLocationId);
      if (fromIndex < 0 || Math.abs(toIndex - fromIndex) !== 1) {
        throw new RuleViolationError('That exit does not lead to the next segment of this road.');
      }

      const encounterRoll = context.rng.roll(100);
      const encounterOccurred = encounterRoll <= road.encounterChancePercent;
      const opponent = encounterOccurred
        ? selectEncounter(road, context.rng.roll(road.encounters.length))
        : undefined;
      const movementEvent = movement.events.find((event) => event.type === 'character.moved');
      if (!movementEvent) throw new Error('Movement policy did not return a movement event.');
      if (encounterOccurred) {
        if (!opponent) throw new Error('A successful road encounter did not select an opponent.');
        const roadTravel: TeamRoadTravelSnapshot = {
          roadId,
          exitId: movement.exit.id,
          fromLocationId: movement.exit.fromLocationId,
          toLocationId: movement.exit.toLocationId,
          segmentIndex: Math.min(fromIndex, toIndex) + 1,
          encounterRoll,
        };
        const partyEncounter = await teamRoadEncounter.plan(context, character, opponent, roadTravel);
        if (partyEncounter) return partyEncounter;
      }

      const roadTravel = {
        roadId,
        segmentIndex: Math.min(fromIndex, toIndex) + 1,
        encounterRoll,
        encounterOccurred,
      };
      const movementPayload = CharacterMovedEventSchema.shape.payload.parse({
        ...movementEvent.payload,
        roadTravel,
      });
      const events: ProposedDomainEvent[] = movement.events.map((event) =>
        event.type === 'character.moved'
          ? { ...event, payload: movementPayload }
          : event,
      );
      if (encounterOccurred) {
        events.push(createRoadEncounterStartEvent(
          context,
          characterAtDestination(character, movement.exit.toLocationId),
          opponent!,
        ));
      }

      return {
        streamId: command.characterId,
        expectedVersion: command.expectedVersion,
        events,
        effects: movement.effects,
      };
    });
  },
};

function selectEncounter(road: RoadDefinition, roll: number): RoadDefinition['encounters'][number] {
  if (!Number.isInteger(roll) || roll < 1 || roll > road.encounters.length) {
    throw new Error('The random source returned an invalid road encounter selection.');
  }
  return road.encounters[roll - 1]!;
}

function characterAtDestination(
  character: CharacterProjection,
  locationId: string,
) {
  return { ...character, locationId };
}
