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

test('accepts a character quest with its default objective and reward', () => {
  assert.equal(QuestDefinitionSchema.safeParse(quest()).success, true);
});

test('rejects a party quest with a character-owned reward', () => {
  assert.equal(QuestDefinitionSchema.safeParse(quest({ scope: 'party' })).success, false);
});

test('rejects duplicate item IDs in a quest reward', () => {
  assert.equal(QuestDefinitionSchema.safeParse(quest({
    reward: { currencyId: 'gold', amount: 5, itemIds: ['same', 'same'] },
  })).success, false);
});

test('rejects duplicate objective IDs', () => {
  assert.equal(QuestDefinitionSchema.safeParse(quest({
    objectives: [readObjective(), readObjective()],
  })).success, false);
});

test('rejects a character quest with a defeat-NPC objective', () => {
  assert.equal(QuestDefinitionSchema.safeParse(quest({
    objectives: [{
      id: 'defeat-bandit',
      label: 'Defeat the bandit',
      type: 'defeat-npc',
      npcId: 'bandit',
      requiredCount: 2,
    }],
  })).success, false);
});

test('accepts a party defeat quest without a character-owned reward', () => {
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
});

test('rejects item-possession objectives for party quests', () => {
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
});

test('accepts an item-possession objective for a character quest', () => {
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

test('accepts quest reward events with unique returned item IDs', () => {
  assert.equal(CharacterQuestRewardedEventSchema.safeParse(rewardedEvent(['map', 'letter'])).success, true);
});

test('rejects repeated item IDs in a quest reward event', () => {
  assert.equal(CharacterQuestRewardedEventSchema.safeParse(rewardedEvent(['map', 'map'])).success, false);
});

test('allows a quest reward event with no returned items', () => {
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

test('accepts a branching quest whose choices reach terminal outcomes', () => {
  assert.deepEqual(issues(branchingQuest({ branches: twoWay() })), []);
});

test('leaves linear quests unaffected by optional branching fields', () => {
  assert.equal(QuestDefinitionSchema.parse(quest()).branching, undefined);
});

const invalidBranchingGraphs = [
  {
    name: 'a missing start branch',
    build: () => branchingQuest({ startBranchId: 'nowhere', branches: twoWay() }),
    message: /start branch must exist/,
  },
  {
    name: 'a missing target and unreachable branches',
    build: () => branchingQuest({ branches: [
      branch('start', { objectiveIds: ['read-marker'], choices: [choice('keep', 'missing')] }),
      branch('keep-path', { outcomeId: 'kept' }),
      branch('move-path', { outcomeId: 'moved' }),
    ] }),
    message: /leads to missing branch missing[\s\S]*unreachable/,
  },
  {
    name: 'a cycle',
    build: () => branchingQuest({ branches: [
      branch('start', { objectiveIds: ['read-marker'], choices: [choice('keep', 'keep-path'), choice('move', 'move-path')] }),
      branch('keep-path', { choices: [choice('back', 'start')] }),
      branch('move-path', { outcomeId: 'moved' }),
    ] }),
    message: /cycle/,
  },
  {
    name: 'a dead end and unreachable outcome',
    build: () => branchingQuest({ branches: [
      branch('start', { objectiveIds: ['read-marker'], choices: [choice('keep', 'keep-path'), choice('move', 'move-path')] }),
      branch('keep-path'),
      branch('move-path', { outcomeId: 'moved' }),
    ] }),
    message: /keep-path is a dead end[\s\S]*Outcome kept is not reachable/,
  },
  {
    name: 'choices on a terminal branch',
    build: () => branchingQuest({ branches: [
      branch('start', { objectiveIds: ['read-marker'], choices: [choice('keep', 'keep-path'), choice('move', 'move-path')] }),
      branch('keep-path', { outcomeId: 'kept', choices: [choice('again', 'move-path')] }),
      branch('move-path', { outcomeId: 'moved' }),
    ] }),
    message: /Terminal branch keep-path cannot offer choices/,
  },
  {
    name: 'duplicate choice IDs and a missing objective reference',
    build: () => branchingQuest({ branches: [
      branch('start', { choices: [choice('keep', 'keep-path'), choice('keep', 'move-path')] }),
      branch('keep-path', { outcomeId: 'kept' }),
      branch('move-path', { outcomeId: 'moved', objectiveIds: ['read-marker', 'missing-objective'] }),
    ] }),
    message: /unique across the quest[\s\S]*missing objective missing-objective/,
  },
  {
    name: 'an objective not assigned to a branch',
    build: () => branchingQuest({ branches: [
      branch('start', { choices: [choice('keep', 'keep-path'), choice('move', 'move-path')] }),
      branch('keep-path', { outcomeId: 'kept' }),
      branch('move-path', { outcomeId: 'moved' }),
    ] }),
    message: /read-marker is not assigned to a branch/,
  },
  {
    name: 'a party-scoped branching quest',
    build: () => branchingQuest({ branches: twoWay() }, { scope: 'party' }),
    message: /require character quest scope/,
  },
];

for (const scenario of invalidBranchingGraphs) {
  test(`rejects a branching quest with ${scenario.name}`, () => {
    assert.match(issues(scenario.build()).join('\n'), scenario.message);
  });
}

const questWithRequirement = (requirement) => branchingQuest({ branches: [
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
  test(`allows ${requirement.type} choice prerequisites`, () => {
    assert.deepEqual(issues(questWithRequirement(requirement)), []);
  });
}

for (const requirement of [
  { type: 'client-flag', flagId: 'trusted' },
  { type: 'progress-flag', progressFlagId: 'asked' },
]) {
  test(`rejects ${requirement.type} choice prerequisites`, () => {
    assert.notDeepEqual(issues(questWithRequirement(requirement)), []);
  });
}

const previousManifest = (overrides = {}) => ({
  version: '0',
  objectiveIds: ['read-marker'],
  branchIds: ['start', 'keep-path'],
  choices: [{ id: 'keep', fromBranchId: 'start', toBranchId: 'keep-path' }],
  outcomeIds: ['kept'],
  ...overrides,
});

test('accepts a previous manifest that preserves recorded IDs and transitions', () => {
  assert.deepEqual(issues(branchingQuest({ branches: twoWay() }, {
    previousVersions: [previousManifest()],
  })), []);
});

test('rejects a previous choice that now leads to a different branch', () => {
  assert.match(issues(branchingQuest({ branches: twoWay() }, {
    previousVersions: [previousManifest({
      choices: [{ id: 'keep', fromBranchId: 'start', toBranchId: 'move-path' }],
    })],
  })).join('\n'), /choice keep was removed or now leads somewhere else/);
});

test('rejects removing a branch referenced by a previous manifest', () => {
  assert.match(issues(branchingQuest({ branches: twoWay() }, {
    previousVersions: [previousManifest({ branchIds: ['start', 'retired'] })],
  })).join('\n'), /branch retired was removed/);
});

test('requires a previous manifest version to be distinct', () => {
  assert.match(issues(branchingQuest({ branches: twoWay() }, {
    previousVersions: [previousManifest({ version: '1' })],
  })).join('\n'), /must be distinct/);
});

test('rejects changing a previously linear quest into a branching quest', () => {
  assert.match(issues(branchingQuest({ branches: twoWay() }, {
    previousVersions: [previousManifest({ branchIds: [], choices: [], outcomeIds: [] })],
  })).join('\n'), /cannot change whether the quest branches/);
});

test('accepts a previous linear-quest manifest with its objective retained', () => {
  assert.deepEqual(issues(quest({
    version: '2',
    previousVersions: [{ version: '1', objectiveIds: ['read-marker'] }],
  })), []);
});

test('rejects removing an objective recorded by a previous linear-quest manifest', () => {
  assert.match(issues(quest({
    version: '2',
    previousVersions: [{ version: '1', objectiveIds: ['retired-objective'] }],
  })).join('\n'), /objective retired-objective was removed/);
});
