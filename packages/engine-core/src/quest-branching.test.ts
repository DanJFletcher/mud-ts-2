import { describe, expect, it } from 'vitest';
import { QuestDefinitionSchema, type WorldPackDraft } from '@mudd/contracts';
import type { StoredGameEvent } from './types.js';
import { replayCharacter } from './replay.js';
import { checkQuestChoice, projectQuestJournal, questObjectivesAreComplete } from './quest-projection.js';

function event(type: string, aggregateVersion: number, payload: Record<string, unknown>): StoredGameEvent {
  return {
    type,
    version: 1,
    eventId: `event-${aggregateVersion}`,
    worldInstanceId: 'world-test',
    streamId: 'character-test',
    aggregateId: 'character-test',
    aggregateVersion,
    causationCommandId: `command-${aggregateVersion}`,
    actorId: 'player-test',
    occurredAt: '2026-10-31T12:00:00.000Z',
    tick: 0,
    payload: { characterId: 'character-test', ...payload },
  };
}

const created = event('character.created', 1, {
  playerId: 'player-test',
  name: 'Rowan',
  startingLocationId: 'ford',
});
const accepted = event('quest.accepted', 2, { questId: 'ford-measure', definitionVersion: '2', branchId: 'hearing' });
const chose = (aggregateVersion: number, choiceId: string, fromBranchId: string, toBranchId: string) =>
  event('quest.choice_selected', aggregateVersion, {
    questId: 'ford-measure', definitionVersion: '2', choiceId, fromBranchId, toBranchId,
  });

const quest = QuestDefinitionSchema.parse({
  id: 'ford-measure',
  version: '2',
  title: 'The Ford Measure',
  summary: 'Decide how the ford is crossed.',
  giverNpcId: 'warden',
  turnInNpcId: 'warden',
  objectives: [
    { id: 'visit-ford', label: 'Visit the ford', type: 'visit-location', locationId: 'ford' },
    { id: 'carry-ledger', label: 'Carry the ledger', type: 'possess-item', itemId: 'ledger' },
  ],
  branching: {
    startBranchId: 'hearing',
    branches: [
      {
        id: 'hearing',
        label: 'Hear the ferrymen',
        objectiveIds: ['visit-ford'],
        choices: [
          { id: 'side-with-toll', label: 'Keep the toll', npcId: 'warden', toBranchId: 'toll' },
          {
            id: 'open-ford',
            label: 'Open the ford',
            npcId: 'warden',
            toBranchId: 'open',
            worldOutcome: { key: 'ford-policy', value: 'open', label: 'The ford is open to all.' },
          },
        ],
      },
      { id: 'toll', label: 'Keep the toll', objectiveIds: ['carry-ledger'], outcomeId: 'tolled' },
      { id: 'open', label: 'Open the ford', outcomeId: 'opened' },
    ],
    outcomes: [
      { id: 'tolled', label: 'Toll kept', summary: 'The toll stands.' },
      { id: 'opened', label: 'Ford opened', summary: 'Anyone may cross.' },
    ],
  },
  previousVersions: [{
    version: '1',
    objectiveIds: ['visit-ford'],
    branchIds: ['hearing', 'toll'],
    choices: [{ id: 'side-with-toll', fromBranchId: 'hearing', toBranchId: 'toll' }],
    outcomeIds: ['tolled'],
  }],
});
const world = { quests: [quest], locations: [{ id: 'ford', npcs: [{ id: 'warden', name: 'Warden Hale' }] }] } as unknown as WorldPackDraft;

describe('branching quest replay', () => {
  it('replays accepted branches and choices while legacy linear events stay unchanged', () => {
    const legacy = replayCharacter([created, event('quest.accepted', 2, { questId: 'old-errand', definitionVersion: '1' })]);
    expect(legacy?.questProgress).toEqual([{ questId: 'old-errand', definitionVersion: '1', status: 'active' }]);

    const branched = replayCharacter([created, accepted, chose(3, 'side-with-toll', 'hearing', 'toll')]);
    expect(branched?.questProgress).toEqual([{
      questId: 'ford-measure', definitionVersion: '2', status: 'active', branchId: 'toll', choiceIds: ['side-with-toll'],
    }]);
  });

  it('rejects stale, repeated, mismatched, and linear-quest choices', () => {
    expect(() => replayCharacter([created, accepted, chose(3, 'side-with-toll', 'open', 'toll')]))
      .toThrow('Invalid quest choice event at revision 3.');
    expect(() => replayCharacter([
      created, accepted, chose(3, 'side-with-toll', 'hearing', 'toll'), chose(4, 'side-with-toll', 'toll', 'open'),
    ])).toThrow('Invalid quest choice event at revision 4.');
    expect(() => replayCharacter([
      created, accepted, { ...chose(3, 'side-with-toll', 'hearing', 'toll'), payload: { ...chose(3, 'x', 'hearing', 'toll').payload, definitionVersion: '1' } },
    ])).toThrow('Invalid quest choice event at revision 3.');
    expect(() => replayCharacter([
      created, event('quest.accepted', 2, { questId: 'ford-measure', definitionVersion: '2' }), chose(3, 'side-with-toll', 'hearing', 'toll'),
    ])).toThrow('Invalid quest choice event at revision 3.');
    expect(() => replayCharacter([
      created, accepted, { ...chose(3, 'side-with-toll', 'hearing', 'toll'), payload: { ...chose(3, 'side-with-toll', 'hearing', 'toll').payload, characterId: 'someone-else' } },
    ])).toThrow('Invalid quest choice event at revision 3.');
  });

  it('records the terminal outcome only for branching completions', () => {
    const done = replayCharacter([
      created, accepted, chose(3, 'side-with-toll', 'hearing', 'toll'),
      event('quest.completed', 4, { questId: 'ford-measure', definitionVersion: '2', outcomeId: 'tolled' }),
    ]);
    expect(done?.questProgress[0]).toMatchObject({ status: 'completed', outcomeId: 'tolled' });
    expect(() => replayCharacter([
      created, accepted, event('quest.completed', 3, { questId: 'ford-measure', definitionVersion: '2' }),
    ])).toThrow('Invalid quest completion event at revision 3.');
    expect(() => replayCharacter([
      created, event('quest.accepted', 2, { questId: 'old-errand', definitionVersion: '1' }),
      event('quest.completed', 3, { questId: 'old-errand', definitionVersion: '1', outcomeId: 'tolled' }),
    ])).toThrow('Invalid quest completion event at revision 3.');
  });
});

describe('branching quest projection', () => {
  const at = (events: StoredGameEvent[], overrides: Record<string, unknown> = {}) =>
    ({ ...replayCharacter(events)!, ...overrides });

  it('reports the current branch, path objectives, and available choices', () => {
    const fresh = at([created, accepted]);
    expect(projectQuestJournal(fresh, world, new Map())[0]).toMatchObject({
      branch: { id: 'hearing' },
      objectives: [{ id: 'visit-ford', completed: true }],
      availableChoices: [
        { choiceId: 'side-with-toll', npcId: 'warden', npcName: 'Warden Hale' },
        { choiceId: 'open-ford', npcId: 'warden' },
      ],
    });
    // Without shared outcomes loaded, choices that depend on them fail closed.
    expect(projectQuestJournal(fresh, world)[0]?.availableChoices?.map((choice) => choice.choiceId))
      .toEqual(['side-with-toll']);
    expect(checkQuestChoice(quest, fresh, 'open-ford', new Map([['ford-policy', 'closed']])))
      .toEqual({ ok: false, reason: 'That matter has already been settled another way.' });

    const tolled = at([created, accepted, chose(3, 'side-with-toll', 'hearing', 'toll')]);
    expect(projectQuestJournal(tolled, world, new Map())[0]).toMatchObject({
      branch: { id: 'toll' },
      decisions: [{ choiceId: 'side-with-toll', label: 'Keep the toll' }],
      objectives: [{ id: 'visit-ford', completed: true }, { id: 'carry-ledger', completed: false }],
      availableChoices: [],
    });
    expect(questObjectivesAreComplete(quest, tolled)).toBe(false);
    expect(questObjectivesAreComplete(quest, { ...tolled, inventory: [{ id: 'ledger', label: 'Ledger', description: 'Tallies.' }] }))
      .toBe(true);
    // A non-terminal branch can never be turned in, even with its objectives done.
    expect(questObjectivesAreComplete(quest, fresh)).toBe(false);
  });

  it('interprets compatible earlier versions and fails closed for unknown ones', () => {
    const v1 = at([
      created,
      event('quest.accepted', 2, { questId: 'ford-measure', definitionVersion: '1', branchId: 'hearing' }),
      { ...chose(3, 'side-with-toll', 'hearing', 'toll'), payload: { ...chose(3, 'side-with-toll', 'hearing', 'toll').payload, definitionVersion: '1' } },
    ]);
    expect(projectQuestJournal(v1, world, new Map())[0]).toMatchObject({ branch: { id: 'toll' }, decisions: [{ choiceId: 'side-with-toll' }] });

    const unknown = at([created, event('quest.accepted', 2, { questId: 'ford-measure', definitionVersion: '0', branchId: 'hearing' })]);
    expect(() => projectQuestJournal(unknown, world, new Map())).toThrow('Quest ford-measure version 0 is not available');

    // A recorded choice that the definition no longer explains is never reinterpreted.
    const drifted = at([created, accepted], {
      questProgress: [{ questId: 'ford-measure', definitionVersion: '2', status: 'active', branchId: 'open', choiceIds: ['retired-choice'] }],
    });
    expect(() => projectQuestJournal(drifted, world, new Map())).toThrow('progress does not match its branch definition');
  });
});
