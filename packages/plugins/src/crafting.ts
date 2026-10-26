import {
  CharacterCraftingCompletedEventSchema,
  CraftingCatalogProjectionSchema,
  CraftingCatalogQuerySchema,
  CraftingCommandSchema,
  type CraftingIngredientDefinition,
  type CraftingRecipeDefinition,
  type CraftingMaterialConsumption,
  type CharacterProjection,
  type InventoryItemProjection,
  type WorldPackDraft,
} from '@mudd/contracts';
import { RuleViolationError, type EnginePlugin } from '@mudd/engine-core';
import {
  assertCharacterAlive,
  assertCharacterStanding,
  characterStateCapability,
  isInSharedCombat,
  type CharacterStateCapability,
} from './character.js';

function levelForExperienceHundredths(experience: number): number {
  let level = 1;
  while (level < 99 && experience >= 2500 * level * level) level += 1;
  return level;
}

function itemAmountForIngredient(
  items: readonly { typeId?: string; stackable?: boolean; quantity?: number; usesRemaining?: number }[],
  ingredient: CraftingIngredientDefinition,
): number {
  return items
    .filter((item) => item.typeId === ingredient.typeId)
    .reduce((total, item) => total + (ingredient.consumeUses
      ? item.usesRemaining ?? 0
      : item.stackable ? item.quantity ?? 0 : 1), 0);
}

function recipeMaxCraftable(
  character: CharacterProjection,
  recipe: CraftingRecipeDefinition,
): number {
  if (!recipe.toolTypeIds.every((typeId) => character.inventory.some((item) => item.typeId === typeId))) {
    return 0;
  }
  return Math.min(...recipe.ingredients.map((ingredient) =>
    Math.floor(itemAmountForIngredient(character.inventory, ingredient) / ingredient.quantityPerCraft),
  ));
}

function planMaterialConsumptions(
  inventory: readonly InventoryItemProjection[],
  recipe: CraftingRecipeDefinition,
  quantity: number,
): CraftingMaterialConsumption[] {
  const consumptions: CraftingMaterialConsumption[] = [];
  for (const ingredient of recipe.ingredients) {
    let remaining = ingredient.quantityPerCraft * quantity;
    for (const item of inventory) {
      if (item.typeId !== ingredient.typeId || remaining <= 0) continue;
      const available = ingredient.consumeUses
        ? item.usesRemaining ?? 0
        : item.stackable ? item.quantity ?? 0 : 1;
      const amount = Math.min(available, remaining);
      if (amount <= 0) continue;
      consumptions.push({
        itemId: item.id,
        typeId: ingredient.typeId,
        kind: ingredient.consumeUses ? 'uses' : 'quantity',
        amount,
      });
      remaining -= amount;
    }
    if (remaining > 0) {
      throw new RuleViolationError(`You need more ${ingredient.label} to make that quantity.`);
    }
  }
  return consumptions;
}

export function validateCraftingWorld(world: WorldPackDraft): void {
  const locations = new Set(world.locations.map(({ id }) => id));
  const workbenches = new Set<string>();
  for (const locationId of world.craftingWorkbenchLocationIds) {
    if (workbenches.has(locationId) || !locations.has(locationId)) {
      throw new Error('Crafting workbenches must reference unique locations in this world.');
    }
    workbenches.add(locationId);
  }
  const recipes = new Set<string>();
  for (const recipe of world.craftingRecipes) {
    if (recipes.has(recipe.id)) throw new Error('Crafting recipe IDs must be unique.');
    recipes.add(recipe.id);
  }
}

export const craftingPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.crafting',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
    requires: [characterStateCapability.id],
    requiredPlugins: { 'mudd.character': '^1.0.0' },
    eventSchemaVersions: { 'character.crafting_completed': 1 },
  },
  validateWorld: validateCraftingWorld,
  register({ registerCommand, registerQuery, requireCapability }) {
    const characters = requireCapability<CharacterStateCapability>(characterStateCapability);

    registerQuery('crafting.catalog', CraftingCatalogQuerySchema, async (query, context) => {
      const character = await characters.load(context, query.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const skill = character.crafting ?? { experienceHundredths: 0, level: 1 };
      const atWorkbench = context.world.craftingWorkbenchLocationIds.includes(character.locationId);
      const recipes = context.world.craftingRecipes
        .filter((recipe) => skill.level >= recipe.requiredLevel)
        .map((recipe) => ({
          recipe,
          maxCraftable: recipeMaxCraftable(character, recipe),
        }))
        .filter(({ maxCraftable }) => maxCraftable > 0)
        .map(({ recipe, maxCraftable }) => ({
          recipeId: recipe.id,
          outputTypeId: recipe.outputTypeId,
          outputLabel: recipe.outputLabel,
          requiredLevel: recipe.requiredLevel,
          experience: recipe.experience,
          maxCraftable,
        }));
      return CraftingCatalogProjectionSchema.parse({ skill, atWorkbench, recipes });
    });

    registerCommand('crafting.craft', CraftingCommandSchema, async (command, context) => {
      const character = await characters.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      assertCharacterStanding(character);
      if (character.combat?.status === 'active' || await isInSharedCombat(context, character.characterId)) {
        throw new RuleViolationError('You cannot craft during combat.');
      }
      if (character.activeFishing || character.activeWoodcutting) {
        throw new RuleViolationError('Finish your current timed activity before crafting.');
      }
      if (!context.world.craftingWorkbenchLocationIds.includes(character.locationId)) {
        throw new RuleViolationError('You need to be at a workbench to craft.');
      }
      const recipe = context.world.craftingRecipes.find(({ id }) => id === command.payload.recipeId);
      if (!recipe) throw new RuleViolationError('That recipe is not available in this world.');
      const skill = character.crafting ?? { experienceHundredths: 0, level: 1 };
      if (skill.level < recipe.requiredLevel) {
        throw new RuleViolationError(`Crafting level ${recipe.requiredLevel} is required for ${recipe.outputLabel}.`);
      }
      if (!recipe.toolTypeIds.every((typeId) => character.inventory.some((item) => item.typeId === typeId))) {
        throw new RuleViolationError('You do not have the tools required for that recipe.');
      }
      const maxCraftable = recipeMaxCraftable(character, recipe);
      if (maxCraftable < command.payload.quantity) {
        throw new RuleViolationError(`You have enough materials to craft at most ${maxCraftable}.`);
      }
      const materialConsumptions = planMaterialConsumptions(
        character.inventory,
        recipe,
        command.payload.quantity,
      );
      const experienceAwardedHundredths = Math.round(recipe.experience * 100) * command.payload.quantity;
      const totalExperienceHundredths = skill.experienceHundredths + experienceAwardedHundredths;
      if (totalExperienceHundredths > 2_147_483_647) {
        throw new RuleViolationError('Your crafting experience cannot increase any further.');
      }
      const payload = {
        characterId: character.characterId,
        locationId: character.locationId,
        recipe,
        quantity: command.payload.quantity,
        outputItems: Array.from({ length: command.payload.quantity }, () => ({
          id: context.makeId(),
          typeId: recipe.outputTypeId,
          label: recipe.outputLabel,
          description: recipe.outputDescription,
        })),
        materialConsumptions,
        experienceAwardedHundredths,
        totalExperienceHundredths,
        level: levelForExperienceHundredths(totalExperienceHundredths),
      };
      CharacterCraftingCompletedEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.crafting_completed', version: 1, payload }],
      };
    });
  },
};
