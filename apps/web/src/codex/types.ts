import { z } from "zod";

export const CODEX_WORLD_ID = "orraveth" as const;

export const CodexCategorySchema = z.enum([
  "world-overview",
  "geography",
  "history",
  "religions-philosophy",
  "magic-resonance",
  "sprites-entities",
  "nations-factions",
  "people-characters",
  "alchemy-crafting",
  "economy-trade",
  "mysteries",
]);

export const CodexCanonStatusSchema = z.enum([
  "Established Canon",
  "Provisional Canon",
  "In-World Belief",
  "Disputed",
  "Unresolved",
]);

export const CodexRelationSchema = z.object({
  type: z.enum([
    "related-to",
    "located-in",
    "member-of",
    "founded-by",
    "studied-by",
    "part-of",
    "uses",
    "anchored-to",
    "opposed-to",
    "influenced-by",
    "trades-with",
    "occurred-at",
    "teaches",
  ]),
  targetId: z.string().regex(/^orraveth-[a-z0-9-]+$/),
  label: z.string().trim().min(1).optional(),
});

export const CodexClaimSchema = z.object({
  text: z.string().trim().min(1),
  epistemicStatus: z.enum([
    "objective fact",
    "in-world belief",
    "rumor",
    "disputed",
    "unresolved",
  ]),
  attribution: z.string().trim().min(1).optional(),
});

export const CodexTimelineSchema = z.object({
  order: z.number(),
  label: z.string().trim().min(1),
  precision: z.enum(["dated", "approximate", "era", "undated"]),
});

export const CodexArticleMetadataSchema = z.object({
  id: z.string().regex(/^orraveth-[a-z0-9-]+$/),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  worldId: z.literal(CODEX_WORLD_ID),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  category: CodexCategorySchema,
  entityType: z.enum([
    "world",
    "region",
    "location",
    "history",
    "religion",
    "organization",
    "person",
    "magic-system",
    "discipline",
    "sprite",
    "practice",
    "concept",
    "item",
    "mystery",
    "school",
    "tradition",
    "event",
    "culture",
  ]),
  tags: z.array(z.string().trim().min(1)).default([]),
  aliases: z.array(z.string().trim().min(1)).default([]),
  relatedIds: z.array(z.string().regex(/^orraveth-[a-z0-9-]+$/)).default([]),
  relationships: z.array(CodexRelationSchema).default([]),
  claims: z.array(CodexClaimSchema).default([]),
  canonStatus: CodexCanonStatusSchema,
  sourceRefs: z.array(z.string().trim().min(1)).default([]),
  lastUpdated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeline: CodexTimelineSchema.optional(),
  regionId: z.string().regex(/^orraveth-[a-z0-9-]+$/).optional(),
}).strict();

export type CodexCategory = z.infer<typeof CodexCategorySchema>;
export type CodexCanonStatus = z.infer<typeof CodexCanonStatusSchema>;
export type CodexRelation = z.infer<typeof CodexRelationSchema>;
export type CodexArticleMetadata = z.infer<typeof CodexArticleMetadataSchema>;
export type CodexArticle = CodexArticleMetadata & {
  body: string;
  sourcePath: string;
};

export const CODEX_CATEGORIES: ReadonlyArray<{ id: CodexCategory; label: string }> = [
  { id: "world-overview", label: "World overview" },
  { id: "geography", label: "Geography & places" },
  { id: "history", label: "History & timeline" },
  { id: "religions-philosophy", label: "Religions & philosophy" },
  { id: "magic-resonance", label: "Magic & Resonance" },
  { id: "sprites-entities", label: "Sprites & entities" },
  { id: "nations-factions", label: "Nations & factions" },
  { id: "people-characters", label: "People & characters" },
  { id: "alchemy-crafting", label: "Alchemy & crafting" },
  { id: "economy-trade", label: "Economy & trade" },
  { id: "mysteries", label: "Mysteries" },
];
