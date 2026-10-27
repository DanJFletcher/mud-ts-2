import { describe, expect, it, vi } from 'vitest';
import {
  CharacterProjectionSchema,
  dailyCycle,
  dailyPostings,
} from '@mudd/contracts';
import { dailyJobsPlugin } from './daily-jobs.js';

const NOW = new Date('2026-10-27T12:00:00.000Z');
const CYCLE = dailyCycle(NOW);
const BOARD = {
  id: 'market-board',
  locationId: 'market',
  name: 'Market Board',
  slots: [[
    { id: 'job-a', poster: 'Tomas', title: 'Bring pine logs', supplyTypeId: 'pine-logs', quantity: 2, gold: 5, experience: 8 },
    { id: 'job-b', poster: 'Seli', title: 'Bring fish', supplyTypeId: 'river-fish', quantity: 1, gold: 3, experience: 4 },
  ]],
};
const SOURCE = {
  id: 'wood-pile',
  locationId: 'market',
  label: 'A stack of loose wood',
  supply: { typeId: 'firewood', label: 'Firewood', description: 'A bundle of split wood.' },
  dailyLimit: 1,
};
const WORLD = {
  currency: { id: 'moss-mark', name: 'moss mark', symbol: 'm', startingBalance: 0 },
  locations: [{ id: 'market' }],
  dailyBoards: [BOARD],
  supplySources: [SOURCE],
};
const POSTED_JOB = dailyPostings(BOARD, CYCLE)[0]!;

function character(overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    worldInstanceId: 'world-1',
    characterId: 'player-1',
    name: 'Traveler',
    locationId: 'market',
    revision: 7,
    health: { current: 10, maximum: 10 },
    wallet: { currencyId: 'moss-mark', balance: 20 },
    dailyJobs: [],
    supplyCollections: [],
    ...overrides,
  });
}

function harness(
  player: ReturnType<typeof character>,
  options: {
    world?: Record<string, unknown>;
    sharedState?: Record<string, unknown>;
    teamEvents?: Array<Record<string, unknown>>;
    pvpEvents?: Array<Record<string, unknown>>;
    characterExists?: boolean;
  } = {},
) {
  const commands = new Map<string, (command: any, context: any) => Promise<unknown>>();
  const queries = new Map<string, (query: any, context: any) => Promise<unknown>>();
  const worldItemsLoad = vi.fn(async () => options.sharedState ?? {
    revision: 0, items: [], corpses: [], currencyDrops: [],
  });
  dailyJobsPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
      commands.set(name, handler);
    },
    registerQuery: (name: string, _schema: unknown, handler: (query: any, context: any) => Promise<unknown>) => {
      queries.set(name, handler);
    },
    requireCapability: (token: { id: string }) => token.id === 'mudd.character.state.v1'
      ? { load: vi.fn(async () => options.characterExists === false ? undefined : player) }
      : { load: worldItemsLoad },
  } as never);
  const context = {
    world: { ...WORLD, ...options.world },
    worldInstanceId: 'world-1',
    now: () => NOW,
    makeId: () => 'gathered-id',
    store: {
      readStream: vi.fn(async (_worldId: string, streamId: string) =>
        streamId === 'world-team-combat' ? (options.teamEvents ?? []) : (options.pvpEvents ?? [])),
    },
  };
  return { commands, queries, context, worldItemsLoad };
}

function jobCommand(player: ReturnType<typeof character>, jobId = POSTED_JOB.id, action: 'accept' | 'deliver' = 'accept', cycle = CYCLE) {
  return {
    characterId: player.characterId,
    expectedVersion: player.revision,
    payload: { boardId: BOARD.id, cycle, jobId, action },
  };
}

function activeJob(status: 'active' | 'completed' = 'active') {
  return { boardId: BOARD.id, cycle: CYCLE, jobId: POSTED_JOB.id, title: POSTED_JOB.title, details: POSTED_JOB, status };
}

describe('daily board validation and query', () => {
  it('accepts valid board/source definitions and rejects duplicate or invalid definitions', () => {
    expect(() => dailyJobsPlugin.validateWorld?.(WORLD as never, {} as never)).not.toThrow();
    expect(() => dailyJobsPlugin.validateWorld?.({
      ...WORLD,
      dailyBoards: [BOARD, BOARD],
    } as never, {} as never)).toThrow('Daily boards require unique IDs, a valid location, and currency.');
    expect(() => dailyJobsPlugin.validateWorld?.({
      ...WORLD,
      dailyBoards: [{ ...BOARD, locationId: 'missing' }],
    } as never, {} as never)).toThrow('Daily boards require unique IDs, a valid location, and currency.');
    expect(() => dailyJobsPlugin.validateWorld?.({
      ...WORLD,
      dailyBoards: [{ ...BOARD, slots: [[POSTED_JOB, POSTED_JOB]] }],
    } as never, {} as never)).toThrow('Duplicate daily job ID.');
    expect(() => dailyJobsPlugin.validateWorld?.({
      ...WORLD,
      supplySources: [SOURCE, SOURCE],
    } as never, {} as never)).toThrow('Supply sources require unique IDs and a valid location.');
    expect(() => dailyJobsPlugin.validateWorld?.({
      ...WORLD,
      supplySources: [{ ...SOURCE, locationId: 'missing' }],
    } as never, {} as never)).toThrow('Supply sources require unique IDs and a valid location.');
  });

  it('returns the current daily offerings, carried supply count, and accepted status', async () => {
    const player = character({
      inventory: [
        { id: 'logs-a', typeId: POSTED_JOB.supplyTypeId, label: 'Pine logs', description: 'Logs.', stackable: true, quantity: 3 },
        { id: 'bound-logs', typeId: POSTED_JOB.supplyTypeId, label: 'Bound logs', description: 'Quest logs.', questBound: true },
      ],
      dailyJobs: [activeJob()],
    });
    const { queries, context } = harness(player);
    const result = await queries.get('daily.board')!({
      characterId: player.characterId,
      payload: { boardId: BOARD.id },
    }, context);
    expect(result).toMatchObject({
      boardId: BOARD.id,
      cycle: CYCLE,
      jobs: [{ id: POSTED_JOB.id, carried: 3, status: 'active' }],
    });
  });

  it('rejects unavailable characters and boards outside the current room', async () => {
    const player = character();
    const query = { characterId: player.characterId, payload: { boardId: BOARD.id } };
    await expect(harness(player, { characterExists: false }).queries.get('daily.board')!(query, harness(player).context))
      .rejects.toThrow('Choose an available character first.');
    const elsewhere = character({ locationId: 'road' });
    await expect(harness(elsewhere).queries.get('daily.board')!(query, harness(elsewhere).context))
      .rejects.toThrow('Visit that bulletin board first.');
    await expect(harness(player).queries.get('daily.board')!(
      { ...query, payload: { boardId: 'missing-board' } },
      harness(player).context,
    )).rejects.toThrow('Visit that bulletin board first.');
  });
});

describe('daily job commands', () => {
  it('accepts one posted job and rejects stale, unknown, duplicate, and invalid-state actions', async () => {
    const player = character();
    const { commands, context } = harness(player);
    const accept = commands.get('daily.job')!;
    const accepted = await accept(jobCommand(player), context);
    expect(accepted).toMatchObject({
      events: [{
        type: 'character.daily_job_changed',
        payload: {
          job: { boardId: BOARD.id, jobId: POSTED_JOB.id, status: 'active' },
          gold: 0,
          experience: 0,
        },
      }],
    });
    await expect(accept(jobCommand(player, POSTED_JOB.id, 'accept', '2026-10-26'), context))
      .rejects.toThrow('The bulletin refreshed. Read the new jobs.');
    await expect(accept(jobCommand(player, 'not-posted'), context))
      .rejects.toThrow('That job is not posted today.');

    const acceptedCharacter = character({ dailyJobs: [activeJob()] });
    await expect(harness(acceptedCharacter).commands.get('daily.job')!(
      jobCommand(acceptedCharacter),
      context,
    )).rejects.toThrow('You already accepted this job.');

    const completedCharacter = character({ dailyJobs: [activeJob('completed')] });
    await expect(harness(completedCharacter).commands.get('daily.job')!(
      jobCommand(completedCharacter, POSTED_JOB.id, 'deliver'),
      context,
    )).rejects.toThrow('Accept this job first; completed jobs cannot be delivered again.');
  });

  it('delivers a partially used stack, awards the posted rewards, and records consumed quantities', async () => {
    const player = character({
      inventory: [{
        id: 'pine-log-stack', typeId: POSTED_JOB.supplyTypeId, label: 'Pine logs',
        description: 'A stack of logs.', stackable: true, quantity: 5,
      }],
      dailyJobs: [activeJob()],
    });
    const { commands, context } = harness(player);
    const result = await commands.get('daily.job')!(
      jobCommand(player, POSTED_JOB.id, 'deliver'),
      context,
    );
    expect(result).toMatchObject({
      events: [{
        type: 'character.daily_job_changed',
        payload: {
          job: { status: 'completed' },
          consumedItemIds: [],
          consumedItemQuantities: [{ itemId: 'pine-log-stack', quantity: POSTED_JOB.quantity }],
          gold: POSTED_JOB.gold,
          experience: POSTED_JOB.experience,
          currencyId: 'moss-mark',
        },
      }],
    });
    expect(context.world.locations).toHaveLength(1);
  });

  it('stops selecting supplies once the required quantity is filled', async () => {
    const player = character({
      inventory: [
        {
          id: 'enough-logs', typeId: POSTED_JOB.supplyTypeId, label: 'Pine logs',
          description: 'A full stack.', stackable: true, quantity: POSTED_JOB.quantity,
        },
        { id: 'extra-logs', typeId: POSTED_JOB.supplyTypeId, label: 'Pine log', description: 'An extra log.' },
      ],
      dailyJobs: [activeJob()],
    });
    const { commands, context } = harness(player);
    const result = await commands.get('daily.job')!(
      jobCommand(player, POSTED_JOB.id, 'deliver'),
      context,
    );
    expect(result).toMatchObject({
      events: [{
        payload: {
          consumedItemIds: ['enough-logs'],
          consumedItemQuantities: [],
        },
      }],
    });
  });

  it('requires all eligible supplies and a ready wallet to complete a job', async () => {
    const player = character({ dailyJobs: [activeJob()], inventory: [] });
    await expect(harness(player).commands.get('daily.job')!(
      jobCommand(player, POSTED_JOB.id, 'deliver'),
      harness(player).context,
    )).rejects.toThrow(`Bring ${POSTED_JOB.quantity} eligible supplies for this job.`);

    const walletless = character({ dailyJobs: [activeJob()], wallet: undefined });
    await expect(harness(walletless).commands.get('daily.job')!(
      jobCommand(walletless, POSTED_JOB.id, 'deliver'),
      harness(walletless).context,
    )).rejects.toThrow('Your wallet is not ready.');
  });

  it('rejects rewards that would overflow the wallet or experience counter', async () => {
    const rich = character({
      wallet: { currencyId: 'moss-mark', balance: 2_147_483_647 },
      dailyJobs: [activeJob()],
      inventory: [{ id: 'logs', typeId: POSTED_JOB.supplyTypeId, label: 'Logs', description: 'Logs.', stackable: true, quantity: POSTED_JOB.quantity }],
    });
    await expect(harness(rich).commands.get('daily.job')!(
      jobCommand(rich, POSTED_JOB.id, 'deliver'),
      harness(rich).context,
    )).rejects.toThrow('Your wallet is full.');

    const xpCap = {
      ...character({
        dailyJobs: [activeJob()],
        inventory: [{
          id: 'logs', typeId: POSTED_JOB.supplyTypeId, label: 'Logs',
          description: 'Logs.', stackable: true, quantity: POSTED_JOB.quantity,
        }],
      }),
      advancement: { level: 1, experience: Number.MAX_SAFE_INTEGER },
    } as ReturnType<typeof character>;
    await expect(harness(xpCap).commands.get('daily.job')!(
      jobCommand(xpCap, POSTED_JOB.id, 'deliver'),
      harness(xpCap).context,
    )).rejects.toThrow('Experience limit reached.');
  });

  it('consumes owned shared supplies with an atomic companion stream and rejects unowned ones', async () => {
    const item = {
      id: 'shared-logs', sharedItemId: 'shared-logs', typeId: POSTED_JOB.supplyTypeId,
      label: 'Pine logs', description: 'Shared logs.',
    };
    const player = character({ inventory: [item], dailyJobs: [activeJob()] });
    const sharedState = {
      revision: 12,
      items: [{ worldItemId: 'shared-logs', holderCharacterId: player.characterId }],
      corpses: [],
      currencyDrops: [],
    };
    const { commands, context, worldItemsLoad } = harness(player, { sharedState });
    const result = await commands.get('daily.job')!(
      jobCommand(player, POSTED_JOB.id, 'deliver'),
      context,
    );
    expect(result).toMatchObject({
      companions: [{
        streamId: 'world-items',
        expectedVersion: 12,
        events: [{ type: 'world.items_consumed', payload: { worldItemIds: ['shared-logs'] } }],
      }],
    });
    expect(worldItemsLoad).toHaveBeenCalledOnce();

    const unowned = harness(player, {
      sharedState: { revision: 12, items: [], corpses: [], currencyDrops: [] },
    });
    await expect(unowned.commands.get('daily.job')!(
      jobCommand(player, POSTED_JOB.id, 'deliver'),
      unowned.context,
    )).rejects.toThrow('Those supplies are not yours to deliver.');
  });

  it('blocks unavailable, defeated, downed, or combat-locked characters', async () => {
    const missingPlayer = character();
    await expect(harness(missingPlayer, { characterExists: false }).commands.get('daily.job')!(
      jobCommand(missingPlayer),
      harness(missingPlayer).context,
    )).rejects.toThrow('Choose an available character first.');
    const defeated = character({ health: { current: 0, maximum: 10 } });
    await expect(harness(defeated).commands.get('daily.job')!(
      jobCommand(defeated),
      harness(defeated).context,
    )).rejects.toThrow();
    const resting = character({ staminaRecovery: { posture: 'resting', lastSettledAt: null, fractionalCarry: 0 } });
    await expect(harness(resting).commands.get('daily.job')!(
      jobCommand(resting),
      harness(resting).context,
    )).rejects.toThrow();
    const sharedCombat = harness(character(), {
      teamEvents: [{
        type: 'team.combat_started',
        payload: { encounter: { encounterId: 'team-1', status: 'active', participants: [{ characterId: 'player-1', status: 'active' }] } },
      }],
    });
    await expect(sharedCombat.commands.get('daily.job')!(
      jobCommand(character()),
      sharedCombat.context,
    )).rejects.toThrow('Finish the encounter first.');
  });
});

describe('supply gathering', () => {
  it('gathers a local supply once per day and produces a unique inventory item', async () => {
    const player = character();
    const { commands, context } = harness(player);
    const result = await commands.get('supply.gather')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { sourceId: SOURCE.id, cycle: CYCLE },
    }, context);
    expect(result).toMatchObject({
      events: [{
        type: 'character.supply_gathered',
        payload: {
          sourceId: SOURCE.id,
          cycle: CYCLE,
          item: { id: 'supply:gathered-id', typeId: SOURCE.supply.typeId },
        },
      }],
    });
  });

  it('rejects stale days, missing sources, daily-limit exhaustion, and unsafe character state', async () => {
    const player = character();
    const gather = harness(player).commands.get('supply.gather')!;
    const base = { characterId: player.characterId, expectedVersion: player.revision };
    await expect(gather({ ...base, payload: { sourceId: SOURCE.id, cycle: '2026-10-26' } }, harness(player).context))
      .rejects.toThrow('The day changed. Refresh your supplies.');
    await expect(gather({ ...base, payload: { sourceId: 'missing', cycle: CYCLE } }, harness(player).context))
      .rejects.toThrow('You cannot collect that supply here.');
    const exhausted = character({ supplyCollections: [{ sourceId: SOURCE.id, cycle: CYCLE, count: SOURCE.dailyLimit }] });
    await expect(harness(exhausted).commands.get('supply.gather')!(
      { ...base, payload: { sourceId: SOURCE.id, cycle: CYCLE } },
      harness(exhausted).context,
    )).rejects.toThrow('You have collected today’s allowance from this source.');
    const combat = harness(player, {
      pvpEvents: [{
        type: 'pvp.encounter.started',
        payload: { encounter: { status: 'active', participants: [{ characterId: player.characterId }] } },
      }],
    });
    await expect(combat.commands.get('supply.gather')!(
      { ...base, payload: { sourceId: SOURCE.id, cycle: CYCLE } },
      combat.context,
    )).rejects.toThrow('Finish the encounter first.');
  });
});
