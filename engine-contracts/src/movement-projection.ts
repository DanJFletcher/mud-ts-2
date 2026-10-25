import { z } from 'zod';
import { IdSchema } from './ids.js';
import {
  CharacterProjectionSchema,
  CharacterStatsProjectionSchema,
} from './character.js';
import { SupplySourceDefinitionSchema } from './daily-jobs.js';
import { QuestJournalSchema } from './quests.js';
import { LocationProjectionSchema, WorldMapProjectionSchema } from './world.js';

const LocationOptionSchema = z.object({
  id: IdSchema,
  label: z.string().trim().min(1).max(120),
}).strict();

/**
 * The authoritative, location-sensitive portion of the game view returned
 * with successful movement commands. Stable player/world metadata remains in
 * the client's existing snapshot and does not need to cross the wire again.
 */
export const MovementResultProjectionSchema = z.object({
  character: CharacterProjectionSchema,
  stats: CharacterStatsProjectionSchema,
  location: LocationProjectionSchema,
  map: WorldMapProjectionSchema,
  questJournal: QuestJournalSchema,
  availableFishingSpots: z.array(LocationOptionSchema),
  availableWoodcuttingTrees: z.array(LocationOptionSchema),
  dailyActivities: z.object({
    cycle: z.string(),
    boards: z.array(z.object({
      id: z.string(),
      name: z.string(),
    }).strict()),
    sources: z.array(SupplySourceDefinitionSchema),
  }).strict(),
}).strict();

export type MovementResultProjection = z.infer<typeof MovementResultProjectionSchema>;
