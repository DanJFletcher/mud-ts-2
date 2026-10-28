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
