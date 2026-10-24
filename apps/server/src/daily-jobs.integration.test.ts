import { describe, expect, it } from 'vitest';
import { DailyBoardProjectionSchema, WorldPackDraftSchema, dailyPostings } from '@mudd/contracts';
import { EngineHost, InMemoryEventStore, replayCharacter, type EnginePlugin, type SessionContext } from '@mudd/engine-core';
import {
  characterPlugin, dailyJobsPlugin, worldItemsPlugin, movementPlugin, interactionPlugin,
  combatPlugin, roadTravelPlugin, teamCombatPlugin, teamCombatRosterPolicyCapability,
} from '@mudd/core-plugins';
import { orravethWorld } from '@mudd/world-orraveth';

const roster: EnginePlugin = {
  manifest: { id: 'fixture.roster', version: '1.0.0', apiVersion: '1.0', category: 'first-party',
    provides: [teamCombatRosterPolicyCapability.id] },
  register({ provideCapability }) {
    provideCapability(teamCombatRosterPolicyCapability, {
      async resolve() { throw new Error('No party.'); },
      async resolveIfPartyPresent() { return undefined; },
    });
  },
};
function harness(encounterChancePercent = 0) {
  let serial = 0;
  let clock = new Date('2026-10-23T23:59:00.000Z');
  const store = new InMemoryEventStore();
  const owners = new Map<string, string>();
  const world = WorldPackDraftSchema.parse({
    formatVersion: 1, packId: 'daily-fixture', packVersion: '1.0.0', displayName: 'Daily jobs',
    currency: { id: 'gold', name: 'gold', symbol: 'g', startingBalance: 0 },
    locations: [
      { id: 'board-room', name: 'Common', description: 'A wooden bulletin board stands here.',
        takeables: [
          { id: 'bound-fish', typeId: 'river-fish', questBound: true, label: 'Fish', description: 'A fish promised to someone else.' },
          { id: 'fish-carving', label: 'Fish', description: 'A wooden carving, not a real fish.' },
        ],
        exits: [{ id: 'out', fromLocationId: 'board-room', toLocationId: 'bank', label: 'south', direction: 'south', roadId: 'road' }] },
      { id: 'bank', name: 'Riverbank', description: 'Fish ripple the water.',
        exits: [
          { id: 'back', fromLocationId: 'bank', toLocationId: 'board-room', label: 'north', direction: 'north', roadId: 'road' },
          { id: 'on', fromLocationId: 'bank', toLocationId: 'end', label: 'south', direction: 'south', roadId: 'road' },
        ] },
      { id: 'end', name: 'Road end', description: 'Dry twigs lie here.', exits: [] },
    ],
    dailyBoards: [{ id: 'board', locationId: 'board-room', name: 'Common jobs', slots: [
      [0, 1].map((variant) => ({ id: `fish-${variant}`, poster: 'Cook', title: `Supper fish ${variant}`,
        supplyTypeId: 'river-fish', quantity: 2, gold: 5, experience: 25 })),
      [0, 1].map((variant) => ({ id: `hide-${variant}`, poster: 'Weaver', title: `A hide ${variant}`,
        supplyTypeId: 'deer-hide', quantity: 1, gold: 4, experience: 5 })),
    ] }],
    supplySources: [{ id: 'fish', locationId: 'bank', label: 'Catch fish', dailyLimit: 3,
      supply: { typeId: 'river-fish', label: 'Fish', description: 'A silver fish.' } }],
    roads: [{ id: 'road', name: 'Road', locationIds: ['board-room', 'bank', 'end'], encounterChancePercent,
      encounters: [{ id: 'deer', name: 'Deer', combatProfile: { maxHealth: 1, attackDamage: 1 },
        loot: { items: [{ id: 'hide-template', typeId: 'deer-hide', label: 'Hide', description: 'A deer hide.' }] } }] }],
  });
  const plugins = [worldItemsPlugin, characterPlugin, interactionPlugin, combatPlugin, movementPlugin,
    roster, teamCombatPlugin, roadTravelPlugin, dailyJobsPlugin];
  const makeEngine = () => new EngineHost(plugins, store, {
    canAccessInstance: async (_, id) => id === 'daily-world',
    ownsCharacter: async (session, id) => owners.get(id) === session.playerId,
  }, world, () => `daily-id-${++serial}`, () => clock, { roll: () => 1 });
  const engine = makeEngine();
  const session = (playerId = 'guest'): SessionContext => ({
    sessionId: `${playerId}-session`, playerId, actorId: playerId, worldInstanceId: 'daily-world',
    grantedPermissions: [], authenticated: true,
  });
  const load = async (id: string) => replayCharacter(await store.readStream('daily-world', id))!;
  async function create(playerId = 'guest') {
    const result = await engine.dispatch({ type: 'character.create', version: 1, commandId: `create-${++serial}`,
      worldInstanceId: 'daily-world', payload: { name: 'Traveler' } }, session(playerId));
    expect(result.receipt.ok).toBe(true);
    owners.set(result.streamId!, playerId);
    return result.streamId!;
  }
  async function command(id: string, type: string, payload: unknown, options: {
    commandId?: string; expectedVersion?: number; playerId?: string; worldInstanceId?: string;
  } = {}) {
    return engine.dispatch({ type, version: 1, commandId: options.commandId ?? `cmd-${++serial}`,
      worldInstanceId: options.worldInstanceId ?? 'daily-world', characterId: id,
      expectedVersion: options.expectedVersion ?? (await load(id)).revision, payload }, session(options.playerId));
  }
  async function board(id: string) {
    const response = await engine.query({ type: 'daily.board', version: 1, queryId: `q-${++serial}`,
      worldInstanceId: 'daily-world', characterId: id, payload: { boardId: 'board' } }, session());
    if (!response.ok) throw new Error(response.message);
    return DailyBoardProjectionSchema.parse(response.value);
  }
  async function move(id: string, exitId: string) {
    const result = await command(id, 'character.road.step', { exitId });
    expect(result.receipt.ok).toBe(true);
    return result;
  }
  return { engine, makeEngine, store, world, session, create, command, board, load, move,
    setClock(value: string) { clock = new Date(value); } };
}

describe('daily town jobs through an authorized engine', () => {
  it('rotates Bellwold’s three supply slots deterministically with valid sources', () => {
    const board = orravethWorld.dailyBoards[0]!;
    const today = dailyPostings(board, '2026-10-23');
    expect(today.map((job) => job.supplyTypeId)).toEqual(['deer-hide', 'river-fish', 'firewood']);
    expect(dailyPostings(board, '2026-10-24').map((job) => job.id)).not.toEqual(today.map((job) => job.id));
    expect(orravethWorld.supplySources.map((source) => source.supply.typeId)).toEqual(['river-fish', 'firewood']);
    expect(orravethWorld.roads.flatMap((road) => road.encounters).some((encounter) =>
      encounter.loot?.items.some((item) => item.typeId === 'deer-hide'))).toBe(true);
  });

  it('gathers bounded physical supplies, consumes exact quantities, grants gold/XP and survives replay', async () => {
    const h = harness();
    await h.engine.start();
    try {
      const id = await h.create();
      const board = await h.board(id);
      const job = board.jobs[0]!;
      const payload = { boardId: 'board', cycle: board.cycle, jobId: job.id };
      expect((await h.command(id, 'character.take', { itemId: 'bound-fish' })).receipt.ok).toBe(true);
      expect((await h.command(id, 'character.take', { itemId: 'fish-carving' })).receipt.ok).toBe(true);
      expect((await h.command(id, 'daily.job', { ...payload, action: 'accept' })).receipt.ok).toBe(true);
      expect((await h.command(id, 'daily.job', { ...payload, action: 'deliver' })).receipt.ok).toBe(false);
      expect((await h.command(id, 'supply.gather', { sourceId: 'fish', cycle: board.cycle })).receipt.ok).toBe(false);
      await h.move(id, 'out');
      for (let i = 0; i < 3; i++) expect((await h.command(id, 'supply.gather', { sourceId: 'fish', cycle: board.cycle })).receipt.ok).toBe(true);
      expect((await h.command(id, 'supply.gather', { sourceId: 'fish', cycle: board.cycle })).receipt.ok).toBe(false);
      const before = await h.load(id);
      expect(new Set(before.inventory.map((item) => item.id)).size).toBe(5);
      await h.move(id, 'back');
      const version = (await h.load(id)).revision;
      const competing = await Promise.all(['delivery', 'competing-delivery'].map((commandId) =>
        h.command(id, 'daily.job', { ...payload, action: 'deliver' }, { commandId, expectedVersion: version })));
      expect(competing.filter((result) => result.receipt.ok)).toHaveLength(1);
      const first = competing.find((result) => result.receipt.ok)!;
      const duplicate = await h.command(id, 'daily.job', { ...payload, action: 'deliver' },
        { commandId: first.receipt.commandId, expectedVersion: version });
      expect(duplicate.receipt).toEqual(first.receipt);
      const after = await h.load(id);
      expect(after.inventory).toHaveLength(3);
      expect(after.inventory.map((item) => item.id)).toEqual(expect.arrayContaining(['bound-fish', 'fish-carving']));
      expect(after.wallet?.balance).toBe(5);
      expect(after.advancement).toMatchObject({ experience: 25, level: 2 });
      expect(after.dailyJobs[0]?.status).toBe('completed');
      expect((await h.command(id, 'daily.job', { ...payload, action: 'deliver' })).receipt.ok).toBe(false);
      const restarted = h.makeEngine();
      await restarted.start();
      const response = await restarted.query({ type: 'daily.board', version: 1, queryId: 'after-restart',
        worldInstanceId: 'daily-world', characterId: id, payload: { boardId: 'board' } }, h.session());
      expect(response).toMatchObject({ ok: true, value: { jobs: [expect.objectContaining({ status: 'completed' }), expect.anything()] } });
      await restarted.stop();
    } finally { await h.engine.stop(); }
  });

  it('keeps characters independent, rejects unauthorized/cross-world access and expires stale requests at midnight', async () => {
    const h = harness();
    await h.engine.start();
    try {
      const a = await h.create();
      const b = await h.create();
      const board = await h.board(a);
      expect(await h.board(b)).toEqual(board);
      const payload = { boardId: 'board', cycle: board.cycle, jobId: board.jobs[0]!.id, action: 'accept' };
      expect((await h.command(a, 'daily.job', payload, { playerId: 'stranger' })).receipt).toMatchObject({ ok: false, code: 'FORBIDDEN' });
      expect((await h.command(a, 'daily.job', payload, { worldInstanceId: 'other-world' })).receipt.ok).toBe(false);
      const revision = (await h.load(a)).revision;
      const racing = await Promise.all([h.command(a, 'daily.job', payload, { expectedVersion: revision }), h.command(a, 'daily.job', payload, { expectedVersion: revision })]);
      expect(racing.filter((result) => result.receipt.ok)).toHaveLength(1);
      expect((await h.board(b)).jobs[0]?.status).toBe('available');
      h.setClock('2026-10-24T00:00:00.000Z');
      expect((await h.command(a, 'daily.job', payload)).receipt.ok).toBe(false);
      const tomorrow = await h.board(a);
      expect(tomorrow.cycle).toBe('2026-10-24');
      expect(tomorrow.jobs.every((job) => job.status === 'available')).toBe(true);
      expect((await h.command(a, 'daily.job', { ...payload, cycle: tomorrow.cycle, jobId: tomorrow.jobs[0]!.id })).receipt.ok).toBe(true);
    } finally { await h.engine.stop(); }
  });

  it('persists source limits and resets them at midnight without deleting yesterday’s supplies', async () => {
    const h = harness();
    await h.engine.start();
    try {
      const id = await h.create();
      await h.move(id, 'out');
      const cycle = '2026-10-23';
      const version = (await h.load(id)).revision;
      const first = await h.command(id, 'supply.gather', { sourceId: 'fish', cycle },
        { commandId: 'catch-once', expectedVersion: version });
      expect(first.receipt.ok).toBe(true);
      expect((await h.command(id, 'supply.gather', { sourceId: 'fish', cycle },
        { commandId: 'catch-once', expectedVersion: version })).receipt).toEqual(first.receipt);
      for (let i = 0; i < 2; i++) expect((await h.command(id, 'supply.gather', { sourceId: 'fish', cycle })).receipt.ok).toBe(true);
      const restarted = h.makeEngine();
      await restarted.start();
      const full = await h.load(id);
      const rejected = await restarted.dispatch({ type: 'supply.gather', version: 1, commandId: 'after-source-restart',
        worldInstanceId: 'daily-world', characterId: id, expectedVersion: full.revision,
        payload: { sourceId: 'fish', cycle } }, h.session());
      expect(rejected.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
      await restarted.stop();
      h.setClock('2026-10-24T00:00:00.000Z');
      expect((await h.command(id, 'supply.gather', { sourceId: 'fish', cycle })).receipt.ok).toBe(false);
      expect((await h.command(id, 'supply.gather', { sourceId: 'fish', cycle: '2026-10-24' })).receipt.ok).toBe(true);
      const next = await h.load(id);
      expect(next.inventory).toHaveLength(4);
      expect(next.supplyCollections).toEqual([{ sourceId: 'fish', cycle: '2026-10-24', count: 1 }]);
    } finally { await h.engine.stop(); }
  });

  it('drops deer hide into a searchable shared corpse and atomically consumes claimed hide on delivery', async () => {
    const h = harness(100);
    await h.engine.start();
    try {
      const id = await h.create();
      const board = await h.board(id);
      const job = board.jobs[1]!;
      const payload = { boardId: 'board', cycle: board.cycle, jobId: job.id };
      expect((await h.command(id, 'daily.job', { ...payload, action: 'accept' })).receipt.ok).toBe(true);
      await h.move(id, 'out');
      const fight = (await h.load(id)).combat!;
      expect((await h.command(id, 'combat.action', { action: 'attack', encounterId: fight.encounterId })).receipt.ok).toBe(true);
      await h.engine.processPendingEffects(100);
      const shared = await h.store.readStream('daily-world', 'world-items');
      const created = shared.find((event) => event.type === 'world.corpse_created')!;
      expect(created).toBeDefined();
      const corpse = created.payload as { corpse: { corpseId: string }; items: { worldItemId: string }[] };
      const itemId = corpse.items[0]!.worldItemId;
      expect((await h.command(id, 'character.take', { itemId })).receipt.ok).toBe(true);
      await h.engine.processPendingEffects(100);
      expect((await h.load(id)).inventory[0]).toMatchObject({ id: itemId, typeId: 'deer-hide' });
      await h.move(id, 'back');
      const secondFight = (await h.load(id)).combat!;
      expect((await h.command(id, 'combat.action', { action: 'attack', encounterId: secondFight.encounterId })).receipt.ok).toBe(true);
      await h.engine.processPendingEffects(100);
      expect((await h.command(id, 'daily.job', { ...payload, action: 'deliver' })).receipt.ok).toBe(true);
      expect((await h.load(id)).inventory).toHaveLength(0);
      expect((await h.store.readStream('daily-world', 'world-items')).at(-1)).toMatchObject({
        type: 'world.items_consumed', payload: { worldItemIds: [itemId] },
      });
    } finally { await h.engine.stop(); }
  });
});
