import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EngineHost, InMemoryEventStore, replayCharacter, type EnginePlugin } from './index.js';
import {
  characterPlugin,
  combatPlugin,
  combatRoomPresenceCapability,
  groupsPlugin,
  interactionPlugin,
  movementPlugin,
  partyCombatPolicyPlugin,
  partyPlugin,
  partyQuestPlugin,
  projectGroups,
  worldItemsPlugin,
  teamCombatPlugin,
  type ActiveRoomCharacter,
} from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import type { CapabilityToken } from '@mudd/contracts';
import { TeamCombatInfoProjectionSchema } from '@mudd/contracts';

const session = {
  sessionId: 'session-1',
  playerId: 'player-1',
  actorId: 'player-1',
  worldInstanceId: DEMO_WORLD_INSTANCE_ID,
  grantedPermissions: [],
  authenticated: true,
} as const;
const authorization = {
  canAccessInstance: async () => true,
  ownsCharacter: async () => true,
};
let activeTestRoomCharacters: ActiveRoomCharacter[] = [];
const testCombatPresencePlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.room-combat-presence',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    provides: [combatRoomPresenceCapability.id],
  },
  register({ provideCapability }) {
    provideCapability(combatRoomPresenceCapability, {
      listActiveCharacters: async () => activeTestRoomCharacters,
    });
  },
};

function makeEngine(world = demoWorld) {
  let id = 0;
  const store = new InMemoryEventStore();
  const engine = new EngineHost(
    [worldItemsPlugin, movementPlugin, characterPlugin, groupsPlugin, partyPlugin, partyQuestPlugin],
    store,
    authorization,
    world,
    () => `test-id-${++id}`,
    () => new Date('2026-10-17T12:00:00.000Z'),
  );
  return { engine, store };
}

describe('MUDD engine host', () => {
  it('returns generic internal failures with a request-correlatable ID', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const lookup = vi.spyOn(store, 'lookupCommand').mockRejectedValue(new Error('database password must not reach clients'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'internal-error-command',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session, 'request-correlation-id');

    expect(result.receipt).toMatchObject({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'The server could not complete that command.',
    });
    expect(result.receipt.message).not.toContain('password');
    expect(result.correlationId).toBe('request-correlation-id');
    expect(log).toHaveBeenCalledWith(
      '[request-correlation-id] Engine command failed',
      expect.any(Error),
    );

    lookup.mockRestore();
    log.mockRestore();
    await engine.stop();
  });

  it('registers typed commands and capabilities before initializing a plugin', async () => {
    let initialized = false;
    const testCapability = { id: 'mudd.test.capability.v1', version: '1' } satisfies CapabilityToken<{ ready: boolean }>;
    const plugin: EnginePlugin = {
      manifest: {
        id: 'mudd.lifecycle-test',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
        provides: ['mudd.test.capability.v1'],
      },
      register(context) {
        context.provideCapability(testCapability, { ready: true });
        const capability = context.requireCapability<{ ready: boolean }>(testCapability);
        context.registerCommand('test.echo', z.object({
          type: z.literal('test.echo'),
          version: z.literal(1),
          commandId: z.string(),
          worldInstanceId: z.string(),
          payload: z.object({ text: z.string() }),
        }), async (command) => ({
          streamId: 'plugin-test-character',
          expectedVersion: 0,
          events: [{
            type: 'test.echoed',
            version: 1,
            payload: { text: command.payload.text, capabilityReady: capability.ready },
          }],
        }));
      },
      async initialize() { initialized = true; },
    };
    const engine = new EngineHost([plugin], new InMemoryEventStore(), authorization, demoWorld);
    expect(initialized).toBe(false);
    await expect(engine.start()).resolves.toBeUndefined();
    expect(initialized).toBe(true);
    const result = await engine.dispatch({
      type: 'test.echo',
      version: 1,
      commandId: 'echo-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { text: 'registered' },
    }, session);
    expect(result.receipt.ok).toBe(true);
    expect(result.events[0]?.payload).toEqual({ text: 'registered', capabilityReady: true });
    await expect(engine.stop()).resolves.toBeUndefined();
  });

  it('retries versioned durable effects without duplicating a command effect', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let attempts = 0;
    let successfulDeliveries = 0;
    const effectPlugin: EnginePlugin = {
      manifest: {
        id: 'mudd.effect-test',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
      },
      register(context) {
        context.registerCommand('test.effect-command', z.object({
          type: z.literal('test.effect-command'),
          version: z.literal(1),
          commandId: z.string(),
          worldInstanceId: z.string(),
        }), async () => ({
          streamId: 'effect-test-stream',
          expectedVersion: 0,
          events: [{ type: 'test.effect-commanded', version: 1, payload: {} }],
          effects: [{ type: 'test.delivery', version: 1, payload: { value: 'persisted' } }],
        }));
        context.registerEffect('test.delivery', 1, z.object({ value: z.string() }), async (payload) => {
          attempts += 1;
          if (attempts === 1) throw new Error('temporary delivery failure');
          expect(payload.value).toBe('persisted');
          successfulDeliveries += 1;
        });
      },
    };
    const store = new InMemoryEventStore();
    const engine = new EngineHost([effectPlugin], store, authorization, demoWorld);
    await engine.start();
    const command = {
      type: 'test.effect-command',
      version: 1,
      commandId: 'effect-command-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
    };
    expect((await engine.dispatch(command, session)).receipt.ok).toBe(true);
    expect((await engine.dispatch(command, session)).commitOutcome).toBe('duplicate');

    expect(await engine.processPendingEffects()).toBe(1);
    expect(successfulDeliveries).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await engine.processPendingEffects()).toBe(1);
    expect(successfulDeliveries).toBe(1);
    expect(await engine.processPendingEffects()).toBe(0);

    await engine.stop();
    log.mockRestore();
    vi.useRealTimers();
  });

  it('dispatches committed domain events to subscribers through the durable outbox', async () => {
    const subscriber = vi.fn(async (_payload: { value: string }, _context: { actorId: string }) => undefined);
    const plugin: EnginePlugin = {
      manifest: {
        id: 'mudd.event-subscriber-test',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
      },
      register(context) {
        context.registerCommand('test.publish-event', z.object({
          type: z.literal('test.publish-event'),
          version: z.literal(1),
          commandId: z.string(),
          worldInstanceId: z.string(),
        }), async () => ({
          streamId: 'published-events',
          expectedVersion: 0,
          events: [{ type: 'test.published', version: 1, payload: { value: 'committed' } }],
        }));
        context.registerEventHandler(
          'test.published',
          1,
          z.object({ value: z.string() }),
          subscriber,
        );
      },
    };
    const engine = new EngineHost([plugin], new InMemoryEventStore(), authorization, demoWorld);
    await engine.start();
    const command = {
      type: 'test.publish-event',
      version: 1,
      commandId: 'publish-event-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
    };

    expect((await engine.dispatch(command, session)).receipt.ok).toBe(true);
    expect((await engine.dispatch(command, session)).commitOutcome).toBe('duplicate');
    expect(await engine.processPendingEffects()).toBe(1);
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith(
      { value: 'committed' },
      expect.objectContaining({
        actorId: session.playerId,
        sourceStreamId: 'published-events',
      }),
    );
    expect(await engine.processPendingEffects()).toBe(0);
    await engine.stop();
  });

  it('enforces public-party capacity and one active party per player', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const players = Array.from({ length: 5 }, (_, index) => ({
      ...session,
      sessionId: `party-session-${index + 1}`,
      playerId: `party-player-${index + 1}`,
      actorId: `party-player-${index + 1}`,
    }));
    const characters: string[] = [];

    for (const [index, player] of players.entries()) {
      const created = await engine.dispatch({
        type: 'character.create',
        version: 1,
        commandId: `party-character-${index + 1}`,
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        payload: { name: `Traveler ${index + 1}` },
      }, player);
      expect(created.receipt.ok).toBe(true);
      characters.push(created.streamId!);
    }

    const createParty = async (playerIndex: number, commandId: string) => engine.dispatch({
      type: 'party.create',
      version: 1,
      commandId,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: characters[playerIndex],
      payload: {},
    }, players[playerIndex]!);
    const createdParty = await createParty(0, 'party-create');
    expect(createdParty.receipt.ok).toBe(true);
    const partyId = projectGroups(await store.readStream(DEMO_WORLD_INSTANCE_ID, 'world-groups')).groups[0]!.groupId;

    for (let index = 1; index <= 3; index += 1) {
      const joined = await engine.dispatch({
        type: 'party.join',
        version: 1,
        commandId: `party-join-${index}`,
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        characterId: characters[index],
        payload: { groupId: partyId },
      }, players[index]!);
      expect(joined.receipt.ok).toBe(true);
    }
    const fullPartyJoin = await engine.dispatch({
      type: 'party.join',
      version: 1,
      commandId: 'party-join-5',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: characters[4],
      payload: { groupId: partyId },
    }, players[4]!);
    expect(fullPartyJoin.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });

    const duplicateParty = await createParty(1, 'party-create-while-member');
    expect(duplicateParty.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
    const groups = projectGroups(await store.readStream(DEMO_WORLD_INSTANCE_ID, 'world-groups'));
    expect(groups.groups[0]).toMatchObject({
      groupType: 'party',
      isPublic: true,
      maxMembers: 4,
      members: expect.arrayContaining([
        expect.objectContaining({ playerId: 'party-player-1' }),
        expect.objectContaining({ playerId: 'party-player-4' }),
      ]),
    });
    expect(groups.groups[0]?.members).toHaveLength(4);

    await engine.stop();
  });

  it('notifies members when the leader closes their party and preserves separate ownership', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const leader = { ...session, playerId: 'party-leader', actorId: 'party-leader' };
    const member = { ...session, playerId: 'party-member', actorId: 'party-member' };
    const leaderCharacter = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'leader-character',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Leader' },
    }, leader);
    const memberCharacter = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'member-character',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Member' },
    }, member);
    const party = await engine.dispatch({
      type: 'party.create',
      version: 1,
      commandId: 'leader-party',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: leaderCharacter.streamId!,
      payload: {},
    }, leader);
    const partyId = projectGroups(await store.readStream(DEMO_WORLD_INSTANCE_ID, 'world-groups')).groups[0]!.groupId;
    await engine.dispatch({
      type: 'party.join',
      version: 1,
      commandId: 'member-joins',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: memberCharacter.streamId!,
      payload: { groupId: partyId },
    }, member);
    expect(party.receipt.ok).toBe(true);

    const unauthorizedClose = await engine.dispatch({
      type: 'party.close',
      version: 1,
      commandId: 'member-closes-party',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: memberCharacter.streamId!,
      payload: {},
    }, member);
    expect(unauthorizedClose.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });

    const close = await engine.dispatch({
      type: 'party.leave',
      version: 1,
      commandId: 'leader-leaves-party',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: leaderCharacter.streamId!,
      payload: {},
    }, leader);
    expect(close.receipt.ok).toBe(true);
    const info = await engine.query({
      type: 'party.info',
      version: 1,
      queryId: 'member-party-info',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: memberCharacter.streamId!,
      payload: { afterRevision: 0 },
    }, member);
    expect(info).toMatchObject({
      ok: true,
      value: { party: null, activity: [{ type: 'created' }, { type: 'joined' }, { type: 'closed' }] },
    });

    await engine.stop();
  });

  it('shares party quest progress from committed member events and abandons it on party closure', async () => {
    const targetLocationId = demoWorld.locations[1]!.id;
    const testWorld = {
      ...demoWorld,
      quests: [
        ...(demoWorld.quests ?? []),
        {
          id: 'party-visit-test',
          version: '1',
          title: 'Shared Wayfinding',
          summary: 'Reach the next room as a party.',
          scope: 'party' as const,
          giverNpcId: 'test-giver',
          turnInNpcId: 'test-giver',
          objectives: [{
            id: 'visit-next-room',
            label: 'Reach the next room',
            type: 'visit-location' as const,
            locationId: targetLocationId,
          }],
        },
        {
          id: 'party-abandon-test',
          version: '1',
          title: 'Unfinished Shared Route',
          summary: 'A progress state that should be invalidated on party close.',
          scope: 'party' as const,
          giverNpcId: 'test-giver',
          turnInNpcId: 'test-giver',
          objectives: [{
            id: 'visit-far-room',
            label: 'Reach another room',
            type: 'visit-location' as const,
            locationId: demoWorld.locations[0]!.id,
          }],
        },
      ],
    };
    let testId = 0;
    const triggerPlugin: EnginePlugin = {
      manifest: {
        id: 'mudd.party-quest-test-trigger',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
      },
      register(context) {
        context.registerCommand('test.party-movement', z.object({
          type: z.literal('test.party-movement'),
          version: z.literal(1),
          commandId: z.string(),
          worldInstanceId: z.string(),
          characterId: z.string(),
          payload: z.object({ toLocationId: z.string() }),
        }), async (command) => ({
          streamId: 'test-party-movement',
          expectedVersion: 0,
          events: [{
            type: 'character.moved',
            version: 1,
            payload: {
              characterId: command.characterId,
              fromLocationId: 'test-start',
              toLocationId: command.payload.toLocationId,
              exitId: 'test-exit',
            },
          }],
        }));
      },
    };
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [worldItemsPlugin, movementPlugin, characterPlugin, groupsPlugin, partyPlugin, partyQuestPlugin, triggerPlugin],
      store,
      authorization,
      testWorld,
      () => `party-quest-test-${++testId}`,
      () => new Date('2026-10-19T12:00:00.000Z'),
    );
    await engine.start();
    const player = { ...session, playerId: 'quest-party-member', actorId: 'quest-party-member' };
    const character = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'quest-party-character',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Wayfinder' },
    }, player);
    const characterId = character.streamId!;
    expect((await engine.dispatch({
      type: 'party.create',
      version: 1,
      commandId: 'quest-party-create',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: {},
    }, player)).receipt.ok).toBe(true);
    const partyId = projectGroups(await store.readStream(DEMO_WORLD_INSTANCE_ID, 'world-groups')).groups[0]!.groupId;

    expect((await engine.dispatch({
      type: 'party.quest.start',
      version: 1,
      commandId: 'quest-party-start',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: { questId: 'party-visit-test' },
    }, player)).receipt.ok).toBe(true);
    const movement = {
      type: 'test.party-movement',
      version: 1,
      commandId: 'party-quest-movement-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: { toLocationId: targetLocationId },
    };
    expect((await engine.dispatch(movement, player)).receipt.ok).toBe(true);
    expect((await engine.dispatch(movement, player)).commitOutcome).toBe('duplicate');
    await engine.processPendingEffects();

    const journal = await engine.query({
      type: 'party.quests',
      version: 1,
      queryId: 'party-quest-journal',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: {},
    }, player);
    expect(journal).toMatchObject({
      ok: true,
      value: {
        partyId,
        quests: [{
          questId: 'party-visit-test',
          status: 'completed',
          objectives: [{ progress: 1, required: 1, completed: true }],
        }],
      },
    });
    expect((await engine.dispatch({
      type: 'party.quest.start',
      version: 1,
      commandId: 'quest-party-abandon-start',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: { questId: 'party-abandon-test' },
    }, player)).receipt.ok).toBe(true);
    expect((await engine.dispatch({
      type: 'party.close',
      version: 1,
      commandId: 'quest-party-close',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: {},
    }, player)).receipt.ok).toBe(true);
    await engine.processPendingEffects();
    const questEvents = await store.readStream(DEMO_WORLD_INSTANCE_ID, `party-quests:${partyId}`);
    expect(questEvents.map((event) => event.type)).toContain('party.quest_completed');
    expect(questEvents.some((event) =>
      event.type === 'party.quest_abandoned' &&
      (event.payload as { questId?: string }).questId === 'party-abandon-test',
    )).toBe(true);
    expect(questEvents.some((event) =>
      event.type === 'party.quest_abandoned' &&
      (event.payload as { questId?: string }).questId === 'party-visit-test',
    )).toBe(false);

    await engine.stop();
  });

  it('puts online party members in one encounter with independent turns', async () => {
    activeTestRoomCharacters = [];
    let id = 0;
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [
        worldItemsPlugin,
        movementPlugin,
        characterPlugin,
        groupsPlugin,
        partyPlugin,
        partyQuestPlugin,
        interactionPlugin,
        combatPlugin,
        testCombatPresencePlugin,
        partyCombatPolicyPlugin,
        teamCombatPlugin,
      ],
      store,
      authorization,
      demoWorld,
      () => `team-combat-test-${++id}`,
      () => new Date('2026-10-19T12:00:00.000Z'),
    );
    await engine.start();
    const firstPlayer = { ...session, playerId: 'team-player-a', actorId: 'team-player-a' };
    const secondPlayer = { ...session, playerId: 'team-player-b', actorId: 'team-player-b' };
    const unavailablePlayer = { ...session, playerId: 'team-player-c', actorId: 'team-player-c' };
    const firstCreated = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'team-character-a',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Tern' },
    }, firstPlayer);
    const secondCreated = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'team-character-b',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Wren' },
    }, secondPlayer);
    const unavailableCreated = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'team-character-c',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Lark' },
    }, unavailablePlayer);
    const firstCharacterId = firstCreated.streamId!;
    const secondCharacterId = secondCreated.streamId!;
    const unavailableCharacterId = unavailableCreated.streamId!;
    const firstCharacter = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, firstCharacterId))!;
    const secondCharacter = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, secondCharacterId))!;
    expect(firstCharacter.locationId).toBe(secondCharacter.locationId);

    expect((await engine.dispatch({
      type: 'party.create',
      version: 1,
      commandId: 'team-party-create',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: firstCharacterId,
      payload: {},
    }, firstPlayer)).receipt.ok).toBe(true);
    const partyId = projectGroups(await store.readStream(DEMO_WORLD_INSTANCE_ID, 'world-groups')).groups[0]!.groupId;
    expect((await engine.dispatch({
      type: 'party.join',
      version: 1,
      commandId: 'team-party-join',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: secondCharacterId,
      payload: { groupId: partyId },
    }, secondPlayer)).receipt.ok).toBe(true);
    expect((await engine.dispatch({
      type: 'party.join',
      version: 1,
      commandId: 'team-party-join-unavailable',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: unavailableCharacterId,
      payload: { groupId: partyId },
    }, unavailablePlayer)).receipt.ok).toBe(true);
    const partyQuestStart = await engine.dispatch({
      type: 'party.quest.start',
      version: 1,
      commandId: 'team-party-quest-start',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: firstCharacterId,
      payload: { questId: 'mossgate-cooperative-drill' },
    }, firstPlayer);
    if (!partyQuestStart.receipt.ok) throw new Error(partyQuestStart.receipt.message);
    activeTestRoomCharacters = [
      { playerId: firstPlayer.playerId, characterId: firstCharacterId, displayName: firstCharacter.name },
      { playerId: secondPlayer.playerId, characterId: secondCharacterId, displayName: secondCharacter.name },
    ];

    const location = demoWorld.locations.find((candidate) =>
      candidate.npcs?.some((npc) => npc.id === 'mossgate-training-sentinel'),
    )!;
    if (location.id !== firstCharacter.locationId) {
      throw new Error('The team combat test characters must start beside the training sentinel.');
    }
    const started = await engine.dispatch({
      type: 'team.combat.start',
      version: 1,
      commandId: 'team-combat-start',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: firstCharacterId,
      payload: { targetNpcId: 'mossgate-training-sentinel' },
    }, firstPlayer);
    expect(started.receipt.ok).toBe(true);
    const info = await engine.query({
      type: 'team.combat.info',
      version: 1,
      queryId: 'team-combat-info',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: secondCharacterId,
      payload: {},
    }, secondPlayer);
    expect(info).toMatchObject({
      ok: true,
      value: {
        encounter: {
          status: 'active',
          participants: [
            { characterId: firstCharacterId, teamId: 'allies' },
            { characterId: secondCharacterId, teamId: 'allies' },
            { npcId: 'mossgate-training-sentinel', teamId: 'enemies' },
          ],
          currentParticipantId: firstCharacterId,
        },
      },
    });
    const parsedInfo = TeamCombatInfoProjectionSchema.parse(
      (info as { value: unknown }).value,
    );
    const encounterId = parsedInfo.encounter!.encounterId;

    expect((await engine.dispatch({
      type: 'team.combat.action',
      version: 1,
      commandId: 'team-combat-first-turn',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: firstCharacterId,
      payload: {
        encounterId,
        action: 'attack',
      },
    }, firstPlayer)).receipt.ok).toBe(true);
    const afterFirstTurn = await engine.query({
      type: 'team.combat.info',
      version: 1,
      queryId: 'team-combat-info-next-turn',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: secondCharacterId,
      payload: {},
    }, secondPlayer);
    expect(afterFirstTurn).toMatchObject({
      ok: true,
      value: {
        encounter: {
          status: 'active',
          currentParticipantId: secondCharacterId,
        },
      },
    });
    expect((await engine.dispatch({
      type: 'party.leave',
      version: 1,
      commandId: 'team-party-member-leaves-during-fight',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: secondCharacterId,
      payload: {},
    }, secondPlayer)).receipt.ok).toBe(true);
    const memberAfterLeaving = await engine.query({
      type: 'team.combat.info',
      version: 1,
      queryId: 'team-combat-after-leave',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: secondCharacterId,
      payload: {},
    }, secondPlayer);
    expect(memberAfterLeaving).toMatchObject({
      ok: true,
      value: {
        encounter: {
          status: 'active',
          currentParticipantId: secondCharacterId,
          participants: [
            { characterId: firstCharacterId, teamId: 'allies' },
            { characterId: secondCharacterId, teamId: 'allies' },
            { npcId: 'mossgate-training-sentinel', teamId: 'enemies' },
          ],
        },
      },
    });
    expect(await engine.query({
      type: 'party.quests',
      version: 1,
      queryId: 'departed-member-party-quests',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: secondCharacterId,
      payload: {},
    }, secondPlayer)).toMatchObject({
      ok: true,
      value: { partyId: null, quests: [] },
    });
    expect((await engine.dispatch({
      type: 'team.combat.action',
      version: 1,
      commandId: 'team-combat-second-turn',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: secondCharacterId,
      payload: { encounterId, action: 'defend' },
    }, secondPlayer)).receipt.ok).toBe(true);
    expect((await engine.dispatch({
      type: 'team.combat.action',
      version: 1,
      commandId: 'team-combat-final-turn',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: firstCharacterId,
      payload: { encounterId, action: 'attack' },
    }, firstPlayer)).receipt.ok).toBe(true);
    await engine.processPendingEffects();
    const firstAfterOutcome = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, firstCharacterId))!;
    const secondAfterOutcome = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, secondCharacterId))!;
    expect(firstAfterOutcome.advancement?.experience).toBe(10);
    expect(secondAfterOutcome.advancement?.experience).toBe(10);
    const sharedQuestJournal = await engine.query({
      type: 'party.quests',
      version: 1,
      queryId: 'team-party-quest-journal',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: firstCharacterId,
      payload: {},
    }, firstPlayer);
    expect(sharedQuestJournal).toMatchObject({
      ok: true,
      value: {
        quests: [{
          questId: 'mossgate-cooperative-drill',
          status: 'completed',
          objectives: [{ progress: 1, required: 1, completed: true }],
        }],
      },
    });
    await engine.stop();
    activeTestRoomCharacters = [];
  });

  it('rejects malformed and unknown commands', async () => {
    const { engine } = makeEngine();
    await engine.start();
    const invalid = await engine.dispatch({
      type: 'character.move',
      commandId: 'bad',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: 'char',
      expectedVersion: 'not-a-number',
      payload: { exitId: 'missing' },
    }, session);
    expect(invalid.receipt).toMatchObject({ ok: false, code: 'INVALID_COMMAND' });
    const unknown = await engine.dispatch({ type: 'admin.teleport', commandId: 'unknown' }, session);
    expect(unknown.receipt).toMatchObject({ ok: false, code: 'UNKNOWN_COMMAND' });
    await engine.stop();
  });

  it('creates a character, moves only through a valid exit, and replays the same state', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const created = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'create-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session);
    expect(created.receipt.ok).toBe(true);
    expect(created.streamId).toBe('test-id-1');

    const blocked = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'move-invalid',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: created.streamId,
      expectedVersion: 1,
      payload: { exitId: 'not-an-exit' },
    }, session);
    expect(blocked.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });

    const moved = await engine.dispatch({
      type: 'character.take',
      version: 1,
      commandId: 'take-stone',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: created.streamId,
      expectedVersion: 1,
      payload: { itemId: 'mossgate-loose-stone' },
    }, session);
    expect(moved.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });
    const cannotTakeSign = await engine.dispatch({
      type: 'character.take',
      version: 1,
      commandId: 'take-marker',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: created.streamId,
      expectedVersion: 2,
      payload: { itemId: 'mossgate-marker' },
    }, session);
    expect(cannotTakeSign.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });

    const movedAfterTake = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'move-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: created.streamId,
      expectedVersion: 2,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);
    expect(movedAfterTake.receipt).toMatchObject({ ok: true, newAggregateVersion: 3 });
    const projection = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, created.streamId!));
    expect(projection).toMatchObject({
      characterId: created.streamId,
      locationId: 'glasswater-bridge',
      visitedLocationIds: ['mossgate-clearing', 'glasswater-bridge'],
      revision: 3,
      inventory: [{
        id: 'mossgate-loose-stone',
        label: 'Loose stone',
        description: 'A smooth, palm-sized stone with a pale stripe running through it.',
      }],
    });

    const returned = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'return-to-clearing',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: created.streamId,
      expectedVersion: 3,
      payload: { exitId: 'bridge-to-clearing' },
    }, session);
    expect(returned.receipt).toMatchObject({ ok: true, newAggregateVersion: 4 });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, created.streamId!))?.visitedLocationIds)
      .toEqual(['mossgate-clearing', 'glasswater-bridge']);
    await engine.stop();
  });

  it('requires the western approach, tower floor, and upward travel before striking the bell', async () => {
    const testWorld = structuredClone(demoWorld);
    testWorld.locations.find((location) => location.id === 'glasswater-bridge')!.exits.push({
      id: 'test-direct-bridge-to-tower',
      fromLocationId: 'glasswater-bridge',
      toLocationId: 'bell-tower',
      label: 'Direct tower shortcut for gate regression coverage',
      direction: 'southeast',
    });
    testWorld.locations.find((location) => location.id === 'bell-tower-west')!.exits.push({
      id: 'test-direct-west-to-belfry',
      fromLocationId: 'bell-tower-west',
      toLocationId: 'bell-tower-belfry',
      label: 'Direct belfry shortcut for gate regression coverage',
      direction: 'up',
    });
    const { engine, store } = makeEngine(testWorld);
    await engine.start();
    const created = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'tower-route-create',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session);
    const characterId = created.streamId!;

    const clearingBypass = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-route-clearing-bypass',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 1,
      payload: { exitId: 'clearing-to-tower' },
    }, session);
    expect(clearingBypass.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });

    const takeStone = await engine.dispatch({
      type: 'character.take',
      version: 1,
      commandId: 'tower-route-take-stone',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 1,
      payload: { itemId: 'mossgate-loose-stone' },
    }, session);
    expect(takeStone.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });

    const reachBridge = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-route-to-bridge',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 2,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);
    expect(reachBridge.receipt).toMatchObject({ ok: true, newAggregateVersion: 3 });

    const bridgeBypass = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-route-bridge-bypass',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 3,
      payload: { exitId: 'test-direct-bridge-to-tower' },
    }, session);
    expect(bridgeBypass.receipt).toMatchObject({
      ok: false,
      code: 'RULE_VIOLATION',
      message: 'You must first visit West of Old Bell Tower before entering Old Bell Tower.',
    });

    const reachWesternApproach = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-route-to-west',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 3,
      payload: { exitId: 'bridge-to-tower-west' },
    }, session);
    expect(reachWesternApproach.receipt).toMatchObject({ ok: true, newAggregateVersion: 4 });

    const prematureBellStrike = await engine.dispatch({
      type: 'character.use',
      version: 1,
      commandId: 'tower-route-premature-bell',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 4,
      payload: { itemId: 'mossgate-loose-stone', targetId: 'tower-cracked-bell' },
    }, session);
    expect(prematureBellStrike.receipt).toMatchObject({
      ok: false,
      message: 'That is not a usable target in this room.',
    });

    const belfryBypass = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-route-belfry-bypass',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 4,
      payload: { exitId: 'test-direct-west-to-belfry' },
    }, session);
    expect(belfryBypass.receipt).toMatchObject({
      ok: false,
      code: 'RULE_VIOLATION',
      message: 'You must first visit Old Bell Tower before entering Old Bell Tower Belfry.',
    });

    const enterTower = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-route-enter-tower',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 4,
      payload: { exitId: 'bell-tower-west-to-tower' },
    }, session);
    expect(enterTower.receipt).toMatchObject({ ok: true, newAggregateVersion: 5 });

    const useFromTowerFloor = await engine.dispatch({
      type: 'character.use',
      version: 1,
      commandId: 'tower-route-use-from-ground-floor',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 5,
      payload: { itemId: 'mossgate-loose-stone', targetId: 'tower-cracked-bell' },
    }, session);
    expect(useFromTowerFloor.receipt).toMatchObject({
      ok: false,
      message: 'That is not a usable target in this room.',
    });

    const climbToBelfry = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-route-climb-to-belfry',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 5,
      payload: { exitId: 'tower-to-belfry' },
    }, session);
    expect(climbToBelfry.receipt).toMatchObject({ ok: true, newAggregateVersion: 6 });

    const strikeBell = await engine.dispatch({
      type: 'character.use',
      version: 1,
      commandId: 'tower-route-strike-bell',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 6,
      payload: { itemId: 'mossgate-loose-stone', targetId: 'tower-cracked-bell' },
    }, session);
    expect(strikeBell.receipt).toMatchObject({ ok: true, newAggregateVersion: 7 });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))?.visitedLocationIds)
      .toEqual(['mossgate-clearing', 'glasswater-bridge', 'bell-tower-west', 'bell-tower', 'bell-tower-belfry']);

    await engine.stop();
  });

  it('keeps the bell strike locked until the western approach has been visited, even from the belfry', async () => {
    const testWorld = structuredClone(demoWorld);
    delete testWorld.locations.find((location) => location.id === 'bell-tower')!.requiredVisitedLocationId;
    testWorld.locations.find((location) => location.id === 'glasswater-bridge')!.exits.push({
      id: 'test-direct-bridge-to-tower',
      fromLocationId: 'glasswater-bridge',
      toLocationId: 'bell-tower',
      label: 'Direct tower shortcut for legacy character coverage',
      direction: 'southeast',
    });
    const { engine } = makeEngine(testWorld);
    await engine.start();
    const created = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'tower-strike-gate-create',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session);
    const characterId = created.streamId!;

    await engine.dispatch({
      type: 'character.take',
      version: 1,
      commandId: 'tower-strike-gate-take-stone',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 1,
      payload: { itemId: 'mossgate-loose-stone' },
    }, session);
    await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-strike-gate-to-bridge',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 2,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);
    const directEntry = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-strike-gate-shortcut',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 3,
      payload: { exitId: 'test-direct-bridge-to-tower' },
    }, session);
    expect(directEntry.receipt).toMatchObject({ ok: true, newAggregateVersion: 4 });

    const climbToBelfry = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-strike-gate-climb',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 4,
      payload: { exitId: 'tower-to-belfry' },
    }, session);
    expect(climbToBelfry.receipt).toMatchObject({ ok: true, newAggregateVersion: 5 });

    const prematureStrike = await engine.dispatch({
      type: 'character.use',
      version: 1,
      commandId: 'tower-strike-gate-premature',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 5,
      payload: { itemId: 'mossgate-loose-stone', targetId: 'tower-cracked-bell' },
    }, session);
    expect(prematureStrike.receipt).toMatchObject({
      ok: false,
      code: 'RULE_VIOLATION',
      message: 'You must first visit West of Old Bell Tower before using the loose stone here.',
    });

    const visitApproach = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-strike-gate-to-west',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 5,
      payload: { exitId: 'belfry-to-tower' },
    }, session);
    expect(visitApproach.receipt).toMatchObject({ ok: true, newAggregateVersion: 6 });
    const exitTower = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-strike-gate-visit-west',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 6,
      payload: { exitId: 'tower-to-west-approach' },
    }, session);
    expect(exitTower.receipt).toMatchObject({ ok: true, newAggregateVersion: 7 });
    const reenterTower = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-strike-gate-reenter',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 7,
      payload: { exitId: 'bell-tower-west-to-tower' },
    }, session);
    expect(reenterTower.receipt).toMatchObject({ ok: true, newAggregateVersion: 8 });
    const reenterBelfry = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'tower-strike-gate-reclimb',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 8,
      payload: { exitId: 'tower-to-belfry' },
    }, session);
    expect(reenterBelfry.receipt).toMatchObject({ ok: true, newAggregateVersion: 9 });
    const strikeAfterVisit = await engine.dispatch({
      type: 'character.use',
      version: 1,
      commandId: 'tower-strike-gate-after-visit',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 9,
      payload: { itemId: 'mossgate-loose-stone', targetId: 'tower-cracked-bell' },
    }, session);
    expect(strikeAfterVisit.receipt).toMatchObject({ ok: true, newAggregateVersion: 10 });

    await engine.stop();
  });

  it('uses a supplied character projection for a consistent game snapshot', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const createdCharacter = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'snapshot-create',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Snapshot' },
    }, session);
    const characterId = createdCharacter.streamId!;
    const projection = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    const readStream = vi.spyOn(store, 'readStream');

    const location = await engine.query({
      type: 'location.describe',
      version: 1,
      queryId: 'snapshot-query',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: {},
    }, session, { characterProjection: projection });

    expect(location.ok).toBe(true);
    expect(readStream.mock.calls.map(([, streamId]) => streamId)).toEqual(['world-items']);
    await engine.stop();
  });

  it('allows inspection of carried items and prevents quest items from being dropped', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const created = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'inspect-create',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session);
    const characterId = created.streamId!;
    await engine.dispatch({
      type: 'character.take',
      version: 1,
      commandId: 'inspect-take',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 1,
      payload: { itemId: 'mossgate-loose-stone' },
    }, session);
    await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'inspect-move',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 2,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);

    const carriedItem = await engine.query({
      type: 'object.inspect',
      version: 1,
      queryId: 'inspect-carried-stone',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: { objectId: 'mossgate-loose-stone' },
    }, session);
    expect(carriedItem).toMatchObject({
      ok: true,
      value: {
        id: 'mossgate-loose-stone',
        label: 'Loose stone',
        description: 'A smooth, palm-sized stone with a pale stripe running through it.',
      },
    });
    const objectLeftBehind = await engine.query({
      type: 'object.inspect',
      version: 1,
      queryId: 'inspect-room-marker',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: { objectId: 'mossgate-marker' },
    }, session);
    expect(objectLeftBehind).toMatchObject({
      ok: false,
      message: 'That object is not here or in your pack.',
    });

    const droppedItem = await engine.dispatch({
      type: 'character.drop',
      version: 1,
      commandId: 'inspect-drop-stone',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 3,
      payload: { itemId: 'mossgate-loose-stone' },
    }, session);
    expect(droppedItem.receipt).toMatchObject({
      ok: false,
      message: 'Quest items cannot be dropped.',
    });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))?.inventory)
      .toContainEqual(expect.objectContaining({ id: 'mossgate-loose-stone', questBound: true }));
    await engine.stop();
  });

  it('drops an ordinary item into the current room and keeps its location through replay', async () => {
    const testWorld = structuredClone(demoWorld);
    testWorld.locations.find((location) => location.id === 'mossgate-clearing')!.takeables!.push({
      id: 'drop-test-pebble',
      label: 'Pebble',
      description: 'A plain pebble used to test ordinary item dropping.',
      roomDescription: 'A plain pebble lies nearby.',
    });
    const { engine, store } = makeEngine(testWorld);
    await engine.start();
    const created = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'drop-create',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session);
    const characterId = created.streamId!;
    const take = await engine.dispatch({
      type: 'character.take',
      version: 1,
      commandId: 'drop-take',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 1,
      payload: { itemId: 'drop-test-pebble' },
    }, session);
    expect(take.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });
    const moveToBridge = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'drop-move-to-bridge',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 2,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);
    expect(moveToBridge.receipt).toMatchObject({ ok: true, newAggregateVersion: 3 });
    const drop = await engine.dispatch({
      type: 'character.drop',
      version: 1,
      commandId: 'drop-stone',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 3,
      payload: { itemId: 'drop-test-pebble' },
    }, session);
    expect(drop.receipt).toMatchObject({ ok: true, newAggregateVersion: 4 });
    expect(drop.events[0]).toMatchObject({
      type: 'character.item_dropped',
      version: 1,
      payload: { characterId, locationId: 'glasswater-bridge', item: { id: 'drop-test-pebble' } },
    });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))).toMatchObject({
      locationId: 'glasswater-bridge',
      revision: 4,
      inventory: [],
      itemLocations: [{
        item: { id: 'drop-test-pebble' },
        locationId: 'glasswater-bridge',
      }],
    });
    const droppedRoom = await engine.query({
      type: 'location.describe',
      version: 1,
      queryId: 'look-at-dropped-stone',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: {},
    }, session);
    expect(droppedRoom).toMatchObject({
      ok: true,
      value: { objects: expect.arrayContaining([expect.objectContaining({ id: 'drop-test-pebble', takeable: true })]) },
    });
    const moveBackToClearing = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'drop-move-back-to-clearing',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 4,
      payload: { exitId: 'bridge-to-clearing' },
    }, session);
    expect(moveBackToClearing.receipt).toMatchObject({ ok: true, newAggregateVersion: 5 });
    const originalRoom = await engine.query({
      type: 'location.describe',
      version: 1,
      queryId: 'look-at-original-stone-place',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: {},
    }, session);
    expect(originalRoom).toMatchObject({
      ok: true,
      value: {
        description: expect.stringContaining(
          '\n\nMara is here. A path keeper stands beside the weathered marker, watching the northern trail.',
        ),
      },
    });
    expect(originalRoom).not.toMatchObject({
      ok: true,
      value: { objects: expect.arrayContaining([expect.objectContaining({ id: 'drop-test-pebble' })]) },
    });
    const returnToBridge = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'drop-return-to-bridge',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 5,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);
    expect(returnToBridge.receipt).toMatchObject({ ok: true, newAggregateVersion: 6 });
    const takeAgain = await engine.dispatch({
      type: 'character.take',
      version: 1,
      commandId: 'take-dropped-pebble',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 6,
      payload: { itemId: 'drop-test-pebble' },
    }, session);
    expect(takeAgain.receipt).toMatchObject({ ok: true, newAggregateVersion: 7 });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))).toMatchObject({
      inventory: [{ id: 'drop-test-pebble' }],
      itemLocations: [{ item: { id: 'drop-test-pebble' }, locationId: null }],
    });
    await engine.stop();
  });

  it('keeps multiple characters under one account and supports versioned rename and archive events', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const first = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'create-first',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session);
    const second = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'create-second',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Sedge' },
    }, session);
    expect(first.receipt.ok).toBe(true);
    expect(second.receipt.ok).toBe(true);
    expect(second.streamId).not.toBe(first.streamId);

    const renamed = await engine.dispatch({
      type: 'character.rename',
      version: 1,
      commandId: 'rename-first',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: first.streamId,
      expectedVersion: 1,
      payload: { name: 'Fern' },
    }, session);
    expect(renamed.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });

    const archived = await engine.dispatch({
      type: 'character.archive',
      version: 1,
      commandId: 'archive-first',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: first.streamId,
      expectedVersion: 2,
      payload: {},
    }, session);
    expect(archived.receipt).toMatchObject({ ok: true, newAggregateVersion: 3 });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, first.streamId!)))
      .toMatchObject({ name: 'Fern', archived: true, revision: 3 });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, second.streamId!)))
      .toMatchObject({ name: 'Sedge', archived: false, revision: 1 });

    const moveArchived = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'move-archived',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: first.streamId,
      expectedVersion: 3,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);
    expect(moveArchived.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });

    const restored = await engine.dispatch({
      type: 'character.restore',
      version: 1,
      commandId: 'restore-first',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: first.streamId,
      expectedVersion: 3,
      payload: {},
    }, session);
    expect(restored.receipt).toMatchObject({ ok: true, newAggregateVersion: 4 });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, first.streamId!)))
      .toMatchObject({ name: 'Fern', archived: false, revision: 4 });

    const movedAfterRestore = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'move-restored',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: first.streamId,
      expectedVersion: 4,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);
    expect(movedAfterRestore.receipt.ok).toBe(true);
    await engine.stop();
  });

  it('prevents stale concurrent writes and makes command retries idempotent', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const created = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'create-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session);
    const command = {
      type: 'character.move',
      version: 1,
      commandId: 'move-race-a',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: created.streamId,
      expectedVersion: 1,
      payload: { exitId: 'clearing-to-bridge' },
    };
    const [firstAttempt, secondAttempt] = await Promise.all([
      engine.dispatch(command, session),
      engine.dispatch(command, session),
    ]);
    expect([firstAttempt.commitOutcome, secondAttempt.commitOutcome].sort()).toEqual(['committed', 'duplicate']);
    expect(firstAttempt.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });
    expect(secondAttempt.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });
    const competing = await engine.dispatch({ ...command, commandId: 'move-race-b', payload: { exitId: 'clearing-to-tower-west' } }, session);
    expect(competing.receipt).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect((await store.readStream(DEMO_WORLD_INSTANCE_ID, created.streamId!))).toHaveLength(2);
    await engine.stop();
  });

  it('rejects plugins with missing dependencies', () => {
    const plugin: EnginePlugin = {
      manifest: {
        id: 'mudd.needs-missing',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
        requiredPlugins: { 'mudd.not-installed': '^1.0.0' },
      },
      register() {},
    };
    expect(() => new EngineHost([plugin], new InMemoryEventStore(), authorization, demoWorld))
      .toThrow(/missing plugin/i);
  });

  it.each([
    { version: '1.0.0', range: '1.5.0', label: 'exact ranges reject an older minor' },
    { version: '1.0.0', range: '^1.5.0', label: 'caret ranges reject an older minor' },
    { version: '1.5.0', range: '^1.5.1', label: 'caret ranges reject a lower patch' },
    { version: '2.0.0', range: '^1.5.0', label: 'caret ranges reject a newer major' },
    { version: '0.3.0', range: '^0.2.3', label: 'zero-major caret ranges stay within the minor' },
    { version: '0.0.4', range: '^0.0.3', label: 'zero-major caret ranges stay within the patch' },
    { version: '1.5.0', range: '~1.5.0', label: 'unsupported range syntax is rejected' },
  ])('$label', ({ version, range }) => {
    const dependency: EnginePlugin = {
      manifest: { id: 'mudd.range-dependency', version, apiVersion: '1.0', category: 'core' },
      register() {},
    };
    const dependent: EnginePlugin = {
      manifest: {
        id: 'mudd.range-dependent',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
        requiredPlugins: { 'mudd.range-dependency': range },
      },
      register() {},
    };
    expect(() => new EngineHost([dependency, dependent], new InMemoryEventStore(), authorization, demoWorld))
      .toThrow(version === '1.5.0' && range.startsWith('~')
        ? /unsupported plugin dependency range/i
        : /requires mudd\.range-dependency/i);
  });

  it('accepts compatible exact, caret, wildcard, and zero-major dependency versions', () => {
    const makeDependency = (version: string): EnginePlugin => ({
      manifest: { id: 'mudd.range-dependency', version, apiVersion: '1.0', category: 'core' },
      register() {},
    });
    const makeDependent = (range: string): EnginePlugin => ({
      manifest: {
        id: 'mudd.range-dependent',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
        requiredPlugins: { 'mudd.range-dependency': range },
      },
      register() {},
    });

    expect(() => new EngineHost([makeDependency('1.5.0'), makeDependent('1.5.0')], new InMemoryEventStore(), authorization, demoWorld)).not.toThrow();
    expect(() => new EngineHost([makeDependency('1.6.2'), makeDependent('^1.5.0')], new InMemoryEventStore(), authorization, demoWorld)).not.toThrow();
    expect(() => new EngineHost([makeDependency('0.2.9'), makeDependent('^0.2.3')], new InMemoryEventStore(), authorization, demoWorld)).not.toThrow();
    expect(() => new EngineHost([makeDependency('9.9.9'), makeDependent('*')], new InMemoryEventStore(), authorization, demoWorld)).not.toThrow();
  });

  it('rejects plugin dependency cycles', () => {
    const first: EnginePlugin = {
      manifest: {
        id: 'mudd.cycle-first',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
        requiredPlugins: { 'mudd.cycle-second': '^1.0.0' },
      },
      register() {},
    };
    const second: EnginePlugin = {
      manifest: {
        id: 'mudd.cycle-second',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
        requiredPlugins: { 'mudd.cycle-first': '^1.0.0' },
      },
      register() {},
    };

    expect(() => new EngineHost([first, second], new InMemoryEventStore(), authorization, demoWorld))
      .toThrow(/dependency cycle/i);
  });
});
