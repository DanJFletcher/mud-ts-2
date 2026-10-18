import { z } from 'zod';
import { NonNegativeIntSchema, PositiveIntSchema } from './ids.js';

export const CharacterHealthSchema = z.object({
  current: NonNegativeIntSchema.max(1000),
  maximum: PositiveIntSchema.max(1000),
}).strict().superRefine((health, context) => {
  if (health.current > health.maximum) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['current'],
      message: 'Current health exceeds maximum health.',
    });
  }
});

export type CharacterHealth = z.infer<typeof CharacterHealthSchema>;
