import { z } from 'zod';
import { NonNegativeIntSchema, PositiveIntSchema } from './ids.js';

/** Crafting XP is stored in hundredths so authored fractional awards replay exactly. */
export const CraftingSkillSchema = z.object({
  experienceHundredths: NonNegativeIntSchema.max(2_147_483_647),
  level: PositiveIntSchema.max(99),
}).strict();

export type CraftingSkill = z.infer<typeof CraftingSkillSchema>;
