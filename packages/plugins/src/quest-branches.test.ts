import { describe, expect, it } from 'vitest';
import {
  EngineHost,
  InMemoryEventStore,
  type AuthorizationPort,
} from '@mudd/engine-core';
import {
  WorldPackDraftSchema,
  validateDraftWorldGraph,
  type QuestJournalEntry,
  type SessionContext,
  type WorldPackDraft,
} from '@mudd/contracts';
import { demoWorld, DEMO_WORLD_INSTANCE_ID } from '@mudd/world-demo';
import {
  characterPlugin,
  merchantPlugin,
  npcDialoguePlugin,
  questBranchesPlugin,
  QUEST_WORLD_OUTCOMES_STREAM_ID,
  worldItemsPlugin,
} from './index.js';

const worldInstanceId = DEMO_WORLD_INSTANCE_ID;
const NPC_ID = 'mara-waykeeper';
const QUEST_ID = 'common-measure-test';
const POLICY_KEY = 'test-passage-policy';

// Modeled on The Common Measure: a hearing, then one of three ways to run passage.
const commonMeasure = {
  id: QUEST_ID,
  version: '2',
  title: 'The Common Measure',
  summary: 'Hear both sides, then decide how passage should be measured.',
  giverNpcId: NPC_ID,
  turnInNpcId: NPC_ID,
  reward: { currencyId: 'moss-mark', amount: 5 },
  objectives: [{
    id: 'read-the-measure',
    label: 'Read the marker’s measure',
    type: 'read-object',
    objectId: 'mossgate-marker',
    locationId: 'mossgate-clearing',
  }],
  branching: {
    startBranchId: 'hearing',
    branches: [
      {
        id: 'hearing',
        label: 'Hear both sides',
        objectiveIds: ['read-the-measure'],
        choices: [
          {
            id: 'back-regulated',
            label: 'Back regulated passage',
            npcId: NPC_ID,
            toBranchId: 'regulated',
            worldOutcome: { key: POLICY_KEY, value: 'regulated', label: 'Passage runs under a posted charter.' },
          },
          {
            id: 'back-carriers',
            label: 'Back the independent carriers',
            npcId: NPC_ID,
            toBranchId: 'carriers',
            worldOutcome: { key: POLICY_KEY, value: 'independent', label: 'Independent carriers set their own terms.' },
          },
          {
            id: 'propose-protocol',
            label: 'Propose a shared protocol',
            npcId: NPC_ID,
            toBranchId: 'protocol',
            requires: [{ type: 'visited-location', locationId: 'bell-tower' }],
            worldOutcome: { key: POLICY_KEY, value: 'shared-protocol', label: 'Both sides keep a shared protocol.' },
          },
        ],
      },
      { id: 'regulated', label: 'Regulated passage', outcomeId: 'outcome-regulated' },
      { id: 'carriers', label: 'Independent carriers', outcomeId: 'outcome-carriers' },
      { id: 'protocol', label: 'Shared protocol', outcomeId: 'outcome-protocol' },
    ],
    outcomes: [
      { id: 'outcome-regulated', label: 'Regulated passage', summary: 'The charter now governs the crossing.' },
      { id: 'outcome-carriers', label: 'Independent carriers', summary: 'The carriers keep their own terms.' },
      { id: 'outcome-protocol', label: 'Shared protocol', summary: 'A common measure binds both sides.' },
    ],
  },
  previousVersions: [{
    version: '1',
    objectiveIds: ['read-the-measure'],
    branchIds: ['hearing', 'regulated', 'carriers'],
    choices: [
      { id: 'back-regulated', fromBranchId: 'hearing', toBranchId: 'regulated' },
      { id: 'back-carriers', fromBranchId: 'hearing', toBranchId: 'carriers' },
    ],
    outcomeIds: ['outcome-regulated', 'outcome-carriers'],
  }],
};

const dialogueChoice = (id: string, questAction: Record<string, unknown>) => ({
  id,
  label: `Dialogue ${id}`,
  response: `Response ${id}`,
  progressFlagId: `flag-${id}`,
  questAction,
});

function branchingWorld(): WorldPackDraft {
  const draft = structuredClone(demoWorld) as unknown as {
    quests: unknown[];
    locations: Array<{ id: string; npcs?: Array<{ id: string; dialogue?: unknown }> }>;
  };
  const mara = draft.locations.find((location) => location.id === 'mossgate-clearing')!
    .npcs!.find((npc) => npc.id === NPC_ID)!;
  mara.dialogue = {
    prompt: 'The crossing needs a measure.',
    choices: [
      dialogueChoice('cm-accept', { type: 'accept', questId: QUEST_ID }),
      dialogueChoice('cm-regulated', { type: 'choose', questId: QUEST_ID, choiceId: 'back-regulated' }),
      dialogueChoice('cm-carriers', { type: 'choose', questId: QUEST_ID, choiceId: 'back-carriers' }),
      dialogueChoice('cm-protocol', { type: 'choose', questId: QUEST_ID, choiceId: 'propose-protocol' }),
      dialogueChoice('cm-report', { type: 'turn-in', questId: QUEST_ID }),
    ],
    questResponses: [{
      questId: QUEST_ID,
      status: 'active',
      branchId: 'carriers',
      response: 'The carriers will remember you stood with them.',
    }],
  };
  draft.quests.push(commonMeasure);
  return WorldPackDraftSchema.parse(draft);
}

class BarrierStore extends InMemoryEventStore {
  /** When set, outcome-stream reads wait until this many readers arrive. */
  barrier?: { waiting: number; release: () => void; ready: Promise<void> };
  override async readStream(world: string, streamId: string) {
    const events = await super.readStream(world, streamId);
    if (streamId === QUEST_WORLD_OUTCOMES_STREAM_ID && this.barrier) {
      this.barrier.waiting -= 1;
      if (this.barrier.waiting <= 0) this.barrier.release();
      await this.barrier.ready;
    }
    return events;
  }
}

function setup(store = new BarrierStore(), world = branchingWorld()) {
  const owners = new Map<string, string>();
  const authorization: AuthorizationPort = {
    canAccessInstance: async () => true,
    ownsCharacter: async (session, characterId) => owners.get(characterId) === session.playerId,
  };
  const createEngine = () => new EngineHost(
    [worldItemsPlugin, characterPlugin, merchantPlugin, questBranchesPlugin, npcDialoguePlugin],
    store,
    authorization,
    world,
  );
  return { store, owners, world, createEngine };
}

function session(playerId: string): SessionContext {
  return {
    sessionId: `session-${playerId}`,
    playerId,
    actorId: playerId,
    worldInstanceId,
    grantedPermissions: [],
    authenticated: true,
  };
}

type Harness = ReturnType<typeof setup>;

async function revision(store: InMemoryEventStore, characterId: string) {
  return store.readStreamRevision(worldInstanceId, characterId);
}

async function createCharacter(harness: Harness, engine: EngineHost, playerId: string) {
  const created = await engine.dispatch({
    type: 'character.create',
    version: 1,
    commandId: `create-${playerId}`,
    worldInstanceId,
    payload: { name: `Traveler ${playerId}` },
  }, session(playerId));
  expect(created.receipt.ok).toBe(true);
  const characterId = created.streamId!;
  harness.owners.set(characterId, playerId);
  return characterId;
}

async function command(
  harness: Harness,
  engine: EngineHost,
  playerId: string,
  characterId: string,
  type: string,
  payload: Record<string, unknown>,
  commandId: string = globalThis.crypto.randomUUID(),
) {
  return engine.dispatch({
    type,
    version: 1,
    commandId,
    worldInstanceId,
    characterId,
    expectedVersion: await revision(harness.store, characterId),
    payload,
  }, session(playerId));
}

async function journal(engine: EngineHost, playerId: string, characterId: string) {
  const result = await engine.query({
    type: 'quest.journal',
    version: 1,
    queryId: globalThis.crypto.randomUUID(),
    worldInstanceId,
    characterId,
    payload: {},
  }, session(playerId));
  if (!result.ok) throw new Error(result.message);
  return (result.value as QuestJournalEntry[]).find((entry) => entry.questId === QUEST_ID);
}

async function talk(engine: EngineHost, playerId: string, characterId: string) {
  const result = await engine.query({
    type: 'npc.talk',
    version: 1,
    queryId: globalThis.crypto.randomUUID(),
    worldInstanceId,
    characterId,
    payload: { npcId: NPC_ID },
  }, session(playerId));
  if (!result.ok) throw new Error(result.message);
  return result.value as { text: string; choices: Array<{ id: string }> };
}

/** Accept the quest and complete the hearing branch's objective. */
async function readyToDecide(harness: Harness, engine: EngineHost, playerId: string) {
  const characterId = await createCharacter(harness, engine, playerId);
  const dialogue = 'npc.dialogue.choose';
  expect((await command(harness, engine, playerId, characterId, dialogue, { npcId: NPC_ID, choiceId: 'cm-accept' })).receipt.ok)
    .toBe(true);
  expect((await command(harness, engine, playerId, characterId, 'character.read', { objectId: 'mossgate-marker' })).receipt.ok)
    .toBe(true);
  return characterId;
}

async function outcomeEvents(store: InMemoryEventStore) {
  return store.readStream(worldInstanceId, QUEST_WORLD_OUTCOMES_STREAM_ID);
}

describe('branching quest outcomes through the engine', () => {
  it('validates the authored test world and keeps linear quests unchanged', () => {
    const world = branchingWorld();
    expect(validateDraftWorldGraph(world)).toEqual([]);
    expect(world.quests.find((quest) => quest.id === 'mara-wayfinding')?.branching).toBeUndefined();
  });

  it('rejects world references that the quest graph alone cannot check', () => {
    const errorsFor = (mutate: (world: ReturnType<typeof branchingWorld> & Record<string, unknown>) => void) => {
      const world = structuredClone(branchingWorld()) as ReturnType<typeof branchingWorld> & Record<string, unknown>;
      mutate(world);
      return validateDraftWorldGraph(world).join('\n');
    };
    const questIn = (world: WorldPackDraft) => world.quests.find((quest) => quest.id === QUEST_ID)!;
    const hearing = (world: WorldPackDraft) => questIn(world).branching!.branches[0]!;
    const mara = (world: WorldPackDraft) => world.locations.find((location) => location.id === 'mossgate-clearing')!
      .npcs!.find((npc) => npc.id === NPC_ID)!;

    expect(errorsFor((world) => { hearing(world).choices[0]!.npcId = 'nobody'; }))
      .toMatch(/choice back-regulated is offered by missing NPC nobody/);
    expect(errorsFor((world) => { hearing(world).choices[2]!.requires = [{ type: 'visited-location', locationId: 'atlantis' }]; }))
      .toMatch(/requires missing location atlantis/);
    expect(errorsFor((world) => { hearing(world).choices[2]!.requires = [{ type: 'quest-completed', questId: QUEST_ID }]; }))
      .toMatch(/requires unavailable quest common-measure-test/);
    expect(errorsFor((world) => {
      hearing(world).choices[2]!.requires = [{ type: 'world-outcome', key: POLICY_KEY, value: 'abolished' }];
    })).toMatch(/requires undeclared world outcome test-passage-policy=abolished/);
    expect(errorsFor((world) => {
      const copy = structuredClone(questIn(world));
      world.quests.push({ ...copy, id: 'rival-measure' });
    })).toMatch(/sets world outcome test-passage-policy owned by quest common-measure-test/);
    expect(errorsFor((world) => {
      mara(world).dialogue!.choices[1]!.questAction = { type: 'choose', questId: QUEST_ID, choiceId: 'missing-choice' };
    })).toMatch(/missing quest choice missing-choice/);
    expect(errorsFor((world) => {
      mara(world).dialogue!.questResponses![0]!.branchId = 'missing-branch';
    })).toMatch(/references missing branch missing-branch/);
  });

  it('presents choices only once the branch is ready, persists one, and shows it after reconnecting', async () => {
    const harness = setup();
    const engine = harness.createEngine();
    await engine.start();
    const characterId = await createCharacter(harness, engine, 'player-a');

    expect((await talk(engine, 'player-a', characterId)).choices.map((choice) => choice.id)).toEqual(['cm-accept']);
    await command(harness, engine, 'player-a', characterId, 'npc.dialogue.choose', { npcId: NPC_ID, choiceId: 'cm-accept' });

    const accepted = await journal(engine, 'player-a', characterId);
    expect(accepted).toMatchObject({
      status: 'active',
      branch: { id: 'hearing', label: 'Hear both sides' },
      objectives: [{ id: 'read-the-measure', completed: false }],
      decisions: [],
      availableChoices: [],
    });
    // The branch objective gates every choice, in dialogue and on direct submission.
    expect((await talk(engine, 'player-a', characterId)).choices).toEqual([]);
    const early = await command(harness, engine, 'player-a', characterId, 'quest.choice.select', {
      questId: QUEST_ID, choiceId: 'back-carriers', fromBranchId: 'hearing',
    });
    expect(early.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION', message: expect.stringContaining('Finish') });

    await command(harness, engine, 'player-a', characterId, 'character.read', { objectId: 'mossgate-marker' });
    const ready = await journal(engine, 'player-a', characterId);
    // The protocol needs a visit to the bell tower, so it is withheld everywhere.
    expect(ready?.availableChoices?.map((choice) => choice.choiceId)).toEqual(['back-regulated', 'back-carriers']);
    expect(ready?.availableChoices?.[0]).toMatchObject({ npcId: NPC_ID, npcName: 'Mara' });
    expect((await talk(engine, 'player-a', characterId)).choices.map((choice) => choice.id))
      .toEqual(['cm-regulated', 'cm-carriers']);

    const chosen = await command(harness, engine, 'player-a', characterId, 'npc.dialogue.choose', {
      npcId: NPC_ID, choiceId: 'cm-carriers',
    });
    expect(chosen.receipt.ok).toBe(true);
    expect(chosen.events.map((event) => event.type)).toEqual(['character.npc_dialogue_choice_made', 'quest.choice_selected']);

    // A fresh engine over the same store is a reconnect or restart: state comes only from the streams.
    const reconnected = harness.createEngine();
    await reconnected.start();
    expect(await journal(reconnected, 'player-a', characterId)).toMatchObject({
      branch: { id: 'carriers' },
      decisions: [{ choiceId: 'back-carriers', label: 'Back the independent carriers' }],
      availableChoices: [],
      worldOutcomes: [{ key: POLICY_KEY, value: 'independent', label: 'Independent carriers set their own terms.' }],
    });
    const dialogue = await talk(reconnected, 'player-a', characterId);
    expect(dialogue.text).toBe('The carriers will remember you stood with them.');
    expect(dialogue.choices.map((choice) => choice.id)).toEqual(['cm-report']);

    const reported = await command(harness, reconnected, 'player-a', characterId, 'npc.dialogue.choose', {
      npcId: NPC_ID, choiceId: 'cm-report',
    });
    expect(reported.events.map((event) => [event.type, event.payload.outcomeId])).toEqual([
      ['character.npc_dialogue_choice_made', undefined],
      ['quest.completed', 'outcome-carriers'],
      ['character.quest_rewarded', undefined],
    ]);
    expect(await journal(reconnected, 'player-a', characterId)).toMatchObject({
      status: 'completed',
      outcome: { id: 'outcome-carriers', label: 'Independent carriers' },
    });
  });

  it('rejects stale, unavailable, unmet, unauthorized, and absent-NPC submissions', async () => {
    const harness = setup();
    const engine = harness.createEngine();
    await engine.start();
    const characterId = await readyToDecide(harness, engine, 'player-a');
    const select = (choiceId: string, fromBranchId = 'hearing', playerId = 'player-a') =>
      command(harness, engine, playerId, characterId, 'quest.choice.select', { questId: QUEST_ID, choiceId, fromBranchId });

    expect((await select('propose-protocol')).receipt).toMatchObject({ code: 'RULE_VIOLATION', message: 'You cannot make that choice yet.' });
    expect((await select('no-such-choice')).receipt).toMatchObject({ code: 'RULE_VIOLATION' });
    expect((await select('back-regulated', 'carriers')).receipt).toMatchObject({ code: 'RULE_VIOLATION', message: expect.stringContaining('already been made') });
    expect((await select('back-regulated', 'hearing', 'intruder')).receipt).toMatchObject({ code: 'FORBIDDEN' });
    // A dialogue choice that names a quest choice is revalidated, not trusted.
    expect((await command(harness, engine, 'player-a', characterId, 'npc.dialogue.choose', {
      npcId: NPC_ID, choiceId: 'cm-protocol',
    })).receipt).toMatchObject({ code: 'RULE_VIOLATION' });
    expect((await select('back-regulated')).receipt.ok).toBe(true);
    // The transition is now stale: neither the same nor another choice can follow from the old branch.
    expect((await select('back-carriers')).receipt).toMatchObject({ code: 'RULE_VIOLATION' });
    expect((await select('back-regulated')).receipt).toMatchObject({ code: 'RULE_VIOLATION' });

    const elsewhere = setup();
    const away = elsewhere.createEngine();
    await away.start();
    const traveler = await readyToDecide(elsewhere, away, 'player-b');
    // Same streams, but Mara is no longer at the character's location.
    const absentWorld = structuredClone(elsewhere.world);
    absentWorld.locations.find((location) => location.id === 'mossgate-clearing')!.npcs =
      absentWorld.locations.find((location) => location.id === 'mossgate-clearing')!.npcs!
        .filter((npc) => npc.id !== NPC_ID);
    const withoutMara = setup(elsewhere.store, absentWorld);
    withoutMara.owners.set(traveler, 'player-b');
    const engineWithoutMara = withoutMara.createEngine();
    await engineWithoutMara.start();
    expect((await command(withoutMara, engineWithoutMara, 'player-b', traveler, 'quest.choice.select', {
      questId: QUEST_ID, choiceId: 'back-regulated', fromBranchId: 'hearing',
    })).receipt).toMatchObject({ code: 'RULE_VIOLATION', message: expect.stringContaining('Find the person') });
  });

  it('applies a retried choice and its turn-in reward once', async () => {
    const harness = setup();
    const engine = harness.createEngine();
    await engine.start();
    const characterId = await readyToDecide(harness, engine, 'player-a');
    const expectedVersion = await revision(harness.store, characterId);
    const choose = () => engine.dispatch({
      type: 'quest.choice.select',
      version: 1,
      commandId: 'choose-once',
      worldInstanceId,
      characterId,
      expectedVersion,
      payload: { questId: QUEST_ID, choiceId: 'back-regulated', fromBranchId: 'hearing' },
    }, session('player-a'));
    const first = await choose();
    const retry = await choose();
    expect(first.commitOutcome).toBe('committed');
    expect(retry.commitOutcome).toBe('duplicate');
    expect(retry.receipt).toEqual(first.receipt);
    const history = await harness.store.readStream(worldInstanceId, characterId);
    expect(history.filter((event) => event.type === 'quest.choice_selected')).toHaveLength(1);
    expect(await outcomeEvents(harness.store)).toHaveLength(1);

    const reportId = 'report-once';
    const reportVersion = await revision(harness.store, characterId);
    const report = () => engine.dispatch({
      type: 'npc.dialogue.choose',
      version: 1,
      commandId: reportId,
      worldInstanceId,
      characterId,
      expectedVersion: reportVersion,
      payload: { npcId: NPC_ID, choiceId: 'cm-report' },
    }, session('player-a'));
    expect((await report()).commitOutcome).toBe('committed');
    expect((await report()).commitOutcome).toBe('duplicate');
    const after = await harness.store.readStream(worldInstanceId, characterId);
    expect(after.filter((event) => event.type === 'character.quest_rewarded')).toHaveLength(1);
  });

  it('keeps each character’s branch separate while sharing the settled world outcome', async () => {
    const harness = setup();
    const engine = harness.createEngine();
    await engine.start();
    const first = await readyToDecide(harness, engine, 'player-a');
    const second = await readyToDecide(harness, engine, 'player-b');

    expect((await command(harness, engine, 'player-a', first, 'quest.choice.select', {
      questId: QUEST_ID, choiceId: 'back-regulated', fromBranchId: 'hearing',
    })).receipt.ok).toBe(true);
    // Another player cannot act through the first character.
    expect((await command(harness, engine, 'player-b', first, 'quest.choice.select', {
      questId: QUEST_ID, choiceId: 'back-carriers', fromBranchId: 'regulated',
    })).receipt).toMatchObject({ code: 'FORBIDDEN' });

    const secondJournal = await journal(engine, 'player-b', second);
    expect(secondJournal).toMatchObject({
      branch: { id: 'hearing' },
      decisions: [],
      worldOutcomes: [{ key: POLICY_KEY, value: 'regulated' }],
    });
    // The conflicting choice is hidden and rejected; agreeing is still allowed and adds no second decision.
    expect(secondJournal?.availableChoices?.map((choice) => choice.choiceId)).toEqual(['back-regulated']);
    expect((await talk(engine, 'player-b', second)).choices.map((choice) => choice.id)).toEqual(['cm-regulated']);
    expect((await command(harness, engine, 'player-b', second, 'quest.choice.select', {
      questId: QUEST_ID, choiceId: 'back-carriers', fromBranchId: 'hearing',
    })).receipt).toMatchObject({ code: 'RULE_VIOLATION', message: expect.stringContaining('settled another way') });
    expect((await command(harness, engine, 'player-b', second, 'quest.choice.select', {
      questId: QUEST_ID, choiceId: 'back-regulated', fromBranchId: 'hearing',
    })).receipt.ok).toBe(true);
    expect(await outcomeEvents(harness.store)).toHaveLength(1);
    expect((await harness.store.readStream(worldInstanceId, first))
      .filter((event) => event.type === 'quest.choice_selected')).toHaveLength(1);
  });

  it('settles concurrent conflicting decisions exactly once', async () => {
    const harness = setup();
    const engine = harness.createEngine();
    await engine.start();
    const first = await readyToDecide(harness, engine, 'player-a');
    const second = await readyToDecide(harness, engine, 'player-b');
    const firstVersion = await revision(harness.store, first);
    const secondVersion = await revision(harness.store, second);
    let release!: () => void;
    harness.store.barrier = { waiting: 2, release: () => release(), ready: new Promise((resolve) => { release = resolve; }) };
    const select = (playerId: string, characterId: string, expectedVersion: number, choiceId: string) => engine.dispatch({
      type: 'quest.choice.select',
      version: 1,
      commandId: `race-${playerId}`,
      worldInstanceId,
      characterId,
      expectedVersion,
      payload: { questId: QUEST_ID, choiceId, fromBranchId: 'hearing' },
    }, session(playerId));

    // Both commands observe an undecided world before either commits.
    const results = await Promise.all([
      select('player-a', first, firstVersion, 'back-regulated'),
      select('player-b', second, secondVersion, 'back-carriers'),
    ]);
    harness.store.barrier = undefined;
    expect(results.filter((result) => result.receipt.ok)).toHaveLength(1);
    const loser = results.find((result) => !result.receipt.ok)!;
    expect(loser.receipt).toMatchObject({ code: 'VERSION_CONFLICT', retryable: true });
    const decisions = await outcomeEvents(harness.store);
    expect(decisions).toHaveLength(1);

    // Retrying the losing command re-evaluates against the settled world and is rejected.
    const loserIsA = loser === results[0];
    const retried = await select(
      loserIsA ? 'player-a' : 'player-b',
      loserIsA ? first : second,
      loserIsA ? firstVersion : secondVersion,
      loserIsA ? 'back-regulated' : 'back-carriers',
    );
    expect(retried.receipt).toMatchObject({ code: 'RULE_VIOLATION' });
    const loserStream = await harness.store.readStream(worldInstanceId, loserIsA ? first : second);
    expect(loserStream.some((event) => event.type === 'quest.choice_selected')).toBe(false);
    expect(await outcomeEvents(harness.store)).toHaveLength(1);
  });

  it('interprets progress recorded under a compatible earlier definition version', async () => {
    const harness = setup();
    const engine = harness.createEngine();
    await engine.start();
    const characterId = await readyToDecide(harness, engine, 'player-a');
    // Rewrite the acceptance as if it happened under version 1 of the quest.
    const key = `${worldInstanceId}:${characterId}`;
    const streams = (harness.store as unknown as { streams: Map<string, Array<{ type: string; payload: Record<string, unknown> }>> }).streams;
    streams.set(key, streams.get(key)!.map((event) => event.type === 'quest.accepted'
      ? { ...event, payload: { ...event.payload, definitionVersion: '1' } }
      : event));

    expect((await command(harness, engine, 'player-a', characterId, 'quest.choice.select', {
      questId: QUEST_ID, choiceId: 'back-regulated', fromBranchId: 'hearing',
    })).receipt.ok).toBe(true);
    const report = await command(harness, engine, 'player-a', characterId, 'npc.dialogue.choose', {
      npcId: NPC_ID, choiceId: 'cm-report',
    });
    expect(report.receipt.ok).toBe(true);
    // The recorded version is preserved, not silently upgraded.
    expect(report.events.find((event) => event.type === 'quest.completed')?.payload)
      .toMatchObject({ definitionVersion: '1', outcomeId: 'outcome-regulated' });
    expect(await journal(engine, 'player-a', characterId)).toMatchObject({ status: 'completed', outcome: { id: 'outcome-regulated' } });
  });

  it('refuses to load shared-outcome quests without the quest-branches plugin', () => {
    const { store, world } = setup();
    expect(() => new EngineHost(
      [worldItemsPlugin, characterPlugin, npcDialoguePlugin],
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      world,
    )).toThrow('require the mudd.quest-branches plugin');
  });
});
