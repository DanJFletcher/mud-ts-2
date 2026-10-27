import { describe, expect, it } from 'vitest';
import type { CharacterProjection, QuestDefinition, WorldPackDraft } from '@mudd/contracts';
import {
  projectQuestJournal,
  questObjectiveIsComplete,
  questObjectivesAreComplete,
} from './quest-projection.js';

const quest: QuestDefinition = {
  id: 'river-errand',
  version: '1',
  title: 'A Note from the River',
  summary: 'Follow the clue and return with what you learn.',
  scope: 'character',
  giverNpcId: 'orin',
  turnInNpcId: 'orin',
  objectives: [
    { id: 'read-note', label: 'Read the note', type: 'read-object', objectId: 'river-note', locationId: 'bridge' },
    { id: 'visit-bridge', label: 'Visit the bridge', type: 'visit-location', locationId: 'bridge' },
    { id: 'ring-bell', label: 'Ring the bell', type: 'perform-interaction', interactionId: 'bell', locationId: 'tower' },
    { id: 'carry-feather', label: 'Carry a feather', type: 'possess-item', itemId: 'feather' },
    { id: 'defeat-wolf', label: 'Defeat the wolf', type: 'defeat-npc', npcId: 'wolf', requiredCount: 1 },
  ],
};

function character(overrides: Record<string, unknown> = {}) {
  return {
    questProgress: [],
    readableObservations: [],
    itemUseObservations: [],
    inventory: [],
    visitedLocationIds: [],
    ...overrides,
  } as unknown as CharacterProjection;
}

describe('quest objective projection', () => {
  it('checks read, interaction, item, and visit objectives while defeat objectives remain untracked', () => {
    const projection = character({
      readableObservations: [{ objectId: 'river-note', locationId: 'bridge' }],
      itemUseObservations: [{ interactionId: 'bell', locationId: 'tower' }],
      inventory: [{ id: 'feather' }],
      visitedLocationIds: ['bridge'],
    });
    expect(questObjectiveIsComplete(quest, 'read-note', projection)).toBe(true);
    expect(questObjectiveIsComplete(quest, 'ring-bell', projection)).toBe(true);
    expect(questObjectiveIsComplete(quest, 'carry-feather', projection)).toBe(true);
    expect(questObjectiveIsComplete(quest, 'visit-bridge', projection)).toBe(true);
    expect(questObjectiveIsComplete(quest, 'defeat-wolf', projection)).toBe(false);
    expect(questObjectiveIsComplete(quest, 'unknown-objective', projection)).toBe(false);
    expect(questObjectivesAreComplete(quest, projection)).toBe(false);

    const incomplete = character();
    expect(questObjectiveIsComplete(quest, 'read-note', incomplete)).toBe(false);
    expect(questObjectiveIsComplete(quest, 'ring-bell', incomplete)).toBe(false);
    expect(questObjectiveIsComplete(quest, 'carry-feather', incomplete)).toBe(false);
    expect(questObjectiveIsComplete(quest, 'visit-bridge', incomplete)).toBe(false);
  });

  it('builds a character quest journal, skips party and unaccepted quests, and checks versions', () => {
    const partyQuest = { ...quest, id: 'party-errand', scope: 'party' as const };
    const world = {
      quests: [quest, partyQuest],
    } as unknown as WorldPackDraft;
    const activeCharacter = character({
      questProgress: [
        { questId: quest.id, definitionVersion: quest.version, status: 'active' },
        { questId: partyQuest.id, definitionVersion: partyQuest.version, status: 'active' },
      ],
      readableObservations: [{ objectId: 'river-note', locationId: 'bridge' }],
      itemUseObservations: [{ interactionId: 'bell', locationId: 'tower' }],
      inventory: [{ id: 'feather' }],
      visitedLocationIds: ['bridge'],
    });
    const journal = projectQuestJournal(activeCharacter, world);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      questId: 'river-errand',
      status: 'active',
      objectives: [
        { id: 'read-note', completed: true },
        { id: 'visit-bridge', completed: true },
        { id: 'ring-bell', completed: true },
        { id: 'carry-feather', completed: true },
        { id: 'defeat-wolf', completed: false },
      ],
    });
    expect(projectQuestJournal(character(), world)).toEqual([]);
    expect(() => projectQuestJournal(character({
      questProgress: [{
        questId: quest.id,
        definitionVersion: 'legacy',
        status: 'active',
      }],
    }), world)).toThrow('Quest river-errand version legacy is not available');
  });
});
