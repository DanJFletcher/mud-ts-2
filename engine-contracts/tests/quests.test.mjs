import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CharacterQuestRewardedEventSchema,
  QuestDefinitionSchema,
} from '../dist/src/index.js';

const readObjective = (overrides = {}) => ({
  id: 'read-marker',
  label: 'Read the marker',
  type: 'read-object',
  objectId: 'marker',
  locationId: 'forest-road',
  ...overrides,
});

const quest = (overrides = {}) => ({
  id: 'road-marker',
  version: '1',
  title: 'A road marker',
  summary: 'Learn what the old marker says.',
  giverNpcId: 'taren',
  turnInNpcId: 'taren',
  scope: 'character',
  reward: { currencyId: 'gold', amount: 5, itemIds: ['marker-copy'] },
  objectives: [readObjective()],
  ...overrides,
});

const rewardedEvent = (itemIds) => ({
  type: 'character.quest_rewarded',
  version: 1,
  eventId: 'event-1',
  worldInstanceId: 'world-1',
  aggregateId: 'character-1',
  aggregateVersion: 2,
  causationCommandId: 'command-1',
  actorId: 'player-1',
  occurredAt: '2026-10-27T12:00:00.000Z',
  tick: 1,
  payload: {
    characterId: 'character-1',
    questId: 'road-marker',
    definitionVersion: '1',
    currencyId: 'gold',
    amount: 5,
    itemIds,
  },
});

test('quest scope and reward rules match objective ownership', () => {
  assert.equal(QuestDefinitionSchema.safeParse(quest()).success, true);
  assert.equal(QuestDefinitionSchema.safeParse(quest({
    scope: 'party',
  })).success, false);
  assert.equal(QuestDefinitionSchema.safeParse(quest({
    reward: { currencyId: 'gold', amount: 5, itemIds: ['same', 'same'] },
  })).success, false);

  assert.equal(QuestDefinitionSchema.safeParse(quest({
    objectives: [readObjective(), readObjective()],
  })).success, false);
  assert.equal(QuestDefinitionSchema.safeParse(quest({
    objectives: [{
      id: 'defeat-bandit',
      label: 'Defeat the bandit',
      type: 'defeat-npc',
      npcId: 'bandit',
      requiredCount: 2,
    }],
  })).success, false);
  assert.equal(QuestDefinitionSchema.safeParse(quest({
    scope: 'party',
    reward: undefined,
    objectives: [{
      id: 'defeat-bandit',
      label: 'Defeat the bandit',
      type: 'defeat-npc',
      npcId: 'bandit',
      requiredCount: 2,
    }],
  })).success, true);
  assert.equal(QuestDefinitionSchema.safeParse(quest({
    scope: 'party',
    reward: undefined,
    objectives: [{
      id: 'carry-map',
      label: 'Carry the map',
      type: 'possess-item',
      itemId: 'map',
    }],
  })).success, false);
  assert.equal(QuestDefinitionSchema.safeParse(quest({
    reward: undefined,
    objectives: [{
      id: 'carry-map',
      label: 'Carry the map',
      type: 'possess-item',
      itemId: 'map',
    }],
  })).success, true);
});

test('quest reward events require unique returned item IDs', () => {
  assert.equal(CharacterQuestRewardedEventSchema.safeParse(rewardedEvent(['map', 'letter'])).success, true);
  assert.equal(CharacterQuestRewardedEventSchema.safeParse(rewardedEvent(['map', 'map'])).success, false);
  assert.equal(CharacterQuestRewardedEventSchema.safeParse(rewardedEvent(undefined)).success, true);
});

const branch = (id, overrides = {}) => ({ id, label: `Branch ${id}`, ...overrides });
const choice = (id, toBranchId, overrides = {}) => ({ id, label: `Choice ${id}`, npcId: 'taren', toBranchId, ...overrides });
const branchingQuest = (branching, overrides = {}) => quest({
  reward: undefined,
  objectives: [readObjective()],
  branching: {
    startBranchId: 'start',
    outcomes: [{ id: 'kept', label: 'Kept', summary: 'The marker was kept.' }, { id: 'moved', label: 'Moved', summary: 'The marker was moved.' }],
    ...branching,
  },
  ...overrides,
});
const twoWay = () => [
  branch('start', { objectiveIds: ['read-marker'], choices: [choice('keep', 'keep-path'), choice('move', 'move-path')] }),
  branch('keep-path', { outcomeId: 'kept' }),
  branch('move-path', { outcomeId: 'moved' }),
];
const issues = (value) => {
  const result = QuestDefinitionSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

test('branching quests validate a reachable, acyclic graph that always ends in an outcome', () => {
  assert.deepEqual(issues(branchingQuest({ branches: twoWay() })), []);
  // Linear quests are unaffected by the new optional fields.
  assert.equal(QuestDefinitionSchema.parse(quest()).branching, undefined);

  assert.match(issues(branchingQuest({ startBranchId: 'nowhere', branches: twoWay() })).join('\n'), /start branch must exist/);
  assert.match(issues(branchingQuest({ branches: [
    branch('start', { objectiveIds: ['read-marker'], choices: [choice('keep', 'missing')] }),
    branch('keep-path', { outcomeId: 'kept' }),
    branch('move-path', { outcomeId: 'moved' }),
  ] })).join('\n'), /leads to missing branch missing[\s\S]*unreachable/);
  assert.match(issues(branchingQuest({ branches: [
    branch('start', { objectiveIds: ['read-marker'], choices: [choice('keep', 'keep-path'), choice('move', 'move-path')] }),
    branch('keep-path', { choices: [choice('back', 'start')] }),
    branch('move-path', { outcomeId: 'moved' }),
  ] })).join('\n'), /cycle/);
  assert.match(issues(branchingQuest({ branches: [
    branch('start', { objectiveIds: ['read-marker'], choices: [choice('keep', 'keep-path'), choice('move', 'move-path')] }),
    branch('keep-path'),
    branch('move-path', { outcomeId: 'moved' }),
  ] })).join('\n'), /keep-path is a dead end[\s\S]*Outcome kept is not reachable/);
  assert.match(issues(branchingQuest({ branches: [
    branch('start', { objectiveIds: ['read-marker'], choices: [choice('keep', 'keep-path'), choice('move', 'move-path')] }),
    branch('keep-path', { outcomeId: 'kept', choices: [choice('again', 'move-path')] }),
    branch('move-path', { outcomeId: 'moved' }),
  ] })).join('\n'), /Terminal branch keep-path cannot offer choices/);
  assert.match(issues(branchingQuest({ branches: [
    branch('start', { choices: [choice('keep', 'keep-path'), choice('keep', 'move-path')] }),
    branch('keep-path', { outcomeId: 'kept' }),
    branch('move-path', { outcomeId: 'moved', objectiveIds: ['read-marker', 'missing-objective'] }),
  ] })).join('\n'), /unique across the quest[\s\S]*missing objective missing-objective/);
  assert.match(issues(branchingQuest({ branches: [
    branch('start', { choices: [choice('keep', 'keep-path'), choice('move', 'move-path')] }),
    branch('keep-path', { outcomeId: 'kept' }),
    branch('move-path', { outcomeId: 'moved' }),
  ] })).join('\n'), /read-marker is not assigned to a branch/);
  assert.match(issues(branchingQuest({ branches: twoWay() }, { scope: 'party' })).join('\n'), /require character quest scope/);
});

test('choice prerequisites accept only server-verifiable conditions', () => {
  const withRequirement = (requirement) => branchingQuest({ branches: [
    branch('start', { objectiveIds: ['read-marker'], choices: [choice('keep', 'keep-path', { requires: [requirement] }), choice('move', 'move-path')] }),
    branch('keep-path', { outcomeId: 'kept' }),
    branch('move-path', { outcomeId: 'moved' }),
  ] });
  for (const requirement of [
    { type: 'visited-location', locationId: 'tower' },
    { type: 'possess-item', itemId: 'map' },
    { type: 'quest-completed', questId: 'other' },
    { type: 'world-outcome', key: 'policy', value: 'open' },
  ]) {
    assert.deepEqual(issues(withRequirement(requirement)), [], requirement.type);
  }
  assert.notDeepEqual(issues(withRequirement({ type: 'client-flag', flagId: 'trusted' })), []);
  assert.notDeepEqual(issues(withRequirement({ type: 'progress-flag', progressFlagId: 'asked' })), []);
});

test('previous version manifests keep recorded IDs and transitions meaningful', () => {
  const manifest = (overrides = {}) => ({
    version: '0',
    objectiveIds: ['read-marker'],
    branchIds: ['start', 'keep-path'],
    choices: [{ id: 'keep', fromBranchId: 'start', toBranchId: 'keep-path' }],
    outcomeIds: ['kept'],
    ...overrides,
  });
  assert.deepEqual(issues(branchingQuest({ branches: twoWay() }, { previousVersions: [manifest()] })), []);
  assert.match(issues(branchingQuest({ branches: twoWay() }, {
    previousVersions: [manifest({ choices: [{ id: 'keep', fromBranchId: 'start', toBranchId: 'move-path' }] })],
  })).join('\n'), /choice keep was removed or now leads somewhere else/);
  assert.match(issues(branchingQuest({ branches: twoWay() }, {
    previousVersions: [manifest({ branchIds: ['start', 'retired'] })],
  })).join('\n'), /branch retired was removed/);
  assert.match(issues(branchingQuest({ branches: twoWay() }, {
    previousVersions: [manifest({ version: '1' })],
  })).join('\n'), /must be distinct/);
  // A linear version cannot be reinterpreted as a branching one.
  assert.match(issues(branchingQuest({ branches: twoWay() }, {
    previousVersions: [manifest({ branchIds: [], choices: [], outcomeIds: [] })],
  })).join('\n'), /cannot change whether the quest branches/);
  assert.deepEqual(issues(quest({ version: '2', previousVersions: [{ version: '1', objectiveIds: ['read-marker'] }] })), []);
  assert.match(issues(quest({ version: '2', previousVersions: [{ version: '1', objectiveIds: ['retired-objective'] }] })).join('\n'),
    /objective retired-objective was removed/);
});
