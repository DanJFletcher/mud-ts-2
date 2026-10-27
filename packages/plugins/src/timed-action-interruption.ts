import {
  FishingCastAdvancedEventSchema,
  WoodcuttingActionAdvancedEventSchema,
  type CharacterProjection,
} from '@mudd/contracts';

export function interruptActiveTimedActions(
  character: CharacterProjection,
): readonly {
  readonly type: string;
  readonly version: number;
  readonly payload: Readonly<Record<string, unknown>>;
}[] {
  const events: Array<{
    type: string;
    version: number;
    payload: Readonly<Record<string, unknown>>;
  }> = [];

  if (character.activeFishing) {
    const payload = {
      characterId: character.characterId,
      castId: character.activeFishing.castId,
      ticksCompleted: character.activeFishing.ticksCompleted,
      status: 'interrupted' as const,
      tickRolls: [],
    };
    FishingCastAdvancedEventSchema.shape.payload.parse(payload);
    events.push({ type: 'character.fishing_cast_advanced', version: 1, payload });
  }

  if (character.activeWoodcutting) {
    const payload = {
      characterId: character.characterId,
      actionId: character.activeWoodcutting.actionId,
      ticksCompleted: character.activeWoodcutting.ticksCompleted,
      status: 'interrupted' as const,
      tickRolls: [],
      skillExperienceAwarded: 0,
      totalExperience: character.woodcutting?.experience ?? 0,
      level: character.woodcutting?.level ?? 1,
    };
    WoodcuttingActionAdvancedEventSchema.shape.payload.parse(payload);
    events.push({ type: 'character.woodcutting_action_advanced', version: 1, payload });
  }

  return events;
}
