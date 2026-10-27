import { describe, expect, it } from 'vitest';
import { CharacterProjectionSchema } from '@mudd/contracts';
import { interruptActiveTimedActions } from './timed-action-interruption.js';

function character(overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    worldInstanceId: 'world-test',
    characterId: 'character-test',
    name: 'Test Character',
    locationId: 'room-test',
    revision: 3,
    ...overrides,
  });
}

const fishingCast = {
  castId: 'cast-test',
  spotId: 'spot-test',
  locationId: 'room-test',
  rodItemId: 'rod-test',
  rodQualityId: 'old',
  startedAt: '2026-10-27T12:00:00.000Z',
  tickIntervalSeconds: 1,
  ticksRequired: 10,
  ticksCompleted: 4,
};

const woodcuttingAction = {
  actionId: 'action-test',
  treeId: 'tree-test',
  treeLabel: 'pine',
  axeItemId: 'axe-test',
  locationId: 'room-test',
  startedAt: '2026-10-27T12:00:00.000Z',
  ticksCompleted: 2,
  ticksRequired: 10,
};

describe('interruptActiveTimedActions', () => {
  it('returns no events when there is no active timed action', () => {
    expect(interruptActiveTimedActions(character())).toEqual([]);
  });

  it('records active fishing as interrupted', () => {
    expect(interruptActiveTimedActions(character({ activeFishing: fishingCast }))).toEqual([
      {
        type: 'character.fishing_cast_advanced',
        version: 1,
        payload: {
          characterId: 'character-test',
          castId: 'cast-test',
          ticksCompleted: 4,
          status: 'interrupted',
          tickRolls: [],
        },
      },
    ]);
  });

  it('records active woodcutting as interrupted with current skill progress', () => {
    expect(interruptActiveTimedActions(character({
      activeWoodcutting: woodcuttingAction,
      woodcutting: { experience: 225, level: 3 },
    }))).toEqual([
      {
        type: 'character.woodcutting_action_advanced',
        version: 1,
        payload: {
          characterId: 'character-test',
          actionId: 'action-test',
          ticksCompleted: 2,
          status: 'interrupted',
          tickRolls: [],
          skillExperienceAwarded: 0,
          totalExperience: 225,
          level: 3,
        },
      },
    ]);
  });

  it('uses default skill progress and interrupts both actions in stable order', () => {
    const events = interruptActiveTimedActions(character({
      activeFishing: fishingCast,
      activeWoodcutting: woodcuttingAction,
    }));

    expect(events.map((event) => event.type)).toEqual([
      'character.fishing_cast_advanced',
      'character.woodcutting_action_advanced',
    ]);
    expect(events[1]?.payload).toMatchObject({
      totalExperience: 0,
      level: 1,
      status: 'interrupted',
    });
  });
});
