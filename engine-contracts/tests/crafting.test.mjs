import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CraftingBatchSizeSchema,
  CraftingCommandSchema,
  CraftingRecipeDefinitionSchema,
} from '../dist/src/index.js';

const recipe = (overrides = {}) => ({
  id: 'leather-gloves',
  outputTypeId: 'leather-gloves',
  outputLabel: 'Leather gloves',
  outputDescription: 'A pair of well-stitched leather gloves.',
  requiredLevel: 1,
  experience: 13.8,
  toolTypeIds: ['crafting-needle'],
  ingredients: [
    { typeId: 'tanned-hide', label: 'Tanned hide', quantityPerCraft: 1 },
    { typeId: 'thread-spool', label: 'Spool of Thread', quantityPerCraft: 1, consumeUses: true },
  ],
  ...overrides,
});

test('crafting recipes require unique tools and ingredients and do not consume tools', () => {
  assert.equal(CraftingRecipeDefinitionSchema.safeParse(recipe()).success, true);
  assert.equal(CraftingRecipeDefinitionSchema.safeParse(recipe({
    toolTypeIds: ['crafting-needle', 'crafting-needle'],
  })).success, false);
  assert.equal(CraftingRecipeDefinitionSchema.safeParse(recipe({
    ingredients: [
      { typeId: 'tanned-hide', label: 'Tanned hide', quantityPerCraft: 1 },
      { typeId: 'tanned-hide', label: 'Another hide', quantityPerCraft: 2 },
    ],
  })).success, false);
  assert.equal(CraftingRecipeDefinitionSchema.safeParse(recipe({
    ingredients: [{ typeId: 'crafting-needle', label: 'Needle', quantityPerCraft: 1 }],
  })).success, false);
});

test('crafting recipes and batch commands enforce supported experience and quantities', () => {
  assert.equal(CraftingRecipeDefinitionSchema.safeParse(recipe({ experience: 13.811 })).success, false);
  assert.equal(CraftingBatchSizeSchema.safeParse(1).success, true);
  assert.equal(CraftingBatchSizeSchema.safeParse(5).success, true);
  assert.equal(CraftingBatchSizeSchema.safeParse(10).success, true);
  assert.equal(CraftingBatchSizeSchema.safeParse(2).success, false);

  const command = {
    type: 'crafting.craft',
    version: 1,
    commandId: 'craft-command',
    worldInstanceId: 'world-1',
    characterId: 'character-1',
    expectedVersion: 3,
    payload: { recipeId: 'leather-gloves', quantity: 5 },
  };
  assert.equal(CraftingCommandSchema.safeParse(command).success, true);
  assert.equal(CraftingCommandSchema.safeParse({
    ...command,
    payload: { ...command.payload, quantity: 2 },
  }).success, false);
});
