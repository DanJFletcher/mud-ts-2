import {
  CharacterAdvancementAwardedEventV2Schema,
  CharacterMovedEventSchema,
  CharacterTeamCombatOutcomeAppliedEventSchema,
  TeamCombatActionCommandSchema,
  TeamCombatActionResolvedEventSchema,
  TeamCombatEndedEventSchema,
  TeamCombatInfoProjectionSchema,
  TeamCombatInfoQuerySchema,
  TeamCombatOutcomeEffectSchema,
  TeamCombatStartCommandSchema,
  TeamCombatStartedEventSchema,
  TeamCombatEncounterSchema,
  TeamRoadEncounterStartedEventSchema,
  FLEE_STAMINA_COST,
  type TeamCombatEncounter,
  type TeamRoadTravelSnapshot,
  type RoadEncounterDefinition,
  type CharacterProjection,
} from '@mudd/contracts';
import type { CommandPlan, EngineCommandContext, EnginePlugin, EventEffectContext, ProposedDomainEvent, ProposedEventEffect } from '@mudd/engine-core';
import { replayCharacter, RuleViolationError, SYSTEM_ACTOR_ID } from '@mudd/engine-core';
import {
  assertCharacterAlive,
  characterStateCapability,
  teamFleeStaminaEffect,
  type CharacterStateCapability,
} from './character.js';
import { prepareCharacterRespawn } from './respawn.js';
import { characterAttackDamage, maximumHealthForLevel } from './character-stats.js';
import {
  teamCombatRosterPolicyCapability,
  teamRoadEncounterCapability,
  type TeamCombatRosterPolicy,
  type TeamRoadEncounterCapability,
} from './team-combat-policy.js';
import { createWorldCorpseEffect } from './world-items.js';

const STREAM_ID = 'world-team-combat';
const PLAYER_TEAM = 'allies';
const ENEMY_TEAM = 'enemies';

type CombatEvent = {
  type: string;
  version: number;
  payload: unknown;
};

function project(events: readonly { type: string; version: number; payload: unknown }[]) {
  const encounters = new Map<string, TeamCombatEncounter>();
  const roadTravelByEncounter = new Map<string, TeamRoadTravelSnapshot>();
  let revision = 0;
  for (const stored of events) {
    const event: CombatEvent = {
      type: stored.type,
      version: stored.version,
      payload: stored.payload,
    };
    if (event.type === 'team.road_encounter_started') {
      const parsed = TeamRoadEncounterStartedEventSchema.parse(event);
      encounters.delete(parsed.payload.encounter.encounterId);
      encounters.set(parsed.payload.encounter.encounterId, parsed.payload.encounter);
      roadTravelByEncounter.set(parsed.payload.encounter.encounterId, parsed.payload.roadTravel);
    } else if (event.type === 'team.combat_started') {
      const parsed = TeamCombatStartedEventSchema.parse(event);
      encounters.delete(parsed.payload.encounter.encounterId);
      encounters.set(parsed.payload.encounter.encounterId, parsed.payload.encounter);
    } else if (event.type === 'team.combat_action_resolved') {
      const parsed = TeamCombatActionResolvedEventSchema.parse(event);
      encounters.delete(parsed.payload.encounter.encounterId);
      encounters.set(parsed.payload.encounter.encounterId, parsed.payload.encounter);
    }
    revision += 1;
  }
  return { encounters: [...encounters.values()], roadTravelByEncounter, revision };
}

function encounterFor(events: ReturnType<typeof project>['encounters'], characterId: string) {
  return [...events].reverse().find((encounter) =>
    encounter.participants.some((participant) => participant.characterId === characterId),
  ) ?? null;
}

function maximumHealth(character: {
  health?: { maximum: number };
  advancement?: { level: number };
  attributes: { constitution: number };
}) {
  return character.health?.maximum ?? maximumHealthForLevel(
    character.advancement?.level ?? 1,
    character.attributes.constitution,
  );
}

function findCombatNpc(
  context: EngineCommandContext,
  locationId: string,
  npcId: string,
  roadId?: string,
) {
  if (roadId) {
    return context.world.roads.find((road) => road.id === roadId)?.encounters.find((candidate) => candidate.id === npcId);
  }
  return context.world.locations.find((location) => location.id === locationId)?.npcs
    ?.find((candidate) => candidate.id === npcId);
}

async function applyOutcomes(
  payload: ReturnType<typeof TeamCombatOutcomeEffectSchema.parse>,
  context: EventEffectContext,
) {
  for (const player of payload.players) {
    const history = await context.store.readStream(context.worldInstanceId, player.characterId);
    if (history.some((event) =>
      event.type === 'character.team_combat_outcome_applied' &&
      (event.payload as { encounterId?: string }).encounterId === payload.encounterId,
    )) continue;

    const character = replayCharacter(history);
    if (!character || character.archived) continue;
    if (character.locationId !== payload.locationId) {
      throw new Error('A team combat participant changed locations before encounter resolution.');
    }
    const previousMaximum = character.health?.maximum ?? player.maximumHealth;
    const health = { current: Math.min(player.health, previousMaximum), maximum: previousMaximum };
    const consumedItemIds = payload.players.find((entry) =>
      entry.characterId === player.characterId,
    )?.consumedItemIds ?? [];
    const events: ProposedDomainEvent[] = [{
      type: 'character.team_combat_outcome_applied',
      version: 1,
      payload: CharacterTeamCombatOutcomeAppliedEventSchema.shape.payload.parse({
        characterId: player.characterId,
        encounterId: payload.encounterId,
        result: payload.result,
        health,
        consumedItemIds,
      }),
    }];
    const effects: ProposedEventEffect[] = [];
    let nextMaximumHealth = previousMaximum;
    if (payload.result === 'victory') {
      const advancement = character.advancement ?? { experience: 0, level: 1 };
      const totalExperience = advancement.experience + 10;
      let level = advancement.level;
      while (level < 10 && totalExperience >= level * 20) level += 1;
      nextMaximumHealth = maximumHealthForLevel(level, character.attributes.constitution);
      const advancementPayload = CharacterAdvancementAwardedEventV2Schema.shape.payload.parse({
        characterId: player.characterId,
        encounterId: payload.encounterId,
        experienceAwarded: 10,
        totalExperience,
        level,
        maximumHealth: nextMaximumHealth,
        source: 'team-pve',
      });
      events.push({
        type: 'character.advancement_awarded',
        version: 2,
        payload: advancementPayload,
      });
    }
    if (health.current === 0) {
      const respawn = prepareCharacterRespawn(
        character,
        context,
        'team-pve',
        payload.encounterId,
        payload.locationId,
        consumedItemIds,
        nextMaximumHealth,
      );
      if (respawn) {
        events.push(respawn.event as typeof events[number]);
        effects.push(...respawn.effects);
      }
    }
    if (payload.result === 'victory' && payload.roadTravel && health.current > 0) {
      const movementPayload = CharacterMovedEventSchema.shape.payload.parse({
        characterId: player.characterId,
        fromLocationId: payload.roadTravel.fromLocationId,
        toLocationId: payload.roadTravel.toLocationId,
        exitId: payload.roadTravel.exitId,
        roadTravel: {
          roadId: payload.roadTravel.roadId,
          segmentIndex: payload.roadTravel.segmentIndex,
          encounterRoll: payload.roadTravel.encounterRoll,
          encounterOccurred: true,
        },
      });
      events.push({ type: 'character.moved', version: 1, payload: movementPayload });
      effects.push({
        type: 'world.location.entered',
        version: 1,
        payload: {
          characterId: player.characterId,
          fromLocationId: payload.roadTravel.fromLocationId,
          toLocationId: payload.roadTravel.toLocationId,
          arrivalId: `team-road:${payload.encounterId}`,
        },
      });
      effects.push({
        type: 'engine.domain_event_dispatch',
        version: 1,
        payload: {
          eventType: 'character.moved',
          eventVersion: 1,
          actorId: context.actorId ?? SYSTEM_ACTOR_ID,
          payload: movementPayload,
        },
      });
    }
    await context.store.append({
      worldInstanceId: context.worldInstanceId,
      streamId: player.characterId,
      expectedVersion: history.length,
      commandId: `team-combat-outcome:${payload.encounterId}:${player.characterId}`,
      actorId: context.actorId ?? SYSTEM_ACTOR_ID,
      payloadHash: JSON.stringify({
        encounterId: payload.encounterId,
        result: payload.result,
        locationId: payload.locationId,
        roadTravel: payload.roadTravel ?? null,
        player,
      }),
      events,
      effects,
    });
  }
}

export const teamCombatPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.team-combat',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    provides: [teamRoadEncounterCapability.id],
    requires: [characterStateCapability.id, teamCombatRosterPolicyCapability.id],
    requiredPlugins: {
      'mudd.character': '^1.0.0',
      'mudd.combat': '^1.0.0',
    },
    eventSchemaVersions: {
      'team.combat_started': 1,
      'team.road_encounter_started': 1,
      'team.combat_action_resolved': 1,
      'team.combat_ended': 1,
      'character.team_combat_outcome_applied': 1,
      'character.respawned': 1,
    },
  },
  register({ registerCommand, registerQuery, registerEffect, requireCapability, provideCapability }) {
    const characters = requireCapability<CharacterStateCapability>(characterStateCapability);
    const rosterPolicy = requireCapability<TeamCombatRosterPolicy>(teamCombatRosterPolicyCapability);

    const roadEncounterCapability: TeamRoadEncounterCapability = {
      async plan(
        context: EngineCommandContext,
        initiator: CharacterProjection,
        opponent: RoadEncounterDefinition,
        roadTravel: TeamRoadTravelSnapshot,
      ): Promise<CommandPlan | undefined> {
        const roster = await rosterPolicy.resolveIfPartyPresent(
          context,
          initiator.characterId,
          initiator.locationId,
        );
        if (!roster || roster.players.length < 2) return undefined;

        const orderedPlayers = [...roster.players].sort((a, b) =>
          a.characterId === initiator.characterId ? -1 :
            b.characterId === initiator.characterId ? 1 : a.playerId.localeCompare(b.playerId),
        );
        if (
          !Number.isInteger(roster.maxPlayers) ||
          roster.maxPlayers < 2 ||
          orderedPlayers.length < 2 ||
          orderedPlayers.length > roster.maxPlayers
        ) {
          throw new RuleViolationError('There are not enough eligible party members for a shared road encounter.');
        }

        const stream = await context.store.readStream(context.worldInstanceId, STREAM_ID);
        const state = project(stream);
        const activeCharacterIds = new Set(state.encounters
          .filter((encounter) => encounter.status === 'active')
          .flatMap((encounter) => encounter.participants
            .filter((participant) => participant.kind === 'player' && participant.status === 'active')
            .map((participant) => participant.characterId!)));
        if (orderedPlayers.some((player) => activeCharacterIds.has(player.characterId))) {
          throw new RuleViolationError('A party member is already participating in another encounter.');
        }

        const players = await Promise.all(orderedPlayers.map(async (player) => {
          const projection = await characters.load(context, player.characterId);
          if (!projection || projection.locationId !== initiator.locationId) {
            throw new RuleViolationError('A party member is no longer in this room.');
          }
          assertCharacterAlive(projection);
          const maximum = maximumHealth(projection);
          return {
            participantId: projection.characterId,
            teamId: PLAYER_TEAM,
            kind: 'player' as const,
            characterId: projection.characterId,
            playerId: player.playerId,
            displayName: projection.name,
            health: Math.min(projection.health?.current ?? maximum, maximum),
            maximumHealth: maximum,
            defending: false,
            status: 'active' as const,
          };
        }));
        if (!players.some((player) => player.characterId === initiator.characterId)) {
          throw new RuleViolationError('You must be present with your party to face a road encounter.');
        }

        const now = context.now().toISOString();
        const roadName = context.world.roads.find((road) => road.id === roadTravel.roadId)?.name ?? 'road';
        const encounter = TeamCombatEncounterSchema.parse({
          encounterId: context.makeId(),
          sourceGroupId: roster.sourceGroupId,
          locationId: initiator.locationId,
          participants: [
            ...players,
            {
              participantId: context.makeId(),
              teamId: ENEMY_TEAM,
              kind: 'npc',
              npcId: opponent.id,
              displayName: opponent.name,
              health: opponent.combatProfile.maxHealth,
              maximumHealth: opponent.combatProfile.maxHealth,
              defending: false,
              status: 'active',
            },
          ],
          contributingPlayerIds: [],
          currentParticipantId: initiator.characterId,
          round: 1,
          status: 'active',
          lastNarration: `${opponent.name} ambushes ${players.map((player) => player.displayName).join(', ')} on the ${roadName}.`,
          consumedItemIdsByCharacter: {},
          createdAt: now,
          updatedAt: now,
        });
        return {
          streamId: STREAM_ID,
          expectedVersion: state.revision,
          events: [{
            type: 'team.road_encounter_started',
            version: 1,
            payload: TeamRoadEncounterStartedEventSchema.shape.payload.parse({ encounter, roadTravel }),
          }],
        };
      },
    };
    provideCapability(teamRoadEncounterCapability, roadEncounterCapability);

    registerCommand('team.combat.start', TeamCombatStartCommandSchema, async (command, context) => {
      const character = await characters.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      const location = context.world.locations.find((candidate) => candidate.id === character.locationId);
      const npc = location?.npcs?.find((candidate) => candidate.id === command.payload.targetNpcId);
      if (!npc?.combatProfile) throw new RuleViolationError('That opponent cannot be fought here.');

      const stream = await context.store.readStream(context.worldInstanceId, STREAM_ID);
      const state = project(stream);
      const roster = await rosterPolicy.resolve(context, character.characterId, character.locationId);
      const orderedPlayers = [...roster.players].sort((a, b) =>
        a.characterId === character.characterId ? -1 :
          b.characterId === character.characterId ? 1 : a.playerId.localeCompare(b.playerId),
      );
      if (
        !Number.isInteger(roster.maxPlayers) ||
        roster.maxPlayers < 1 ||
        orderedPlayers.length < 1 ||
        orderedPlayers.length > roster.maxPlayers
      ) {
        throw new RuleViolationError('There are no eligible party members in this room.');
      }
      const activeCharacterIds = new Set(state.encounters
        .filter((encounter) => encounter.status === 'active')
        .flatMap((encounter) => encounter.participants
          .filter((participant) => participant.kind === 'player' && participant.status === 'active')
          .map((participant) => participant.characterId!)));
      if (orderedPlayers.some((player) => activeCharacterIds.has(player.characterId))) {
        throw new RuleViolationError('A party member is already participating in another encounter.');
      }

      const now = context.now().toISOString();
      const players = await Promise.all(orderedPlayers.map(async (player) => {
        const projection = await characters.load(context, player.characterId);
        if (!projection || projection.locationId !== character.locationId) {
          throw new RuleViolationError('A party member is no longer in this room.');
        }
        assertCharacterAlive(projection);
        const maximum = maximumHealth(projection);
        return {
          participantId: projection.characterId,
          teamId: PLAYER_TEAM,
          kind: 'player' as const,
          characterId: projection.characterId,
          playerId: player.playerId,
          displayName: projection.name,
          health: Math.min(projection.health?.current ?? maximum, maximum),
          maximumHealth: maximum,
          defending: false,
          status: 'active' as const,
        };
      }));
      const encounter = TeamCombatEncounterSchema.parse({
        encounterId: context.makeId(),
        sourceGroupId: roster.sourceGroupId,
        locationId: character.locationId,
        participants: [
          ...players,
          {
            participantId: context.makeId(),
            teamId: ENEMY_TEAM,
            kind: 'npc',
            npcId: npc.id,
            displayName: npc.name,
            health: npc.combatProfile.maxHealth,
            maximumHealth: npc.combatProfile.maxHealth,
            defending: false,
            status: 'active',
          },
        ],
        contributingPlayerIds: [],
        currentParticipantId: character.characterId,
        round: 1,
        status: 'active',
        lastNarration: `${players.map((player) => player.displayName).join(', ')} join the fight against ${npc.name}.`,
        consumedItemIdsByCharacter: {},
        createdAt: now,
        updatedAt: now,
      });
      return {
        streamId: STREAM_ID,
        expectedVersion: state.revision,
        events: [{
          type: 'team.combat_started',
          version: 1,
          payload: TeamCombatStartedEventSchema.shape.payload.parse({ encounter }),
        }],
      };
    });

    registerCommand('team.combat.action', TeamCombatActionCommandSchema, async (command, context) => {
      const history = await context.store.readStream(context.worldInstanceId, STREAM_ID);
      const state = project(history);
      const encounter = state.encounters.find((candidate) =>
        candidate.encounterId === command.payload.encounterId,
      );
      if (!encounter || encounter.status !== 'active') throw new RuleViolationError('That encounter is no longer active.');
      if (encounter.currentParticipantId !== command.characterId) {
        throw new RuleViolationError('It is not your turn.');
      }
      const actor = encounter.participants.find((participant) =>
        participant.kind === 'player' && participant.characterId === command.characterId,
      );
      if (!actor || actor.status !== 'active') throw new RuleViolationError('Your character cannot act in this encounter.');
      const character = await characters.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);

      const participants = encounter.participants.map((participant) => ({ ...participant }));
      const activeActor = participants.find((participant) => participant.participantId === actor.participantId)!;
      const enemies = participants.filter((participant) =>
        participant.teamId !== PLAYER_TEAM && participant.status === 'active',
      );
      let damageDealt = 0;
      let damageTaken = 0;
      let healingDone = 0;
      let narration: string;
      const consumed = { ...encounter.consumedItemIdsByCharacter };
      const effects: ProposedEventEffect[] = [];

      if (command.payload.action === 'attack') {
        const target = enemies.find((enemy) =>
          !command.payload.targetParticipantId || enemy.participantId === command.payload.targetParticipantId,
        );
        if (!target) throw new RuleViolationError('There is no active enemy to target.');
        const npc = findCombatNpc(
          context,
          encounter.locationId,
          target.npcId!,
          state.roadTravelByEncounter.get(encounter.encounterId)?.roadId,
        );
        if (!npc?.combatProfile) throw new RuleViolationError('The opponent is no longer available.');
        const defense = npc.combatProfile.style === 'guardian' ? npc.combatProfile.defense ?? 1 : 0;
        damageDealt = Math.max(1, characterAttackDamage(character) - defense);
        target.health = Math.max(0, target.health - damageDealt);
        if (target.health === 0) target.status = 'defeated';
        narration = `${character.name} hits ${target.displayName} for ${damageDealt} damage.`;
      } else if (command.payload.action === 'defend') {
        activeActor.defending = true;
        narration = `${character.name} braces for an incoming attack.`;
      } else if (command.payload.action === 'flee') {
        if (character.resources.stamina.current < FLEE_STAMINA_COST) {
          throw new RuleViolationError(`You need ${FLEE_STAMINA_COST} stamina to flee.`);
        }
        activeActor.status = 'escaped';
        narration = `${character.name} retreats from the encounter and spends ${FLEE_STAMINA_COST} stamina.`;
        effects.push(teamFleeStaminaEffect(character.characterId, encounter.encounterId));
      } else {
        const item = character.inventory.find((candidate) => candidate.id === command.payload.itemId);
        const alreadyConsumed = consumed[character.characterId] ?? [];
        if (
          !item?.consumable ||
          item.questBound === true ||
          alreadyConsumed.includes(item.id)
        ) throw new RuleViolationError('That item is not available to use in this encounter.');
        healingDone = Math.min(item.consumable.amount, activeActor.maximumHealth - activeActor.health);
        if (healingDone <= 0) throw new RuleViolationError('Your health is already full.');
        activeActor.health += healingDone;
        consumed[character.characterId] = [...alreadyConsumed, item.id];
        narration = `${character.name} uses ${item.label} and restores ${healingDone} health.`;
      }

      let status: TeamCombatEncounter['status'] = 'active';
      const allies = participants.filter((participant) =>
        participant.teamId === PLAYER_TEAM && participant.status === 'active',
      );
      if (enemies.every((enemy) => enemy.status !== 'active')) status = 'victory';
      else if (allies.length === 0) {
        status = participants.some((participant) => participant.teamId === PLAYER_TEAM && participant.status === 'escaped')
          ? 'fled'
          : 'defeat';
      }

      let nextParticipantId: string | null = null;
      if (status === 'active') {
        const activeAllies = participants.filter((participant) =>
          participant.teamId === PLAYER_TEAM && participant.status === 'active',
        );
        const actorIndex = activeAllies.findIndex((participant) => participant.participantId === activeActor.participantId);
        const nextAlly = activeAllies[actorIndex + 1];
        if (nextAlly) {
          nextParticipantId = nextAlly.participantId;
        } else {
          const enemy = participants.find((participant) =>
            participant.teamId !== PLAYER_TEAM && participant.status === 'active',
          );
          const target = activeAllies.find((ally) => ally.defending) ??
            activeAllies[(encounter.round - 1) % activeAllies.length]!;
          const enemyDefinition = enemy?.npcId
            ? findCombatNpc(
                context,
                encounter.locationId,
                enemy.npcId,
                state.roadTravelByEncounter.get(encounter.encounterId)?.roadId,
              )
            : undefined;
          if (enemy && enemyDefinition?.combatProfile && target) {
            const armor = await characters.load(context, target.characterId!);
            const equippedArmor = armor?.inventory.find((item) =>
              item.id === armor.equipment.armorItemId,
            );
            const armorDefense = equippedArmor?.equipment?.defenseBonus ?? 0;
            const attack = enemyDefinition.combatProfile.style === 'heavy' && encounter.round % 2 === 1
              ? 0
              : Math.max(0, enemyDefinition.combatProfile.attackDamage - armorDefense -
                (target.defending ? 2 : 0));
            damageTaken = Math.min(target.health, attack);
            target.health -= damageTaken;
            target.defending = false;
            if (target.health === 0) target.status = 'defeated';
            narration += attack === 0
              ? ` ${enemy.displayName} circles, preparing a heavy strike.`
              : ` ${enemy.displayName} hits ${target.displayName} for ${damageTaken} damage.`;
          }
          const survivors = participants.filter((participant) =>
            participant.teamId === PLAYER_TEAM && participant.status === 'active',
          );
          if (survivors.length === 0) status = 'defeat';
          else {
            encounter.round += 1;
            nextParticipantId = survivors[0]!.participantId;
          }
        }
      }
      const updated = TeamCombatEncounterSchema.parse({
        ...encounter,
        participants,
        contributingPlayerIds: encounter.contributingPlayerIds.includes(context.session.playerId)
          ? encounter.contributingPlayerIds
          : [...encounter.contributingPlayerIds, context.session.playerId],
        consumedItemIdsByCharacter: consumed,
        status,
        currentParticipantId: status === 'active' ? nextParticipantId : null,
        lastNarration: narration.trim(),
        updatedAt: context.now().toISOString(),
      });
      const events: ProposedDomainEvent[] = [{
        type: 'team.combat_action_resolved',
        version: 1,
        payload: TeamCombatActionResolvedEventSchema.shape.payload.parse({
          encounter: updated,
          actingCharacterId: character.characterId,
          action: command.payload.action,
          damageDealt,
          damageTaken,
          healingDone,
          narration: updated.lastNarration,
        }),
      }];
      if (status !== 'active') {
        const opponent = participants.find((participant) => participant.teamId !== PLAYER_TEAM)!;
        const result = status;
        events.push({
          type: 'team.combat_ended',
          version: 1,
          payload: TeamCombatEndedEventSchema.shape.payload.parse({
            encounterId: encounter.encounterId,
            ...(encounter.sourceGroupId ? { sourceGroupId: encounter.sourceGroupId } : {}),
            locationId: encounter.locationId,
            npcId: opponent.npcId!,
            result,
            contributingPlayerIds: updated.contributingPlayerIds,
          }),
        });
        effects.push({
          type: 'team-combat.apply-outcomes',
          version: 1,
          payload: {
            encounterId: encounter.encounterId,
            locationId: encounter.locationId,
            result,
            ...(state.roadTravelByEncounter.get(encounter.encounterId)
              ? { roadTravel: state.roadTravelByEncounter.get(encounter.encounterId)! }
              : {}),
            players: participants
              .filter((participant) => participant.kind === 'player')
              .map((participant) => ({
                characterId: participant.characterId!,
                health: participant.health,
                maximumHealth: participant.maximumHealth,
                consumedItemIds: consumed[participant.characterId!] ?? [],
              })),
          },
        });
        if (status === 'victory') {
          const defeatedNpc = findCombatNpc(
            context,
            encounter.locationId,
            opponent.npcId!,
            state.roadTravelByEncounter.get(encounter.encounterId)?.roadId,
          );
          if (!defeatedNpc?.combatProfile) {
            throw new RuleViolationError('The defeated opponent is no longer available.');
          }
          effects.push(createWorldCorpseEffect(context.makeId, {
            encounterId: encounter.encounterId,
            opponentId: opponent.npcId!,
            opponentName: opponent.displayName,
            locationId: encounter.locationId,
            loot: defeatedNpc.loot,
            ...(context.world.currency
              ? {
                currencyId: context.world.currency.id,
                currencyName: context.world.currency.name,
              }
              : {}),
          }));
        }
      }
      return { streamId: STREAM_ID, expectedVersion: state.revision, events, effects };
    });

    registerQuery('team.combat.info', TeamCombatInfoQuerySchema, async (query, context) => {
      const state = project(await context.store.readStream(context.worldInstanceId, STREAM_ID));
      const encounter = encounterFor(state.encounters, query.characterId);
      return TeamCombatInfoProjectionSchema.parse({
        encounter,
        ...(encounter && state.roadTravelByEncounter.has(encounter.encounterId)
          ? { roadTravel: state.roadTravelByEncounter.get(encounter.encounterId) }
          : {}),
      });
    });

    registerEffect(
      'team-combat.apply-outcomes',
      1,
      TeamCombatOutcomeEffectSchema,
      applyOutcomes,
    );
  },
};

