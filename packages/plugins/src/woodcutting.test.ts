import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema, type WoodcuttingTreeDefinition } from '@mudd/contracts';
import {
  woodcuttingPlugin,
  validateWoodcuttingTrees,
  WOODCUTTING_TREES_STREAM_ID,
  projectWoodcuttingTreePresence,
} from './woodcutting.js';

const NOW = new Date('2026-10-27T12:00:00.000Z');
const TREE: WoodcuttingTreeDefinition = {
  id: 'pine-tree',
  locationId: 'grove',
  label: 'pine',
  roomDescription: 'A pine tree stands beside the path.',
  stumpDescription: 'The stump of a pine stands beside the path.',
  logTypeId: 'pine-logs',
  logLabel: 'Pine Logs',
  logDescription: 'A bundle of pine logs.',
  maximumLogs: 2,
  respawnSeconds: 60,
  experiencePerLog: 25,
  baseChancePercent: 10,
};

const AXE = {
  id: 'copper-axe',
  typeId: 'copper-axe',
  label: 'Copper Axe',
  description: 'A serviceable woodcutting axe.',
  woodcuttingAxe: { requiredLevel: 1, power: 1 },
};

function character(overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    worldInstanceId: 'world-1',
    characterId: 'character-1',
    name: 'Woodcutter',
    locationId: 'grove',
    revision: 4,
    health: { current: 10, maximum: 10 },
    inventory: [AXE],
    ...overrides,
  });
}

function pack(trees: WoodcuttingTreeDefinition[] = [TREE]) {
  return {
    locations: [{ id: 'grove' }],
    woodcuttingTrees: trees,
  } as { locations: Array<{ id: string }>; woodcuttingTrees: WoodcuttingTreeDefinition[] };
}

function harvested(
  remainingLogs: number,
  respawnsAt: string | null = null,
  aggregateVersion = 1,
) {
  return {
    type: 'world.tree_harvested',
    aggregateVersion,
    payload: { treeId: TREE.id, characterId: 'other-character', remainingLogs, respawnsAt },
  };
}

function activeAction(startedAt = new Date(NOW.getTime() - 1000).toISOString(), overrides: Record<string, unknown> = {}) {
  return {
    actionId: 'woodcut-action-1',
    treeId: TREE.id,
    treeLabel: TREE.label,
    axeItemId: AXE.id,
    locationId: 'grove',
    startedAt,
    ticksCompleted: 0,
    ticksRequired: 10,
    ...overrides,
  };
}

function harness(
  player: ReturnType<typeof character>,
  options: {
    treeEvents?: Array<Record<string, unknown>>;
    teamEvents?: Array<Record<string, unknown>>;
    pvpEvents?: Array<Record<string, unknown>>;
    rolls?: number[];
    trees?: WoodcuttingTreeDefinition[];
    currentTime?: Date;
  } = {},
) {
  const handlers = new Map<string, (command: any, context: any) => Promise<unknown>>();
  const readStream = vi.fn(async (_worldId: string, streamId: string) => {
    if (streamId === WOODCUTTING_TREES_STREAM_ID) return options.treeEvents ?? [];
    if (streamId === 'world-team-combat') return options.teamEvents ?? [];
    return options.pvpEvents ?? [];
  });
  const rolls = [...(options.rolls ?? [])];
  woodcuttingPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    requireCapability: () => ({ load: vi.fn(async () => player) }),
  } as never);
  const context = {
    world: { ...pack(options.trees), currency: undefined, corpseLifecycle: {} },
    worldInstanceId: 'world-1',
    store: { readStream },
    now: () => options.currentTime ?? NOW,
    makeId: () => 'generated-id',
    rng: { roll: vi.fn(() => rolls.shift() ?? 100) },
  };
  return { handlers, context, readStream };
}

function commandPayload(characterId: string, expectedVersion: number, payload: Record<string, unknown>) {
  return { characterId, expectedVersion, payload };
}

describe('woodcutting world validation', () => {
  it('accepts trees with unique IDs linked to authored locations', () => {
    expect(() => validateWoodcuttingTrees(pack() as never)).not.toThrow();
  });

  it('rejects duplicate tree IDs and trees in missing locations', () => {
    expect(() => validateWoodcuttingTrees(pack([TREE, { ...TREE, locationId: 'grove' }]) as never)).toThrow(
      'Woodcutting trees require unique IDs and a valid location.',
    );
    expect(() => validateWoodcuttingTrees(pack([{ ...TREE, locationId: 'missing-room' }]) as never)).toThrow(
      'Woodcutting trees require unique IDs and a valid location.',
    );
  });
});

describe('woodcutting.start', () => {
  it('starts a timed action for a carried and level-eligible axe beside a live tree', async () => {
    const player = character();
    const { handlers, context } = harness(player, {
      treeEvents: [{ type: 'unrelated.world_event', payload: {} }],
    });
    const start = handlers.get('woodcutting.start')!;

    const result = await start(commandPayload(player.characterId, player.revision, {
      treeId: TREE.id,
      axeItemId: AXE.id,
    }), context);

    expect(result).toMatchObject({
      streamId: player.characterId,
      expectedVersion: player.revision,
      events: [{
        type: 'character.woodcutting_action_started',
        version: 1,
        payload: { action: { treeId: TREE.id, axeItemId: AXE.id, ticksRequired: 10, ticksCompleted: 0 } },
      }],
    });
  });

  it('rejects unavailable characters and a tree not present in the current room', async () => {
    const player = character();
    const { handlers, context } = harness(player);
    const start = handlers.get('woodcutting.start')!;
    const missingCharacter = harness(player);
    missingCharacter.handlers.clear();
    woodcuttingPlugin.register({
      registerCommand: (_name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
        missingCharacter.handlers.set('woodcutting.start', handler);
      },
      requireCapability: () => ({ load: vi.fn(async () => undefined) }),
    } as never);

    await expect(missingCharacter.handlers.get('woodcutting.start')!(
      commandPayload(player.characterId, player.revision, { treeId: TREE.id, axeItemId: AXE.id }),
      context,
    )).rejects.toThrow('That character is no longer available.');

    await expect(start(
      commandPayload(player.characterId, player.revision, { treeId: TREE.id, axeItemId: AXE.id }),
      { ...context, world: { ...context.world, woodcuttingTrees: [{ ...TREE, locationId: 'elsewhere' }] } },
    )).rejects.toThrow('There is no tree by that name here.');
  });

  it('requires an axe and its minimum woodcutting level', async () => {
    const player = character({ inventory: [{ id: 'stone', label: 'Stone', description: 'A stone.' }] });
    const { handlers, context } = harness(player);
    const start = handlers.get('woodcutting.start')!;

    await expect(start(commandPayload(player.characterId, player.revision, {
      treeId: TREE.id, axeItemId: 'stone',
    }), context)).rejects.toThrow('You need to carry a woodcutting axe.');

    const highLevelAxe = { ...AXE, woodcuttingAxe: { requiredLevel: 10, power: 2 } };
    const novice = character({ inventory: [highLevelAxe] });
    const highLevelStart = harness(novice).handlers.get('woodcutting.start')!;
    await expect(highLevelStart(commandPayload(novice.characterId, novice.revision, {
      treeId: TREE.id, axeItemId: highLevelAxe.id,
    }), context)).rejects.toThrow('Woodcutting level 10 is required to use that axe.');
  });

  it('blocks woodcutting during personal or shared combat', async () => {
    const fighting = character({
      combat: {
        encounterId: 'encounter-1', locationId: 'grove', opponentNpcId: 'bandit-1',
        opponentName: 'Bandit', round: 1, playerHealth: 10, playerMaxHealth: 10,
        opponentHealth: 10, opponentMaxHealth: 10, status: 'active',
        lastAction: 'encounter', lastNarration: 'A bandit attacks.',
      },
    });
    const personalHarness = harness(fighting);
    await expect(personalHarness.handlers.get('woodcutting.start')!(
      commandPayload(fighting.characterId, fighting.revision, { treeId: TREE.id, axeItemId: AXE.id }),
      personalHarness.context,
    )).rejects.toThrow('You cannot chop wood during combat.');

    const player = character();
    const sharedHarness = harness(player, {
      teamEvents: [{
        type: 'team.combat_started',
        payload: { encounter: { encounterId: 'team-1', status: 'active', participants: [
          { characterId: player.characterId, status: 'active' },
        ] } },
      }],
    });
    await expect(sharedHarness.handlers.get('woodcutting.start')!(
      commandPayload(player.characterId, player.revision, { treeId: TREE.id, axeItemId: AXE.id }),
      sharedHarness.context,
    )).rejects.toThrow('You cannot chop wood during combat.');
  });

  it('uses live shared-tree state and permits a tree whose respawn time has passed', async () => {
    const player = character();
    const liveAgain = harness(player, {
      treeEvents: [harvested(0, new Date(NOW.getTime() - 1).toISOString(), 7)],
    });
    const result = await liveAgain.handlers.get('woodcutting.start')!(
      commandPayload(player.characterId, player.revision, { treeId: TREE.id, axeItemId: AXE.id }),
      liveAgain.context,
    );
    expect(result).toMatchObject({ events: [expect.objectContaining({ type: 'character.woodcutting_action_started' })] });

    const chopped = harness(player, {
      treeEvents: [harvested(0, new Date(NOW.getTime() + 90_000).toISOString())],
    });
    await expect(chopped.handlers.get('woodcutting.start')!(
      commandPayload(player.characterId, player.revision, { treeId: TREE.id, axeItemId: AXE.id }),
      chopped.context,
    )).rejects.toThrow('Only a stump remains where that tree stood.');
  });
});

describe('woodcutting.advance', () => {
  it('rejects an absent or mismatched timed action', async () => {
    const player = character();
    const { handlers, context } = harness(player);
    await expect(handlers.get('woodcutting.advance')!(
      commandPayload(player.characterId, player.revision, { actionId: 'wrong-action' }),
      context,
    )).rejects.toThrow('That woodcutting action is no longer active.');

    const missingCharacterHandlers = new Map<string, (command: any, context: any) => Promise<unknown>>();
    woodcuttingPlugin.register({
      registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
        missingCharacterHandlers.set(name, handler);
      },
      requireCapability: () => ({ load: vi.fn(async () => undefined) }),
    } as never);
    await expect(missingCharacterHandlers.get('woodcutting.advance')!(
      commandPayload(player.characterId, player.revision, { actionId: 'woodcut-action-1' }),
      context,
    )).rejects.toThrow('That character is no longer available.');
  });

  it('finishes an action as interrupted when its tree is no longer available', async () => {
    const player = character({ activeWoodcutting: activeAction() });
    const { handlers, context } = harness(player, { trees: [] });
    const result = await handlers.get('woodcutting.advance')!(
      commandPayload(player.characterId, player.revision, { actionId: 'woodcut-action-1' }),
      context,
    );
    expect(result).toMatchObject({
      events: [{
        type: 'character.woodcutting_action_advanced',
        payload: { status: 'interrupted', ticksCompleted: 0, skillExperienceAwarded: 0 },
      }],
    });
  });

  it('finishes an action when shared combat begins or the tree is depleted', async () => {
    const player = character({ activeWoodcutting: activeAction() });
    const sharedCombat = harness(player, {
      teamEvents: [{
        type: 'team.combat_started',
        payload: { encounter: { encounterId: 'team-1', status: 'active', participants: [
          { characterId: player.characterId, status: 'active' },
        ] } },
      }],
    });
    const interrupted = await sharedCombat.handlers.get('woodcutting.advance')!(
      commandPayload(player.characterId, player.revision, { actionId: 'woodcut-action-1' }),
      sharedCombat.context,
    );
    expect(interrupted).toMatchObject({
      events: [{ payload: { status: 'interrupted' } }],
    });

    const depleted = harness(player, { treeEvents: [harvested(0, new Date(NOW.getTime() + 60_000).toISOString())] });
    const result = await depleted.handlers.get('woodcutting.advance')!(
      commandPayload(player.characterId, player.revision, { actionId: 'woodcut-action-1' }),
      depleted.context,
    );
    expect(result).toMatchObject({ events: [{ payload: { status: 'tree-depleted' } }] });
  });

  it('rejects ticks before the next second has elapsed', async () => {
    const player = character({ activeWoodcutting: activeAction(NOW.toISOString()) });
    const { handlers, context } = harness(player);

    await expect(handlers.get('woodcutting.advance')!(
      commandPayload(player.characterId, player.revision, { actionId: 'woodcut-action-1' }),
      context,
    )).rejects.toThrow('Your axe is still swinging.');
  });

  it('awards a log and experience, stacks existing logs, and starts a respawn when depleted', async () => {
    const player = character({
      activeWoodcutting: activeAction(new Date(NOW.getTime() - 1000).toISOString()),
      woodcutting: { experience: 0, level: 1 },
    });
    const fresh = harness(player, { rolls: [1], treeEvents: [harvested(2, null, 4)] });
    const freshResult = await fresh.handlers.get('woodcutting.advance')!(
      commandPayload(player.characterId, player.revision, { actionId: 'woodcut-action-1' }),
      fresh.context,
    );
    expect(freshResult).toMatchObject({
      companions: [{
        streamId: WOODCUTTING_TREES_STREAM_ID,
        expectedVersion: 4,
        events: [{ payload: { remainingLogs: 1, respawnsAt: null } }],
      }],
      events: [{
        payload: {
          status: 'logged',
          skillExperienceAwarded: 25,
          totalExperience: 25,
          level: 2,
          item: { typeId: 'pine-logs', quantity: 1 },
        },
      }],
    });

    const stackedPlayer = character({
      activeWoodcutting: activeAction(new Date(NOW.getTime() - 10_000).toISOString()),
      woodcutting: { experience: 0, level: 1 },
      inventory: [AXE, {
        id: 'pine-stack', typeId: 'pine-logs', label: 'Pine Logs', description: 'Logs.',
        stackable: true, quantity: 4,
      }],
    });
    const stacked = harness(stackedPlayer, { rolls: [1], treeEvents: [harvested(1)] });
    const stackedResult = await stacked.handlers.get('woodcutting.advance')!(
      commandPayload(stackedPlayer.characterId, stackedPlayer.revision, { actionId: 'woodcut-action-1' }),
      stacked.context,
    );
    expect(stackedResult).toMatchObject({
      events: [{
        payload: {
          status: 'logged',
          stackItemId: 'pine-stack',
          stackQuantity: 5,
          treeDepleted: true,
        },
      }],
      companions: [{
        events: [{ payload: { remainingLogs: 0, respawnsAt: new Date(NOW.getTime() + 60_000).toISOString() } }],
      }],
    });
  });

  it('records waiting ticks and ends with no log after all ten chances fail', async () => {
    const waitingPlayer = character({
      activeWoodcutting: activeAction(new Date(NOW.getTime() - 1000).toISOString()),
    });
    const waiting = harness(waitingPlayer, { rolls: [100] });
    const waitingResult = await waiting.handlers.get('woodcutting.advance')!(
      commandPayload(waitingPlayer.characterId, waitingPlayer.revision, { actionId: 'woodcut-action-1' }),
      waiting.context,
    );
    expect(waitingResult).toMatchObject({
      events: [{
        payload: { status: 'waiting', ticksCompleted: 1, tickRolls: [{ tick: 1, roll: 1, success: false }] },
      }],
    });

    const finalPlayer = character({
      activeWoodcutting: activeAction(new Date(NOW.getTime() - 10_000).toISOString()),
    });
    const finalAttempt = harness(finalPlayer, { rolls: Array(10).fill(100) });
    const finalResult = await finalAttempt.handlers.get('woodcutting.advance')!(
      commandPayload(finalPlayer.characterId, finalPlayer.revision, { actionId: 'woodcut-action-1' }),
      finalAttempt.context,
    );
    expect(finalResult).toMatchObject({
      events: [{
        payload: { status: 'no-log', ticksCompleted: 10, tickRolls: expect.arrayContaining([
          { tick: 10, roll: 1, success: false },
        ]) },
      }],
    });
  });
});

describe('woodcutting.cancel', () => {
  it('records an interrupted action without awarding experience', async () => {
    const player = character({
      activeWoodcutting: activeAction(NOW.toISOString(), { ticksCompleted: 3 }),
      woodcutting: { experience: 12, level: 1 },
    });
    const { handlers, context } = harness(player);

    const result = await handlers.get('woodcutting.cancel')!(
      commandPayload(player.characterId, player.revision, { actionId: 'woodcut-action-1' }),
      context,
    );

    expect(result).toMatchObject({
      events: [{
        type: 'character.woodcutting_action_advanced',
        payload: {
          actionId: 'woodcut-action-1',
          ticksCompleted: 3,
          status: 'interrupted',
          tickRolls: [],
          skillExperienceAwarded: 0,
          totalExperience: 12,
        },
      }],
    });
  });

  it('rejects cancel requests after the character or action is unavailable', async () => {
    const player = character({ activeWoodcutting: activeAction() });
    const { handlers, context } = harness(player);
    await expect(handlers.get('woodcutting.cancel')!(
      commandPayload(player.characterId, player.revision, { actionId: 'other-action' }),
      context,
    )).rejects.toThrow('That woodcutting action is no longer active.');

    const missingHandlers = new Map<string, (command: any, context: any) => Promise<unknown>>();
    woodcuttingPlugin.register({
      registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
        missingHandlers.set(name, handler);
      },
      requireCapability: () => ({ load: vi.fn(async () => undefined) }),
    } as never);
    await expect(missingHandlers.get('woodcutting.cancel')!(
      commandPayload(player.characterId, player.revision, { actionId: 'woodcut-action-1' }),
      context,
    )).rejects.toThrow('That character is no longer available.');
  });
});
