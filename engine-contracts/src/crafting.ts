import { z } from 'zod';
import { ClientCommandBaseSchema, ClientQueryBaseSchema, DomainEventBaseSchema } from './protocol.js';
import { IdSchema, NonNegativeIntSchema, PositiveIntSchema } from './ids.js';
import { InventoryItemProjectionSchema } from './character.js';
import { CraftingSkillSchema } from './crafting-skill.js';

export const CraftingIngredientDefinitionSchema = z.object({
  typeId: IdSchema,
  label: z.string().min(1).max(120),
  quantityPerCraft: PositiveIntSchema.max(1000),
  /** Charge-based materials, such as a spool of thread, lose uses rather than item quantity. */
  consumeUses: z.boolean().default(false),
}).strict();

const CraftingExperienceSchema = z.number()
  .positive()
  .max(100_000)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7, {
    message: 'Crafting experience must be expressible in hundredths.',
  });

export const CraftingRecipeDefinitionSchema = z.object({
  id: IdSchema,
  outputTypeId: IdSchema,
  outputLabel: z.string().min(1).max(120),
  outputDescription: z.string().min(1).max(1000),
  requiredLevel: PositiveIntSchema.max(99),
  experience: CraftingExperienceSchema,
  toolTypeIds: z.array(IdSchema).min(1).max(8),
  ingredients: z.array(CraftingIngredientDefinitionSchema).min(1).max(8),
}).strict().superRefine((recipe, context) => {
  const toolTypeIds = new Set<string>();
  recipe.toolTypeIds.forEach((typeId, index) => {
    if (toolTypeIds.has(typeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toolTypeIds', index],
        message: 'Crafting tool type IDs must be unique within a recipe.',
      });
    }
    toolTypeIds.add(typeId);
  });

  const ingredientTypeIds = new Set<string>();
  recipe.ingredients.forEach((ingredient, index) => {
    if (ingredientTypeIds.has(ingredient.typeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ingredients', index, 'typeId'],
        message: 'Crafting ingredient type IDs must be unique within a recipe.',
      });
    }
    if (toolTypeIds.has(ingredient.typeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ingredients', index, 'typeId'],
        message: 'Reusable tools cannot also be consumed ingredients in the same recipe.',
      });
    }
    ingredientTypeIds.add(ingredient.typeId);
  });
});

export const CraftingBatchSizeSchema = z.union([
  z.literal(1),
  z.literal(5),
  z.literal(10),
]);

export const CraftingCatalogQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('crafting.catalog'),
  payload: z.object({}).strict(),
}).strict();

export const CraftingCatalogProjectionSchema = z.object({
  skill: CraftingSkillSchema,
  atWorkbench: z.boolean(),
  recipes: z.array(z.object({
    recipeId: IdSchema,
    outputTypeId: IdSchema,
    outputLabel: z.string().min(1).max(120),
    requiredLevel: PositiveIntSchema.max(99),
    experience: CraftingExperienceSchema,
    maxCraftable: NonNegativeIntSchema.max(2_147_483_647),
  }).strict()).max(100),
}).strict();

export const CraftingCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('crafting.craft'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({
    recipeId: IdSchema,
    quantity: CraftingBatchSizeSchema,
  }).strict(),
}).strict();

export const CraftingMaterialConsumptionSchema = z.object({
  itemId: IdSchema,
  typeId: IdSchema,
  kind: z.enum(['quantity', 'uses']),
  amount: PositiveIntSchema.max(2_147_483_647),
}).strict();

export const CharacterCraftingCompletedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.crafting_completed'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    locationId: IdSchema,
    recipe: CraftingRecipeDefinitionSchema,
    quantity: CraftingBatchSizeSchema,
    outputItems: z.array(InventoryItemProjectionSchema).min(1).max(10),
    materialConsumptions: z.array(CraftingMaterialConsumptionSchema).min(1).max(16),
    experienceAwardedHundredths: NonNegativeIntSchema.max(2_147_483_647),
    totalExperienceHundredths: NonNegativeIntSchema.max(2_147_483_647),
    level: PositiveIntSchema.max(99),
  }).strict(),
}).strict();

export type CraftingIngredientDefinition = z.infer<typeof CraftingIngredientDefinitionSchema>;
export type CraftingRecipeDefinition = z.infer<typeof CraftingRecipeDefinitionSchema>;
export type CraftingBatchSize = z.infer<typeof CraftingBatchSizeSchema>;
export type CraftingCatalogProjection = z.infer<typeof CraftingCatalogProjectionSchema>;
export type CraftingCommand = z.infer<typeof CraftingCommandSchema>;
export type CraftingMaterialConsumption = z.infer<typeof CraftingMaterialConsumptionSchema>;
export type CharacterCraftingCompletedEvent = z.infer<typeof CharacterCraftingCompletedEventSchema>;
