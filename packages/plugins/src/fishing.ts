import {
  FishingAdvanceCommandSchema,
  FishingCastAdvancedEventSchema,
  FishingCancelCommandSchema,
  FishingCastCommandSchema,
  FishingCastStartedEventSchema,
  FishingCastStateSchema,
  type FishingSpeciesDefinition,
  type FishingSpotDefinition,
  type FishingRodDefinition,
  type WorldPackDraft,
} from '@mudd/contracts';
import { RuleViolationError, type EnginePlugin } from '@mudd/engine-core';
import { assertCharacterAlive, assertCharacterStanding, characterStateCapability, isInSharedCombat, type CharacterStateCapability } from './character.js';

function selectWeighted<T extends { weightPercent: number }>(
  entries: readonly T[],
  rng: { roll(sides: number): number },
): T {
  const total = entries.reduce((sum, entry) => sum + entry.weightPercent, 0);
  if (!total) throw new RuleViolationError('No fish can be caught here with this rod.');
  const roll = rng.roll(total);
  let cumulative = 0;
  return entries.find((entry) => {
    cumulative += entry.weightPercent;
    return roll <= cumulative;
  })!;
}

function makeCatch(
  spot: FishingSpotDefinition,
  rod: FishingRodDefinition,
  rng: { roll(sides: number): number },
  makeId: () => string,
) {
  const availableSpecies = spot.species.map((species) => ({
    ...species,
    weightPercent: rod.speciesWeightOverrides?.[species.id] ?? species.weightPercent,
  })).filter((species) => species.weightPercent > 0);
  const species: FishingSpeciesDefinition = selectWeighted(availableSpecies, rng);
  const band = selectWeighted(species.sizeBands, rng);
  const lengthCm = band.minLengthCm + rng.roll(band.maxLengthCm - band.minLengthCm + 1) - 1;
  const weightGrams = band.minWeightGrams + rng.roll(band.maxWeightGrams - band.minWeightGrams + 1) - 1;
  const caughtItem = {
    id: `fish-${makeId()}`,
    typeId: species.itemTypeId,
    label: species.name,
    description: `A freshly caught ${species.name.toLocaleLowerCase()}. It measures ${lengthCm} cm and weighs ${weightGrams} g.`,
    fishCatch: { speciesId: species.id, rarity: band.rarity, lengthCm, weightGrams },
  };
  return caughtItem;
}

export function validateFishingSpots(world: WorldPackDraft): void {
  const fishingSpotIds = new Set<string>();
  for (const spot of world.fishingSpots) {
    if (fishingSpotIds.has(spot.id) || !world.locations.some((location) => location.id === spot.locationId)) {
      throw new Error('Fishing spots require unique IDs and a valid world location.');
    }
    fishingSpotIds.add(spot.id);
  }
}

export const fishingPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.fishing',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
    requires: [characterStateCapability.id],
    requiredPlugins: { 'mudd.character': '^1.0.0' },
    eventSchemaVersions: {
      'character.fishing_cast_started': 1,
      'character.fishing_cast_advanced': 1,
    },
  },
  validateWorld: validateFishingSpots,
  register({ registerCommand, requireCapability }) {
    const characters = requireCapability<CharacterStateCapability>(characterStateCapability);

    registerCommand('fishing.cast', FishingCastCommandSchema, async (command, context) => {
      const character = await characters.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      assertCharacterStanding(character);
      if (character.combat?.status === 'active' || await isInSharedCombat(context, character.characterId)) {
        throw new RuleViolationError('You cannot fish during combat.');
      }
      if (character.activeFishing || character.activeWoodcutting) {
        throw new RuleViolationError('Finish your current timed activity first.');
      }
      const spot = context.world.fishingSpots.find((candidate) => candidate.locationId === character.locationId);
      if (!spot) throw new RuleViolationError('There is no designated fishing spot here.');
      const location = context.world.locations.find((candidate) => candidate.id === character.locationId);
      if (spot.stateId && (character.locationStateId ?? location?.defaultStateId) !== spot.stateId) {
        throw new RuleViolationError('You cannot fish from this side of the bridge.');
      }
      const rod = character.inventory.find((item) => item.id === command.payload.rodItemId)?.fishingRod;
      if (!rod) throw new RuleViolationError('You need to carry a fishing rod to fish.');
      const cast = FishingCastStateSchema.parse({
        castId: context.makeId(),
        spotId: spot.id,
        locationId: character.locationId,
        rodItemId: command.payload.rodItemId,
        rodQualityId: rod.qualityId,
        startedAt: context.now().toISOString(),
        tickIntervalSeconds: spot.tickSeconds,
        ticksRequired: Math.ceil(rod.waitSeconds / spot.tickSeconds),
        ticksCompleted: 0,
      });
      const payload = { characterId: character.characterId, cast };
      FishingCastStartedEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.fishing_cast_started', version: 1, payload }],
      };
    });

    registerCommand('fishing.advance', FishingAdvanceCommandSchema, async (command, context) => {
      const character = await characters.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const cast = character.activeFishing;
      if (!cast || cast.castId !== command.payload.castId) throw new RuleViolationError('That fishing cast is no longer active.');
      const rod = character.inventory.find((item) => item.id === cast.rodItemId)?.fishingRod;
      const spot = context.world.fishingSpots.find((candidate) => candidate.id === cast.spotId);
      if (character.locationId !== cast.locationId || !rod || !spot) {
        const payload = {
          characterId: character.characterId,
          castId: cast.castId,
          ticksCompleted: cast.ticksCompleted,
          status: 'interrupted' as const,
          tickRolls: [],
        };
        FishingCastAdvancedEventSchema.shape.payload.parse(payload);
        return { streamId: character.characterId, expectedVersion: command.expectedVersion,
          events: [{ type: 'character.fishing_cast_advanced', version: 1, payload }] };
      }
      if (
        character.combat?.status === 'active' ||
        character.combat?.status === 'defeat' ||
        character.health?.current === 0 ||
        character.staminaRecovery.posture === 'resting' ||
        await isInSharedCombat(context, character.characterId)
      ) {
        const payload = {
          characterId: character.characterId,
          castId: cast.castId,
          ticksCompleted: cast.ticksCompleted,
          status: 'interrupted' as const,
          tickRolls: [],
        };
        FishingCastAdvancedEventSchema.shape.payload.parse(payload);
        return { streamId: character.characterId, expectedVersion: command.expectedVersion,
          events: [{ type: 'character.fishing_cast_advanced', version: 1, payload }] };
      }
      assertCharacterAlive(character);
      assertCharacterStanding(character);
      const elapsedTicks = Math.min(
        cast.ticksRequired,
        Math.floor((context.now().getTime() - Date.parse(cast.startedAt)) / (cast.tickIntervalSeconds * 1000)),
      );
      const dueTicks = elapsedTicks - cast.ticksCompleted;
      if (dueTicks <= 0) throw new RuleViolationError('Your line is still in the water.');

      let ticksCompleted = cast.ticksCompleted;
      let item: ReturnType<typeof makeCatch> | undefined;
      const tickRolls: Array<{ tick: number; roll: number; caught: boolean }> = [];
      for (let index = 0; index < dueTicks; index += 1) {
        ticksCompleted += 1;
        const roll = context.rng.roll(100);
        const caught = roll <= rod.biteChancePercent;
        tickRolls.push({ tick: ticksCompleted, roll, caught });
        if (caught) {
          item = makeCatch(spot, rod, context.rng, () => context.makeId());
          break;
        }
      }
      const status = item ? 'caught' : ticksCompleted >= cast.ticksRequired ? 'no-bite' : 'waiting';
      const payload = {
        characterId: character.characterId,
        castId: cast.castId,
        ticksCompleted,
        status,
        tickRolls,
        ...(item ? { item } : {}),
      };
      FishingCastAdvancedEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.fishing_cast_advanced', version: 1, payload }],
      };
    });

    registerCommand('fishing.cancel', FishingCancelCommandSchema, async (command, context) => {
      const character = await characters.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const cast = character.activeFishing;
      if (!cast || cast.castId !== command.payload.castId) {
        throw new RuleViolationError('That fishing cast is no longer active.');
      }
      const payload = {
        characterId: character.characterId,
        castId: cast.castId,
        ticksCompleted: cast.ticksCompleted,
        status: 'interrupted' as const,
        tickRolls: [],
      };
      FishingCastAdvancedEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.fishing_cast_advanced', version: 1, payload }],
      };
    });
  },
};
