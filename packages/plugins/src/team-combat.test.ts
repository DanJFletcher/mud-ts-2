import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema } from '@mudd/contracts';
import type { StoredGameEvent } from '@mudd/engine-core';
import { demoWorld } from '@mudd/world-demo';
import {
  characterStateCapability,
  type CharacterStateCapability,
} from './character.js';
import { combatRoomPresenceCapability } from './combat-presence.js';
import {
  teamCombatRosterPolicyCapability,
  type TeamCombatRosterPolicy,
} from './team-combat-policy.js';
import type { ClassCombatPolicy } from './classes.js';
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
  let classCombatPolicy: ClassCombatPolicy | undefined;
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
  const roomPresence = {
    listActiveCharacters: vi.fn(async () => []),
    getPresenceAnchors: vi.fn(async (_worldInstanceId: string, characterIds: readonly string[]) =>
      new Map(characterIds.map((characterId) => [characterId, now]))),
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
      if (token.id === combatRoomPresenceCapability.id) return roomPresence;
      throw new Error(`Unexpected capability: ${token.id}`);
    },
    optionalCapability: () => classCombatPolicy,
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
    roomPresence,
    roadCapability,
    context,
    setTeamHistory(events: StoredGameEvent[]) { teamHistory = events; },
    setCharacterHistory(characterId: string, events: StoredGameEvent[]) {
      characterHistories.set(characterId, events);
    },
    setProjection(value: ReturnType<typeof player>) {
      projections.set(value.characterId, value);
    },
    removeProjection(characterId: string) {
      projections.delete(characterId);
    },
    setClassCombatPolicy(value: ClassCombatPolicy) {
      classCombatPolicy = value;
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

  it('rejects road encounters with invalid, active, absent, or exhausted party members', async () => {
    const opponent = {
      id: 'road-bandit',
      name: 'Road Bandit',
      combatProfile: { maxHealth: 5, attackDamage: 2, style: 'steady' as const },
    };
    const roadTravel = {
      roadId: 'glasswater-road',
      exitId: 'clearing-to-glasswater-road',
      fromLocationId: 'mossgate-clearing',
      toLocationId: 'glasswater-approach',
      segmentIndex: 1,
      encounterRoll: 7,
    };
    const partyRoster = {
      sourceGroupId: 'party-one',
      maxPlayers: 2,
      players: [
        { characterId: 'character-one', playerId: 'player-one', displayName: 'Aster' },
        { characterId: 'character-two', playerId: 'player-two', displayName: 'Briar' },
      ],
    };

    const invalidLimit = harness();
    vi.mocked(invalidLimit.roster.resolveIfPartyPresent).mockResolvedValue({
      ...partyRoster,
      maxPlayers: 1,
    });
    await expect(invalidLimit.roadCapability.plan(
      invalidLimit.context,
      player(),
      opponent,
      roadTravel,
    )).rejects.toThrow('not enough eligible party members');

    const activeMember = harness();
    vi.mocked(activeMember.roster.resolveIfPartyPresent).mockResolvedValue(partyRoster);
    await startEncounter(activeMember);
    await expect(activeMember.roadCapability.plan(
      activeMember.context,
      player(),
      opponent,
      roadTravel,
    )).rejects.toThrow('already participating');

    const tiredMember = harness();
    const tired = CharacterProjectionSchema.parse({
      ...player(),
      characterId: 'character-two',
      name: 'Briar',
      resources: {
        ...player().resources,
        stamina: { ...player().resources.stamina, current: 0 },
      },
      staminaRecovery: { ...player().staminaRecovery, lastSettledAt: now.toISOString() },
    });
    tiredMember.setProjection(tired);
    vi.mocked(tiredMember.roster.resolveIfPartyPresent).mockResolvedValue(partyRoster);
    await expect(tiredMember.roadCapability.plan(
      tiredMember.context,
      player(),
      opponent,
      roadTravel,
    )).rejects.toThrow('stamina to take this road step');

    const missingInitiator = harness();
    const second = CharacterProjectionSchema.parse({
      ...player(),
      characterId: 'character-two',
      name: 'Briar',
    });
    const third = CharacterProjectionSchema.parse({
      ...player(),
      characterId: 'character-three',
      name: 'Rowan',
    });
    missingInitiator.setProjection(second);
    missingInitiator.setProjection(third);
    vi.mocked(missingInitiator.roster.resolveIfPartyPresent).mockResolvedValue({
      sourceGroupId: 'party-two',
      maxPlayers: 3,
      players: [
        { characterId: 'character-two', playerId: 'player-two', displayName: 'Briar' },
        { characterId: 'character-three', playerId: 'player-three', displayName: 'Rowan' },
      ],
    });
    await expect(missingInitiator.roadCapability.plan(
      missingInitiator.context,
      player(),
      opponent,
      roadTravel,
    )).rejects.toThrow('You must be present with your party');

    const displacedMember = harness();
    displacedMember.setProjection(CharacterProjectionSchema.parse({
      ...player(),
      characterId: 'character-two',
      name: 'Briar',
      locationId: 'stillwater-path',
    }));
    vi.mocked(displacedMember.roster.resolveIfPartyPresent).mockResolvedValue(partyRoster);
    await expect(displacedMember.roadCapability.plan(
      displacedMember.context,
      player(),
      opponent,
      roadTravel,
    )).rejects.toThrow('no longer in this room');
  });

  it('settles each road-travel party member against their own presence anchor', async () => {
    const test = harness();
    const previousSettlement = new Date(now.getTime() - 20_000);
    const companion = CharacterProjectionSchema.parse({
    ...player(),
    characterId: 'character-two',
    name: 'Briar',
    resources: {
      ...player().resources,
      stamina: { current: 0, maximum: 100 },
    },
    staminaRecovery: {
      ...player().staminaRecovery,
      lastSettledAt: previousSettlement.toISOString(),
    },
    });
    test.setProjection(companion);
    vi.mocked(test.roster.resolveIfPartyPresent).mockResolvedValue({
    sourceGroupId: 'party-one',
    maxPlayers: 2,
    players: [
      { characterId: 'character-one', playerId: 'player-one', displayName: 'Aster' },
      { characterId: 'character-two', playerId: 'player-two', displayName: 'Briar' },
    ],
    });
    const companionHeartbeat = new Date(now.getTime() - 10_000);
    vi.mocked(test.roomPresence.getPresenceAnchors).mockResolvedValue(new Map([
    ['character-one', new Date(now.getTime() - 60_000)],
    ['character-two', companionHeartbeat],
    ]));

    const plan = await test.roadCapability.plan({
    ...test.context,
    presenceAnchorAt: new Date(now.getTime() - 60_000),
    }, player(), {
    id: 'road-bandit',
    name: 'Road Bandit',
    combatProfile: { maxHealth: 5, attackDamage: 2, style: 'steady' },
    }, {
    roadId: 'glasswater-road',
    exitId: 'clearing-to-glasswater-road',
    fromLocationId: 'mossgate-clearing',
    toLocationId: 'glasswater-approach',
    segmentIndex: 1,
    encounterRoll: 7,
    });
    const companionRecovery = plan?.companions?.find((write: any) =>
    write.streamId === 'character-two')?.events[0];

    expect(companionRecovery).toMatchObject({
    type: 'character.vital_recovery_settled',
    payload: {
      resources: { stamina: { current: 20, maximum: 100 } },
      recovery: { lastSettledAt: now.toISOString() },
    },
    });
    expect(companionRecovery.payload.settledAt).toBeUndefined();
    expect(test.roomPresence.getPresenceAnchors).toHaveBeenCalledWith(
    worldInstanceId,
    ['character-one', 'character-two'],
    );
  });

  it('rejects active encounters, invalid rosters, and party members who are no longer present', async () => {
    const active = harness();
    await startEncounter(active);
    await expect(active.commands.get('team.combat.start')!({
      characterId: 'character-one',
      payload: { targetNpcId: 'mossgate-training-sentinel' },
    }, active.context)).rejects.toThrow('already participating');

    const invalidRoster = harness();
    vi.mocked(invalidRoster.roster.resolve).mockResolvedValue({ maxPlayers: 0, players: [] });
    await expect(invalidRoster.commands.get('team.combat.start')!({
      characterId: 'character-one',
      payload: { targetNpcId: 'mossgate-training-sentinel' },
    }, invalidRoster.context)).rejects.toThrow('no eligible party members');

    const missingMember = harness();
    vi.mocked(missingMember.roster.resolve).mockResolvedValue({
      maxPlayers: 2,
      players: [
        { characterId: 'character-one', playerId: 'player-one', displayName: 'Aster' },
        { characterId: 'missing-character', playerId: 'player-two', displayName: 'Briar' },
      ],
    });
    await expect(missingMember.commands.get('team.combat.start')!({
      characterId: 'character-one',
      payload: { targetNpcId: 'mossgate-training-sentinel' },
    }, missingMember.context)).rejects.toThrow('no longer in this room');

    const archived = harness(CharacterProjectionSchema.parse({ ...player(), archived: true }));
    await expect(archived.commands.get('team.combat.start')!({
      characterId: 'character-one',
      payload: { targetNpcId: 'mossgate-training-sentinel' },
    }, archived.context)).rejects.toThrow('character is no longer available');
  });

  it('rejects actions outside an active turn or for an inactive participant', async () => {
    const test = harness();
    const action = test.commands.get('team.combat.action')!;
    const command = {
      characterId: 'character-one',
      payload: { encounterId: 'missing-encounter', action: 'attack' },
    };
    await expect(action(command, test.context)).rejects.toThrow('no longer active');

    const encounter = await startEncounter(test);
    await expect(action({
      ...command,
      characterId: 'character-two',
      payload: { encounterId: encounter.encounterId, action: 'attack' },
    }, test.context)).rejects.toThrow('not your turn');

    test.setTeamHistory([stored('team.combat_started', {
      encounter: {
        ...encounter,
        participants: encounter.participants.map((participant: any) =>
          participant.characterId === 'character-one'
            ? { ...participant, status: 'defeated' }
            : participant,
        ),
      },
    })]);
    await expect(action({
      ...command,
      payload: { encounterId: encounter.encounterId, action: 'attack' },
    }, test.context)).rejects.toThrow('cannot act in this encounter');
  });

  it('rejects a combat turn when the acting character has been archived', async () => {
    const test = harness();
    const encounter = await startEncounter(test);
    test.setProjection(CharacterProjectionSchema.parse({ ...player(), archived: true }));
    await expect(test.commands.get('team.combat.action')!({
      characterId: 'character-one',
      payload: { encounterId: encounter.encounterId, action: 'defend' },
    }, test.context)).rejects.toThrow('character is no longer available');
  });

  it('runs class adoption guards for combat starts and actions when classes are enabled', async () => {
    const test = harness();
    test.context.world.classCatalog = {} as any;
    const encounter = await startEncounter(test);
    const action = await test.commands.get('team.combat.action')!({
      characterId: 'character-one',
      payload: { encounterId: encounter.encounterId, action: 'defend' },
    }, test.context);
    expect(action.guards).toEqual(expect.arrayContaining([
      expect.objectContaining({ streamId: 'world-team-combat' }),
    ]));

    test.setProjection(CharacterProjectionSchema.parse({
      ...player(),
      combat: {
        status: 'active',
        encounterId: 'another-encounter',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'another-opponent',
        opponentName: 'Another opponent',
        round: 1,
        playerHealth: 6,
        playerMaxHealth: 6,
        opponentHealth: 6,
        opponentMaxHealth: 6,
        lastAction: 'attack',
        lastNarration: 'Already fighting.',
      },
    }));
    await expect(test.commands.get('team.combat.action')!({
      characterId: 'character-one',
      payload: { encounterId: encounter.encounterId, action: 'defend' },
    }, test.context)).rejects.toThrow('Another combat encounter is active');
  });

  it('rejects party encounters when a member is already fighting or no longer available', async () => {
    const second = CharacterProjectionSchema.parse({
      ...player(),
      characterId: 'character-two',
      name: 'Briar',
    });
    const activeCombat = {
      status: 'active',
      encounterId: 'another-encounter',
      locationId: 'mossgate-clearing',
      opponentNpcId: 'another-opponent',
      opponentName: 'Another opponent',
      round: 1,
      playerHealth: 6,
      playerMaxHealth: 6,
      opponentHealth: 6,
      opponentMaxHealth: 6,
      lastAction: 'attack',
      lastNarration: 'Already fighting.',
    };
    const roster = {
      sourceGroupId: 'party-one',
      maxPlayers: 2,
      players: [
        { characterId: 'character-one', playerId: 'player-one', displayName: 'Aster' },
        { characterId: 'character-two', playerId: 'player-two', displayName: 'Briar' },
      ],
    };

    const blockedStart = harness();
    blockedStart.context.world.classCatalog = {} as any;
    blockedStart.setProjection(CharacterProjectionSchema.parse({ ...second, combat: activeCombat }));
    vi.mocked(blockedStart.roster.resolve).mockResolvedValue(roster);
    await expect(blockedStart.commands.get('team.combat.start')!({
      characterId: 'character-one',
      payload: { targetNpcId: 'mossgate-training-sentinel' },
    }, blockedStart.context)).rejects.toThrow('A party member is already in combat.');

    const unavailable = harness();
    unavailable.setProjection(second);
    vi.mocked(unavailable.roster.resolve).mockResolvedValue(roster);
    const unavailableEncounter = await startEncounter(unavailable);
    unavailable.removeProjection('character-two');
    await expect(unavailable.commands.get('team.combat.action')!({
      characterId: 'character-one',
      payload: { encounterId: unavailableEncounter.encounterId, action: 'defend' },
    }, unavailable.context)).rejects.toThrow('A party member is no longer available.');
  });

  it('resolves class combat abilities through the registered class policy', async () => {
    const test = harness();
    const policy = {
      catalog: {} as any,
      select: vi.fn(),
      resolve: vi.fn(() => ({
        damage: 3,
        event: {
          type: 'character.class_ability_used',
          version: 1,
          payload: { characterId: 'character-one', abilityId: 'quick-strike' },
        },
      })),
    } as unknown as ClassCombatPolicy;
    test.setClassCombatPolicy(policy);
    const encounter = await startEncounter(test);
    const result = await test.commands.get('team.combat.action')!({
      characterId: 'character-one',
      payload: {
        encounterId: encounter.encounterId,
        action: 'ability',
        abilityId: 'quick-strike',
      },
    }, test.context);
    expect(policy.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'character-one' }),
      'quick-strike',
      encounter.encounterId,
      'command-one',
    );
    expect(result.companions[0].events).toContainEqual(expect.objectContaining({
      type: 'character.class_ability_used',
    }));
  });

  it('records party defeats after synchronizing member health and a heavy strike', async () => {
    const test = harness();
    const second = CharacterProjectionSchema.parse({
      ...player(),
      characterId: 'character-two',
      name: 'Briar',
    });
    test.setProjection(second);
    vi.mocked(test.roster.resolve).mockResolvedValue({
      sourceGroupId: 'party-one',
      maxPlayers: 2,
      players: [
        { characterId: 'character-one', playerId: 'player-one', displayName: 'Aster' },
        { characterId: 'character-two', playerId: 'player-two', displayName: 'Briar' },
      ],
    });
    const sentinel = test.context.world.locations
      .find((location: any) => location.id === 'mossgate-clearing')?.npcs
      ?.find((npc: any) => npc.id === 'mossgate-training-sentinel');
    if (!sentinel?.combatProfile) throw new Error('Training sentinel fixture is missing its combat profile.');
    sentinel.combatProfile.attackDamage = 100;

    const start = await test.commands.get('team.combat.start')!({
      characterId: 'character-one',
      payload: { targetNpcId: sentinel.id },
    }, test.context);
    const encounter = start.events[0].payload.encounter;
    test.setTeamHistory([stored('team.combat_started', {
      encounter: {
        ...encounter,
        participants: encounter.participants.map((participant: any) =>
          participant.characterId === 'character-two'
            ? { ...participant, health: 1, characterHealthAnchor: 1 }
            : participant,
        ),
      },
    })]);
    test.setProjection(CharacterProjectionSchema.parse({
      ...second,
      health: { current: 0, maximum: 6 },
    }));

    const action = await test.commands.get('team.combat.action')!({
      characterId: 'character-one',
      payload: { encounterId: encounter.encounterId, action: 'defend' },
    }, test.context);
    expect(action.events.at(-1)?.payload).toMatchObject({ result: 'defeat' });
  });

  it('rejects victory resolution when the defeated opponent is no longer in the world', async () => {
    const test = harness();
    const encounter = await startEncounter(test);
    test.setTeamHistory([stored('team.combat_started', {
      encounter: {
        ...encounter,
        participants: encounter.participants.map((participant: any) =>
          participant.kind === 'npc'
            ? { ...participant, health: 0, status: 'defeated' }
            : participant,
        ),
      },
    })]);
    test.context.world.locations
      .find((location: any) => location.id === encounter.locationId)!.npcs = [];

    await expect(test.commands.get('team.combat.action')!({
      characterId: 'character-one',
      payload: { encounterId: encounter.encounterId, action: 'defend' },
    }, test.context)).rejects.toThrow('The defeated opponent is no longer available.');
  });

  it('rejects unavailable combat items, unsupported abilities, low-stamina fleeing, and absent enemies', async () => {
    const attackOrAction = async (
      test: ReturnType<typeof harness>,
      encounterId: string,
      actionName: string,
      extra: Record<string, unknown> = {},
    ) => test.commands.get('team.combat.action')!({
      characterId: 'character-one',
      payload: { encounterId, action: actionName, ...extra },
    }, test.context);

    const missingItem = harness();
    const itemEncounter = await startEncounter(missingItem);
    await expect(attackOrAction(missingItem, itemEncounter.encounterId, 'use-item', {
      itemId: 'not-carried',
    })).rejects.toThrow('not available to use');

    const fullHealthTonic = {
      id: 'full-health-tonic',
      label: 'Full health tonic',
      description: 'A bottle of medicine.',
      consumable: { effect: 'heal', amount: 2 },
    };
    const healthyPlayer = CharacterProjectionSchema.parse({
      ...player(),
      inventory: [fullHealthTonic],
    });
    const alreadyWell = harness(healthyPlayer);
    const healthyEncounter = await startEncounter(alreadyWell);
    await expect(attackOrAction(alreadyWell, healthyEncounter.encounterId, 'use-item', {
      itemId: fullHealthTonic.id,
    })).rejects.toThrow('health is already full');

    const tiredPlayer = CharacterProjectionSchema.parse({
      ...player(),
      resources: {
        ...player().resources,
        stamina: { ...player().resources.stamina, current: 0 },
      },
      staminaRecovery: {
        ...player().staminaRecovery,
        lastSettledAt: now.toISOString(),
      },
    });
    const tired = harness(tiredPlayer);
    const tiredEncounter = await startEncounter(tired);
    await expect(attackOrAction(tired, tiredEncounter.encounterId, 'flee'))
      .rejects.toThrow('stamina to flee');

    const noAbilityPolicy = harness();
    const policyEncounter = await startEncounter(noAbilityPolicy);
    await expect(attackOrAction(noAbilityPolicy, policyEncounter.encounterId, 'ability', {
      abilityId: 'unavailable-ability',
    })).rejects.toThrow('ABILITY_UNSUPPORTED');

    const noEnemy = harness();
    const encounter = await startEncounter(noEnemy);
    noEnemy.setTeamHistory([stored('team.combat_started', {
      encounter: {
        ...encounter,
        participants: encounter.participants.map((participant: any) =>
          participant.kind === 'npc' ? { ...participant, status: 'defeated' } : participant,
        ),
      },
    })]);
    await expect(attackOrAction(noEnemy, encounter.encounterId, 'attack'))
      .rejects.toThrow('no active enemy');

    const missingOpponent = harness();
    const opponentEncounter = await startEncounter(missingOpponent);
    missingOpponent.context.world.locations
      .find((location: any) => location.id === opponentEncounter.locationId)!.npcs = [];
    await expect(attackOrAction(missingOpponent, opponentEncounter.encounterId, 'attack'))
      .rejects.toThrow('opponent is no longer available');
  });

  it('plans a shared road encounter for present, standing party members', async () => {
    const test = harness();
    test.context.world.classCatalog = {} as any;
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

    test.setProjection(CharacterProjectionSchema.parse({ ...second, combat: {
      status: 'active',
      encounterId: 'another-encounter',
      locationId: 'mossgate-clearing',
      opponentNpcId: 'another-opponent',
      opponentName: 'Another opponent',
      round: 1,
      playerHealth: 6,
      playerMaxHealth: 6,
      opponentHealth: 6,
      opponentMaxHealth: 6,
      lastAction: 'attack',
      lastNarration: 'Already fighting.',
    } }));
    await expect(test.roadCapability.plan(
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
    )).rejects.toThrow('A party member is already in combat.');
    test.setProjection(second);

    test.setTeamHistory([stored('team.road_encounter_started', plan.events[0]!.payload)]);
    await expect(test.queries.get('team.combat.info')!({
      characterId: 'character-one',
      payload: {},
    }, test.context)).resolves.toMatchObject({
      encounter: { status: 'active' },
      roadTravel: plan.events[0]!.payload.roadTravel,
    });

    const roadDefinition = test.context.world.roads
      .find((candidate: any) => candidate.id === 'glasswater-road') as any;
    roadDefinition.encounters = [{
      id: 'road-bandit',
      name: 'Road Bandit',
      combatProfile: { maxHealth: 5, attackDamage: 2, style: 'steady' },
    }];
    const roadAction = await test.commands.get('team.combat.action')!({
      characterId: 'character-one',
      payload: {
        encounterId: plan.events[0]!.payload.encounter.encounterId,
        action: 'attack',
      },
    }, test.context);
    expect(roadAction.events[0].payload).toMatchObject({
      actingCharacterId: 'character-one',
      action: 'attack',
      encounter: { currentParticipantId: 'character-two' },
    });

    test.setCharacterHistory('character-one', [storedCharacter('character.created', {
      characterId: 'character-one',
      playerId: 'player-one',
      name: 'Aster',
      startingLocationId: 'mossgate-clearing',
    })]);
    await test.effects.get('team-combat.apply-outcomes')!({
      encounterId: 'road-victory',
      locationId: 'mossgate-clearing',
      result: 'victory',
      roadTravel: plan.events[0]!.payload.roadTravel,
      players: [{
        characterId: 'character-one',
        health: 6,
        maximumHealth: 6,
        consumedItemIds: [],
      }],
    }, { ...test.context, effectId: 'road-victory-effect' });
    const moved = (test.context.store.append as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(moved.events.map((event: any) => event.type)).toContain('character.moved');
    expect(moved.effects.map((effect: any) => effect.type)).toEqual([
      'world.location.entered',
      'engine.domain_event_dispatch',
    ]);
  });

  it('advances turns across party members and stands a resting ally after a heavy blow', async () => {
    const test = harness();
    const second = CharacterProjectionSchema.parse({
      ...player(),
      characterId: 'character-two',
      name: 'Briar',
      revision: 4,
    });
    test.setProjection(second);
    vi.mocked(test.roster.resolve).mockResolvedValue({
      sourceGroupId: 'party-one',
      maxPlayers: 2,
      players: [
        { characterId: 'character-one', playerId: 'player-one', displayName: 'Aster' },
        { characterId: 'character-two', playerId: 'player-two', displayName: 'Briar' },
      ],
    });
    const sentinel = test.context.world.locations
      .find((location: any) => location.id === 'mossgate-clearing')?.npcs
      ?.find((npc: any) => npc.id === 'mossgate-training-sentinel');
    if (!sentinel?.combatProfile) throw new Error('Training sentinel fixture is missing its combat profile.');
    sentinel.combatProfile.attackDamage = 100;
    sentinel.combatProfile.style = 'steady';

    const start = await test.commands.get('team.combat.start')!({
      characterId: 'character-one',
      payload: { targetNpcId: sentinel.id },
    }, test.context);
    const startedEvent = stored('team.combat_started', start.events[0].payload);
    const encounter = start.events[0].payload.encounter;
    test.setTeamHistory([startedEvent]);
    const firstTurn = await test.commands.get('team.combat.action')!({
      characterId: 'character-one',
      payload: { encounterId: encounter.encounterId, action: 'defend' },
    }, test.context);
    expect(firstTurn.events[0].payload.encounter.currentParticipantId).toBe('character-two');
    test.setTeamHistory([
      startedEvent,
      stored('team.combat_action_resolved', firstTurn.events[0].payload),
    ]);

    test.setProjection(CharacterProjectionSchema.parse({
      ...player(),
      staminaRecovery: {
        ...player().staminaRecovery,
        posture: 'resting',
      },
    }));
    const secondTurn = await test.commands.get('team.combat.action')!({
      characterId: 'character-two',
      payload: { encounterId: encounter.encounterId, action: 'defend' },
    }, test.context);
    expect(secondTurn.events[0].payload).toMatchObject({
      damageTaken: 6,
      encounter: {
        status: 'active',
        currentParticipantId: 'character-two',
        participants: expect.arrayContaining([
          expect.objectContaining({ characterId: 'character-one', status: 'defeated' }),
        ]),
      },
    });
    expect(secondTurn.companions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        streamId: 'character-one',
        events: [expect.objectContaining({
          type: 'character.posture_changed',
          payload: expect.objectContaining({ posture: 'standing' }),
        })],
      }),
    ]));
    const projected = await test.queries.get('team.combat.info')!({
      characterId: 'character-one',
      payload: {},
    }, {
      ...test.context,
      store: {
        ...test.context.store,
        readStream: vi.fn(async () => [
          startedEvent,
          stored('team.combat_action_resolved', firstTurn.events[0].payload),
          stored('team.combat_action_resolved', secondTurn.events[0].payload),
        ]),
      },
    });
    expect(projected).toMatchObject({
      encounter: { participants: expect.arrayContaining([
        expect.objectContaining({ characterId: 'character-one', status: 'defeated' }),
      ]) },
    });
  });

  it('respawns a party member defeated when combat outcomes are applied', async () => {
    const test = harness();
    const created = storedCharacter('character.created', {
      characterId: 'character-one',
      playerId: 'player-one',
      name: 'Aster',
      startingLocationId: 'mossgate-clearing',
    });
    test.setCharacterHistory('character-one', [created]);
    test.context.world.respawn = { locationId: 'mossgate-clearing' };
    const apply = test.effects.get('team-combat.apply-outcomes')!;
    await apply({
      encounterId: 'encounter-defeat',
      locationId: 'mossgate-clearing',
      result: 'defeat',
      players: [{
        characterId: 'character-one',
        health: 0,
        maximumHealth: 6,
        consumedItemIds: [],
      }],
    }, { ...test.context, effectId: 'defeat-respawn-effect' });
    const append = test.context.store.append as ReturnType<typeof vi.fn>;
    expect(append).toHaveBeenCalledOnce();
    expect(append.mock.calls[0]?.[0].events.map((event: any) => event.type))
      .toContain('character.respawned');
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

  it('rejects outcome application after a character leaves the encounter room', async () => {
    const test = harness();
    const createdElsewhere = storedCharacter('character.created', {
      characterId: 'character-one',
      playerId: 'player-one',
      name: 'Aster',
      startingLocationId: 'stillwater-path',
    });
    test.setCharacterHistory('character-one', [createdElsewhere]);
    const apply = test.effects.get('team-combat.apply-outcomes')!;
    await expect(apply({
      encounterId: 'encounter-one',
      locationId: 'mossgate-clearing',
      result: 'victory',
      players: [{
        characterId: 'character-one',
        health: 6,
        maximumHealth: 6,
        consumedItemIds: [],
      }],
    }, { ...test.context, effectId: 'stale-location-effect' }))
      .rejects.toThrow('changed locations');
  });
});
