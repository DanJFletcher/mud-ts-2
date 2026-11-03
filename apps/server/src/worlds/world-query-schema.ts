import {
  DailyBoardQuerySchema,
  LocationDescribeQuerySchema,
  LocationGroupsListQuerySchema,
  MerchantCatalogQuerySchema,
  NpcTalkQuerySchema,
  ObjectInspectQuerySchema,
  ObjectReadQuerySchema,
  PartyInfoQuerySchema,
  PartyListQuerySchema,
  PartyQuestJournalQuerySchema,
  QuestJournalQuerySchema,
  TeamCombatInfoQuerySchema,
} from '@mudd/contracts';
import { z } from 'zod';

export const WorldQuerySchema = z.discriminatedUnion('type', [
  LocationDescribeQuerySchema,
  ObjectReadQuerySchema,
  ObjectInspectQuerySchema,
  NpcTalkQuerySchema,
  MerchantCatalogQuerySchema,
  PartyListQuerySchema,
  PartyInfoQuerySchema,
  PartyQuestJournalQuerySchema,
  QuestJournalQuerySchema,
  TeamCombatInfoQuerySchema,
  LocationGroupsListQuerySchema,
  DailyBoardQuerySchema,
]);
