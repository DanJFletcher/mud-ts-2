import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema } from '@mudd/contracts';
import type { StoredGameEvent } from '@mudd/engine-core';
import { demoWorld } from '@mudd/world-demo';
import {
  characterStateCapability,
  type CharacterStateCapability,
} from './character.js';
import {
  teamCombatRosterPolicyCapability,
  type TeamCombatRosterPolicy,
} from './team-combat-policy.js';
import { teamCombatPlugin } from './team-combat.js';

const now = new Date('2026-10-27T12:00:00.000Z');
const worldInstanceId = 'team-combat-test';

function player() {
  return CharacterProjectionSchema.parse({
    characterId: 'character-one',
    worldInstanceId,
    name: 'Aster',
    locationId: 'mossgate-clearing',
    revision: 3,
  });
}

function harness(projection = player()) {
  const commands = new Map<string, (command: any, context: any) => Promise<any>>();
  const queries = new Map<string, (query: any, context: any) => Promise<any>>();
  const effects = new Map<string, (payload: any, context: any) => Promise<void>>();
  let roadCapability: any;
  let teamHistory: StoredGameEvent[] = [];
  const characterHistories = new Map<string, StoredGameEvent[]>();
  const projections = new Map([[projection.characterId, projection]]);
  let nextId = 0;
  const roster: TeamCombatRosterPolicy = {
    resolve: vi.fn(async () => ({
      maxPlayers: 1,
      players: [{
        characterId: projection.characterId,
        playerId: 'player-one',
        displayName: projection.name,
      }],
    })),
    resolveIfPartyPresent: vi.fn(async () => undefined),
  };
  teamCombatPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: unknown) => {
      commands.set(name, handler as (command: any, context: any) => Promise<any>);
    },
    registerSystemCommand: () => undefined,
    registerQuery: (name: string, _schema: unknown, handler: unknown) => {
      queries.set(name, handler as (query: any, context: any) => Promise<any>);
    },
    registerEffect: (name: string, _version: number, _schema: unknown, handler: unknown) => {
      effects.set(name, handler as (payload: any, context: any) => Promise<void>);
    },
    provideCapability: (token: { id: string }, implementation: unknown) => {
      if (token.id === 'mudd.team-combat.road-encounter.v1') roadCapability = implementation;
    },
    requireCapability: (token: { id: string }) => {
      if (token.id === characterStateCapability.id) {
        const state: CharacterStateCapability = {
          load: vi.fn(async (_context, characterId) => projections.get(characterId)),
        };
        return state;
      }
      if (token.id === teamCombatRosterPolicyCapability.id) return roster;
      throw new Error(`Unexpected capability: ${token.id}`);
    },
    optionalCapability: () => undefined,
  } as never);

  const context = {
    worldInstanceId,
    world: structuredClone(demoWorld),
    session: { playerId: 'player-one' },
    now: () => now,
    makeId: () => `generated-${++nextId}`,
    commandId: 'command-one',
    actorId: 'player-one',
    rng: () => 0.5,
    store: {
      readStream: vi.fn(async (_world: string, streamId: string) =>
        streamId === 'world-team-combat' ? teamHistory : characterHistories.get(streamId) ?? []),
      append: vi.fn(async () => ({ receipt: { ok: true } })),
    },
  };
  return {
    commands,
    queries,
    effects,
    roster,
    roadCapability,
    context,
    setTeamHistory(events: StoredGameEvent[]) { teamHistory = events; },
    setCharacterHistory(characterId: string, events: StoredGameEvent[]) {
      characterHistories.set(characterId, events);
    },
    setProjection(value: ReturnType<typeof player>) {
      projections.set(value.characterId, value);
    },
  };
}

async function startEncounter(test: ReturnType<typeof harness>, npcId = 'mossgate-training-sentinel') {
  const result = await test.commands.get('team.combat.start')!({
    type: 'team.combat.start',
    version: 1,
    commandId: 'start-one',
    worldInstanceId,
    characterId: 'character-one',
    expectedVersion: 0,
    payload: { targetNpcId: npcId },
  }, test.context);
  test.setTeamHistory([stored('team.combat_started', result.events[0].payload)]);
  return result.events[0].payload.encounter;
}

function stored(type: string, payload: Record<string, unknown>): StoredGameEvent {
  return {
    eventId: 'event-one',
    worldInstanceId,
    streamId: 'world-team-combat',
    aggregateId: 'world-team-combat',
    aggregateVersion: 1,
    type,
    version: 1,
    payload,
    causationCommandId: 'command-one',
    actorId: 'player-one',
    occurredAt: now.toISOString(),
    tick: 1,
  } as unknown as StoredGameEvent;
}

function storedCharacter(type: string, payload: Record<string, unknown>, version = 1): StoredGameEvent {
  return {
    eventId: `character-event-${version}`,
    worldInstanceId,
    streamId: 'character-one',
    aggregateId: 'character-one',
    aggregateVersion: version,
    type,
    version: 1,
    payload,
    causationCommandId: `character-command-${version}`,
    actorId: 'player-one',
    occurredAt: now.toISOString(),
    tick: version,
  } as unknown as StoredGameEvent;
}

describe('team combat commands and projections', () => {
  it('starts an encounter with an eligible room opponent and exposes it to the player', async () => {
    const test = harness();
    const start = await test.commands.get('team.combat.start')!({
      type: 'team.combat.start',
      version: 1,
      commandId: 'start-one',
      worldInstanceId,
      characterId: 'character-one',
      expectedVersion: 0,
      payload: { targetNpcId: 'mossgate-training-sentinel' },
    }, test.context);
    expect(start.events[0]).toMatchObject({
      type: 'team.combat_started',
      payload: {
        encounter: {
          status: 'active',
          currentParticipantId: 'character-one',
          participants: expect.arrayContaining([
            expect.objectContaining({
              kind: 'npc',
              npcId: 'mossgate-training-sentinel',
              displayName: 'Practice Sentinel',
            }),
          ]),
        },
      },
    });

    test.setTeamHistory([stored('team.combat_started', start.events[0].payload)]);
    await expect(test.queries.get('team.combat.info')!({
      characterId: 'character-one',
      payload: {},
    }, test.context)).resolves.toMatchObject({
      encounter: { encounterId: expect.stringMatching(/^generated-/), status: 'active' },
    });
    const action = await test.commands.get('team.combat.action')!({
      type: 'team.combat.action',
      version: 1,
      commandId: 'attack-one',
      worldInstanceId,
      characterId: 'character-one',
      expectedVersion: 1,
      payload: {
        encounterId: start.events[0].payload.encounter.encounterId,
        action: 'attack',
      },
    }, test.context);
    expect(action.events[0]).toMatchObject({
      type: 'team.combat_action_resolved',
      payload: { encounter: { round: 2 } },
    });
    expect(action.guards).toEqual([
      expect.objectContaining({ streamId: 'character-one', expectedVersion: 3 }),
    ]);
  });

  it('rejects invalid opponents and ignores malformed road encounter roster requests', async () => {
    const test = harness();
    await expect(test.commands.get('team.combat.start')!({
      characterId: 'character-one',
      payload: { targetNpcId: 'mossgate-wandering-villager' },
    }, test.context)).rejects.toThrow('cannot be fought here');
    const plan = await test.roadCapability.plan(
      test.context,
      player(),
      { id: 'road-bandit' } as any,
      { roadId: 'glasswater-road', segmentIndex: 0, encounterRoll: 1, encounterOccurred: true } as any,
    );
    expect(plan).toBeUndefined();
    expect(test.roster.resolveIfPartyPresent).toHaveBeenCalled();
  });

  it('plans a shared road encounter for present, standing party members', async () => {
    const test = harness();
    const second = CharacterProjectionSchema.parse({
      ...player(),
      characterId: 'character-two',
      name: 'Briar',
      revision: 7,
    });
    test.setProjection(second);
    vi.mocked(test.roster.resolveIfPartyPresent).mockResolvedValue({
      sourceGroupId: 'party-one',
      maxPlayers: 2,
      players: [
        { characterId: second.characterId, playerId: 'player-two', displayName: second.name },
        { characterId: 'character-one', playerId: 'player-one', displayName: 'Aster' },
      ],
    });
    const plan = await test.roadCapability.plan(
      test.context,
      player(),
      {
        id: 'road-bandit',
        name: 'Road Bandit',
        combatProfile: { maxHealth: 5, attackDamage: 2, style: 'heavy' },
      },
      {
        roadId: 'glasswater-road',
        exitId: 'clearing-to-glasswater-road',
        fromLocationId: 'mossgate-clearing',
        toLocationId: 'glasswater-approach',
        segmentIndex: 1,
        encounterRoll: 7,
      },
    );
    expect(plan).toMatchObject({
      streamId: 'world-team-combat',
      events: [{
        type: 'team.road_encounter_started',
        payload: {
          roadTravel: {
            roadId: 'glasswater-road',
            segmentIndex: 1,
            encounterRoll: 7,
          },
          encounter: {
            status: 'active',
            sourceGroupId: 'party-one',
            participants: [
              expect.objectContaining({ characterId: 'character-one', displayName: 'Aster' }),
              expect.objectContaining({ characterId: 'character-two', displayName: 'Briar' }),
              expect.objectContaining({ kind: 'npc', npcId: 'road-bandit', displayName: 'Road Bandit' }),
            ],
          },
        },
      }],
      companions: expect.arrayContaining([
        expect.objectContaining({
          streamId: 'character-one',
          events: expect.arrayContaining([expect.objectContaining({
            type: 'character.vital_recovery_settled',
          })]),
        }),
      ]),
    });
  });

  it('resolves defensive, healing, fleeing, and victory turns with the expected effects', async () => {
    const makeAction = (test: ReturnType<typeof harness>, encounterId: string, action: string, extra = {}) =>
      test.commands.get('team.combat.action')!({
        type: 'team.combat.action',
        version: 1,
        commandId: `action-${action}`,
        worldInstanceId,
        characterId: 'character-one',
        expectedVersion: 1,
        payload: { encounterId, action, ...extra },
      }, test.context);

    const defending = harness();
    const defendEncounter = await startEncounter(defending);
    const defended = await makeAction(defending, defendEncounter.encounterId, 'defend');
    expect(defended.events[0].payload).toMatchObject({
      damageTaken: 0,
      encounter: { round: 2, status: 'active' },
    });

    const healingPlayer = player();
    const healingItem = {
      id: 'small-tonic',
      label: 'Small tonic',
      description: 'A healing tonic.',
      consumable: { effect: 'heal', amount: 2 },
    };
    const withTonic = CharacterProjectionSchema.parse({
      ...healingPlayer,
      inventory: [healingItem],
      health: { current: 3, maximum: 6 },
    });
    const healing = harness(withTonic);
    const healingEncounter = await startEncounter(healing);
    const healed = await makeAction(healing, healingEncounter.encounterId, 'use-item', {
      itemId: healingItem.id,
    });
    expect(healed.events[0].payload).toMatchObject({
      healingDone: 2,
      encounter: { consumedItemIdsByCharacter: { 'character-one': ['small-tonic'] } },
    });
    expect(healed.companions[0].events.map((event: any) => event.type))
      .toContain('character.vital_recovery_settled');

    const fleeing = harness();
    const fleeEncounter = await startEncounter(fleeing);
    const fled = await makeAction(fleeing, fleeEncounter.encounterId, 'flee');
    expect(fled.events.map((event: any) => event.type))
      .toEqual(['team.combat_action_resolved', 'team.combat_ended']);
    expect(fled.effects[0]).toMatchObject({
      type: 'team-combat.apply-outcomes',
      payload: { result: 'fled' },
    });
    expect(fled.companions[0].events.map((event: any) => event.type))
      .toContain('character.stamina_spent');

    const victorious = harness();
    const sentinel = victorious.context.world.locations
      .find((location: any) => location.id === 'mossgate-clearing')?.npcs
      ?.find((npc: any) => npc.id === 'mossgate-training-sentinel');
    if (!sentinel?.combatProfile) throw new Error('Training sentinel fixture is missing its combat profile.');
    sentinel.combatProfile.maxHealth = 1;
    const victoryEncounter = await startEncounter(victorious);
    const victory = await makeAction(victorious, victoryEncounter.encounterId, 'attack');
    expect(victory.events.map((event: any) => event.type))
      .toEqual(['team.combat_action_resolved', 'team.combat_ended']);
    expect(victory.events[1].payload.result).toBe('victory');
    expect(victory.effects.map((effect: any) => effect.type)).toContain('team-combat.apply-outcomes');
  });

  it('applies outcomes to existing characters once and skips missing or archived participants', async () => {
    const test = harness();
    const created = storedCharacter('character.created', {
      characterId: 'character-one',
      playerId: 'player-one',
      name: 'Aster',
      startingLocationId: 'mossgate-clearing',
    });
    test.setCharacterHistory('character-one', [created]);
    const apply = test.effects.get('team-combat.apply-outcomes')!;
    const payload = {
      encounterId: 'encounter-one',
      locationId: 'mossgate-clearing',
      result: 'victory',
      players: [{
        characterId: 'character-one',
        health: 6,
        maximumHealth: 6,
        consumedItemIds: [],
      }],
    };
    const effectContext = {
      ...test.context,
      effectId: 'outcome-effect-one',
      append: undefined,
    };
    await apply(payload, effectContext);
    const append = test.context.store.append as ReturnType<typeof vi.fn>;
    expect(append).toHaveBeenCalledTimes(1);
    const outcomeEvents = append.mock.calls[0]?.[0]?.events ?? [];
    expect(outcomeEvents.map((event: any) => event.type))
      .toContain('character.team_combat_outcome_applied');
    expect(outcomeEvents.map((event: any) => event.type))
      .toContain('character.advancement_awarded');

    test.setCharacterHistory('character-one', [
      created,
      storedCharacter('character.team_combat_outcome_applied', { encounterId: 'encounter-one' }, 2),
    ]);
    await apply(payload, effectContext);
    expect(append).toHaveBeenCalledTimes(1);
    await apply({ ...payload, players: [{ ...payload.players[0], characterId: 'missing-character' }] }, effectContext);
    expect(append).toHaveBeenCalledTimes(1);

    test.setCharacterHistory('character-one', [
      created,
      storedCharacter('character.archived', { characterId: 'character-one' }, 2),
    ]);
    await apply(payload, effectContext);
    expect(append).toHaveBeenCalledTimes(1);
  });
});
