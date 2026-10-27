import { describe, expect, it } from 'vitest';
import { DailyBoardProjectionSchema, NpcDialogueProjectionSchema, WorldPackDraftSchema, dailyPostings, type WorldPackDraft } from '@mudd/contracts';
import { EngineHost, InMemoryEventStore, replayCharacter, type EnginePlugin, type SessionContext } from '@mudd/engine-core';
import {
  characterPlugin, dailyJobsPlugin, worldItemsPlugin, movementPlugin, interactionPlugin,
  combatPlugin, roadTravelPlugin, teamCombatPlugin, teamCombatRosterPolicyCapability,
  npcDialoguePlugin,
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
function harness(encounterChancePercent = 0, bellwoldDialogue = false, configure?: (world: WorldPackDraft) => void) {
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
  if (bellwoldDialogue) {
    // Reuse actual authored jobs/responses in a compact, fully authorized test world.
    world.dailyBoards = orravethWorld.dailyBoards.map((board) => ({ ...board, locationId: 'board-room' }));
    world.locations[0]!.npcs = structuredClone(orravethWorld.locations.flatMap((room) =>
      (room.npcs ?? []).filter((npc) => ['tomas-innkeeper', 'seli-tor', 'darric-holt'].includes(npc.id))));
    world.supplySources = [
      ...orravethWorld.supplySources.map((source) => ({ ...source, locationId: 'board-room' })),
      { id: 'fixture-river-fish', locationId: 'board-room', label: 'Fish delivery supplies', dailyLimit: 6,
        supply: { typeId: 'river-fish', label: 'Fish', description: 'A freshly caught fish for the test fixture.' } },
      { id: 'fixture-hides', locationId: 'board-room', label: 'Collect hides', dailyLimit: 6,
        supply: { typeId: 'deer-hide', label: 'Hide', description: 'A deer hide.' } },
      { id: 'fixture-pine-logs', locationId: 'board-room', label: 'Collect pine logs', dailyLimit: 6,
        supply: { typeId: 'pine-logs', label: 'Pine Logs', description: 'A bundle of pine logs.' } },
    ];
  }
  configure?.(world);
  const plugins = [worldItemsPlugin, characterPlugin, interactionPlugin, combatPlugin, movementPlugin,
    roster, teamCombatPlugin, roadTravelPlugin, dailyJobsPlugin, npcDialoguePlugin];
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
      worldInstanceId: 'daily-world', characterId: id, payload: { boardId: world.dailyBoards[0]!.id } }, session());
    if (!response.ok) throw new Error(response.message);
    return DailyBoardProjectionSchema.parse(response.value);
  }
  async function talk(id: string, npcId: string, topic?: string, playerId = 'guest', host = engine) {
    const response = await host.query({ type: 'npc.talk', version: 1, queryId: `q-${++serial}`,
      worldInstanceId: 'daily-world', characterId: id, payload: { npcId, ...(topic ? { topic } : {}) } }, session(playerId));
    if (!response.ok) throw new Error(response.message);
    return NpcDialogueProjectionSchema.parse(response.value);
  }
  async function move(id: string, exitId: string) {
    const result = await command(id, 'character.road.step', { exitId });
    expect(result.receipt.ok).toBe(true);
    return result;
  }
  return { engine, makeEngine, store, world, session, create, command, board, talk, load, move,
    setClock(value: string) { clock = new Date(value); } };
}

describe('daily town jobs through an authorized engine', () => {
  it('acknowledges every Bellwold posting only for its character and current day, including after replay', async () => {
    const h = harness(0, true);
    await h.engine.start();
    try {
      const a = await h.create();
      const b = await h.create(); // Another character on the same account.
      const npcs = h.world.locations[0]!.npcs!;
      await expect(h.talk(a, 'tomas-innkeeper', undefined, 'stranger')).rejects.toThrow();
      const normal = async (id: string) => {
        for (const npc of npcs) {
          expect((await h.talk(id, npc.id)).text).toBe(npc.greeting);
          expect((await h.talk(id, npc.id, 'bulletin')).text).toBe(npc.topics[0]!.response);
        }
      };
      const assertResponse = async (id: string, npcId: string, jobId: string, status: string) => {
        const npc = npcs.find((candidate) => candidate.id === npcId)!;
        const expected = npc.dailyJobResponses!.find((entry) => entry.jobId === jobId && entry.status === status)!.response;
        expect((await h.talk(id, npcId)).text).toBe(expected);
        expect((await h.talk(id, npcId, 'bulletin')).text).toBe(expected);
        // Unrelated topics retain their ordinary response.
        expect((await h.talk(id, npcId, npc.topics[1]!.keywords[0])).text).toBe(npc.topics[1]!.response);
      };
      await normal(a);
      for (const day of ['2026-10-23', '2026-10-24']) {
        h.setClock(`${day}T12:00:00.000Z`);
        await normal(a);
        const board = await h.board(a);
        for (const job of day === '2026-10-24' ? [...board.jobs].reverse() : board.jobs) {
          const npc = npcs.find((candidate) => candidate.dailyJobResponses?.some((entry) => entry.jobId === job.id))!;
          const payload = { boardId: board.boardId, cycle: board.cycle, jobId: job.id };
          expect((await h.command(a, 'daily.job', { ...payload, action: 'accept' })).receipt.ok).toBe(true);
          // Tomas may already be acknowledging a completed fish job when his wood job is active.
          const earlierCompleted = (await h.load(a)).dailyJobs.some((entry) => entry.cycle === board.cycle &&
            entry.status === 'completed' && npc.dailyJobResponses?.some((response) => response.jobId === entry.jobId));
          if (!earlierCompleted) await assertResponse(a, npc.id, job.id, 'active');
          const source = h.world.supplySources.find((entry) => entry.supply.typeId === job.supplyTypeId)!;
          for (let i = 0; i < job.quantity; i++) {
            expect((await h.command(a, 'supply.gather', { sourceId: source.id, cycle: board.cycle })).receipt.ok).toBe(true);
          }
          expect((await h.command(a, 'daily.job', { ...payload, action: 'deliver' })).receipt.ok).toBe(true);
          const completedJobs = (await h.load(a)).dailyJobs.filter((entry) =>
            entry.cycle === board.cycle && entry.status === 'completed');
          const expectedJob = npc.dailyJobResponses!.find((response) => response.status === 'completed' &&
            completedJobs.some((entry) => entry.jobId === response.jobId))!.jobId;
          await assertResponse(a, npc.id, expectedJob, 'completed');
          await normal(b);
        }
        const restarted = h.makeEngine();
        await restarted.start();
        try {
          for (const npc of npcs) {
            expect(await h.talk(a, npc.id, undefined, 'guest', restarted)).toEqual(await h.talk(a, npc.id));
          }
        } finally { await restarted.stop(); }
      }
      // A repeated template two days later must not inherit its old completion.
      h.setClock('2026-10-25T00:00:00.000Z');
      await normal(a);
      const next = await h.board(a);
      const job = next.jobs[0]!;
      expect((await h.command(a, 'daily.job', {
        boardId: next.boardId, cycle: next.cycle, jobId: job.id, action: 'accept',
      })).receipt.ok).toBe(true);
      await assertResponse(a, 'seli-tor', job.id, 'active');
      expect((await h.load(a)).questProgress).toEqual([]);
      expect((await h.load(a)).npcProgress).toEqual([]);
    } finally { await h.engine.stop(); }
  });

  it('expires unfinished resident acknowledgements at midnight without changing the ledger on talk', async () => {
    const h = harness(0, true);
    await h.engine.start();
    try {
      const id = await h.create();
      const board = await h.board(id);
      for (const job of board.jobs) {
        expect((await h.command(id, 'daily.job', {
          boardId: board.boardId, cycle: board.cycle, jobId: job.id, action: 'accept',
        })).receipt.ok).toBe(true);
      }
      const before = await h.load(id);
      for (const npc of h.world.locations[0]!.npcs!) {
        const matching = npc.dailyJobResponses!.some((response) =>
          board.jobs.some((job) => job.id === response.jobId));
        if (matching) expect((await h.talk(id, npc.id)).text).not.toBe(npc.greeting);
      }
      h.setClock('2026-10-24T00:00:00.000Z');
      for (const npc of h.world.locations[0]!.npcs!) {
        expect((await h.talk(id, npc.id)).text).toBe(npc.greeting);
        expect((await h.talk(id, npc.id, 'bulletin')).text).toBe(npc.topics[0]!.response);
      }
      expect(await h.load(id)).toEqual(before);
    } finally { await h.engine.stop(); }
  });

  it('preserves one-time quest responses, objective-gated choices and the party quest command boundary', async () => {
    const h = harness(0, true, (world) => {
      const npc = world.locations[0]!.npcs!.find((entry) => entry.id === 'tomas-innkeeper')!;
      world.quests = ['character', 'party'].map((scope) => ({
        id: `visit-${scope}`, version: '1', title: 'Visit the bank', summary: 'Look at the river.',
        scope: scope as 'character' | 'party', giverNpcId: npc.id, turnInNpcId: npc.id,
        objectives: [{ id: 'visit-bank', type: 'visit-location', locationId: 'bank', label: 'Visit the bank' }],
      }));
      npc.dialogue = {
        prompt: 'Ordinary conversation.',
        questResponses: [
          { questId: 'visit-character', status: 'active', requiresCompletedObjectiveIds: [],
            requiresIncompleteObjectiveIds: [], response: 'Have you visited the bank?' },
          { questId: 'visit-character', status: 'completed', requiresCompletedObjectiveIds: [],
            requiresIncompleteObjectiveIds: [], response: 'Thank you for checking the river.' },
        ],
        choices: [
          { id: 'accept', label: 'Visit the bank', response: 'Go safely.', progressFlagId: 'accepted',
            questAction: { type: 'accept', questId: 'visit-character' } },
          { id: 'report', label: 'Report back', response: 'Good.', progressFlagId: 'reported',
            questCondition: { questId: 'visit-character', status: 'active',
              requiresCompletedObjectiveIds: ['visit-bank'], requiresIncompleteObjectiveIds: [] },
            questAction: { type: 'turn-in', questId: 'visit-character' } },
          { id: 'party', label: 'Party job', response: 'Not here.', progressFlagId: 'party',
            questAction: { type: 'accept', questId: 'visit-party' } },
        ],
      };
    });
    await h.engine.start();
    try {
      const id = await h.create();
      const board = await h.board(id);
      const fish = board.jobs.find((job) => job.poster === 'Tomas')!;
      expect((await h.command(id, 'daily.job', { boardId: board.boardId, cycle: board.cycle,
        jobId: fish.id, action: 'accept' })).receipt.ok).toBe(true);
      const choose = (choiceId: string) => h.command(id, 'npc.dialogue.choose', { npcId: 'tomas-innkeeper', choiceId });
      expect((await h.talk(id, 'tomas-innkeeper')).choices.map((choice) => choice.id)).toEqual(['accept']);
      expect((await choose('party')).receipt.ok).toBe(false);
      expect((await choose('report')).receipt.ok).toBe(false);
      expect((await choose('accept')).receipt.ok).toBe(true);
      expect((await h.talk(id, 'tomas-innkeeper')).text).toBe('Have you visited the bank?');
      expect((await h.talk(id, 'tomas-innkeeper')).choices).toEqual([]);
      await h.move(id, 'out');
      await h.move(id, 'back');
      expect((await h.talk(id, 'tomas-innkeeper')).choices.map((choice) => choice.id)).toEqual(['report']);
      expect((await choose('report')).receipt.ok).toBe(true);
      const before = await h.load(id);
      expect(before.questProgress).toMatchObject([{ questId: 'visit-character', status: 'completed' }]);
      h.setClock('2026-10-24T00:00:00.000Z');
      expect((await h.talk(id, 'tomas-innkeeper')).text).toBe('Thank you for checking the river.');
      expect((await h.talk(id, 'tomas-innkeeper')).choices).toEqual([]);
      expect((await choose('accept')).receipt.ok).toBe(false);
      expect((await choose('party')).receipt.ok).toBe(false);
      expect(await h.load(id)).toEqual(before);
    } finally { await h.engine.stop(); }
  });

  it('rotates Bellwold’s postings to supplies supported by world activities', () => {
    const board = orravethWorld.dailyBoards[0]!;
    const today = dailyPostings(board, '2026-10-23');
    expect(today.map((job) => job.supplyTypeId)).toEqual(['deer-hide', 'river-fish', 'pine-logs']);
    expect(dailyPostings(board, '2026-10-24').map((job) => job.id)).not.toEqual(today.map((job) => job.id));
    expect(orravethWorld.fishingSpots.flatMap((spot) => spot.species.map((species) => species.itemTypeId)))
      .toContain('river-fish');
    expect(orravethWorld.woodcuttingTrees.map((tree) => tree.logTypeId)).toContain('pine-logs');
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

  it('delivers a fully consumed stack using its unit quantity during replay', async () => {
    const h = harness(0, false, (world) => {
      world.dailyBoards[0]!.slots[0] = world.dailyBoards[0]!.slots[0]!.map((job) => ({
        ...job,
        supplyTypeId: 'pine-logs',
        quantity: 3,
      }));
      world.locations[0]!.takeables.push({
        id: 'pine-logs-stack',
        typeId: 'pine-logs',
        label: 'Pine Logs',
        description: 'Three bundled pine logs.',
        stackable: true,
        quantity: 3,
      });
    });
    await h.engine.start();
    try {
      const id = await h.create();
      const board = await h.board(id);
      const job = board.jobs[0]!;
      const payload = { boardId: 'board', cycle: board.cycle, jobId: job.id };
      expect((await h.command(id, 'character.take', { itemId: 'pine-logs-stack' })).receipt.ok).toBe(true);
      expect((await h.load(id)).inventory).toContainEqual(expect.objectContaining({
        id: 'pine-logs-stack',
        typeId: 'pine-logs',
        quantity: 3,
      }));
      expect((await h.command(id, 'daily.job', { ...payload, action: 'accept' })).receipt.ok).toBe(true);

      const delivered = await h.command(id, 'daily.job', { ...payload, action: 'deliver' });
      expect(delivered.receipt.ok).toBe(true);
      const character = await h.load(id);
      expect(character.inventory.some((item) => item.typeId === 'pine-logs')).toBe(false);
      expect(character.dailyJobs.find((entry) => entry.jobId === job.id)?.status).toBe('completed');
      expect(character.wallet?.balance).toBe(job.gold);
      expect(character.advancement?.experience).toBe(job.experience);
    } finally { await h.engine.stop(); }
  });

  it('keeps unused units when a daily job consumes part of a stack', async () => {
    const h = harness(0, false, (world) => {
      world.dailyBoards[0]!.slots[0] = world.dailyBoards[0]!.slots[0]!.map((job) => ({
        ...job,
        supplyTypeId: 'pine-logs',
        quantity: 3,
      }));
      world.locations[0]!.takeables.push({
        id: 'pine-logs-stack',
        typeId: 'pine-logs',
        label: 'Pine Logs',
        description: 'Five bundled pine logs.',
        stackable: true,
        quantity: 5,
      });
    });
    await h.engine.start();
    try {
      const id = await h.create();
      const board = await h.board(id);
      const job = board.jobs[0]!;
      const payload = { boardId: 'board', cycle: board.cycle, jobId: job.id };
      expect((await h.command(id, 'character.take', { itemId: 'pine-logs-stack' })).receipt.ok).toBe(true);
      expect((await h.command(id, 'daily.job', { ...payload, action: 'accept' })).receipt.ok).toBe(true);
      expect((await h.command(id, 'daily.job', { ...payload, action: 'deliver' })).receipt.ok).toBe(true);
      expect((await h.load(id)).inventory).toContainEqual(expect.objectContaining({
        id: 'pine-logs-stack',
        typeId: 'pine-logs',
        quantity: 2,
      }));
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
