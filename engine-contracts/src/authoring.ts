/**
 * DRAFT boundary derived from Game Master CONTENT_PORT.example.ts.
 * NOT a verified content-publishing API. No quest or lore editing API invented.
 */
import { z } from 'zod';
import { IdSchema } from './ids.js';

export const CapabilityFindingSchema = z.object({
  name: z.string(),
  version: z.string(),
  discoveredFrom: z.string(),
  available: z.boolean(),
  requiredRole: z.string().optional(),
}).strict();

export const ContentDraftReferenceSchema = z.object({
  id: IdSchema,
  version: z.string(),
  filePath: z.string(),
  knownNonCanonical: z.literal(true),
}).strict();

export const ApiGapSchema = z.object({
  narrativeNeed: z.string(),
  requiredCapability: z.string(),
  status: z.enum(['missing', 'undocumented', 'incompatible']),
  recommendedOwner: z.literal('mudd-architect'),
}).strict();

export type CapabilityFinding = z.infer<typeof CapabilityFindingSchema>;
export type ContentDraftReference = z.infer<typeof ContentDraftReferenceSchema>;
export type ApiGap = z.infer<typeof ApiGapSchema>;

export type DraftPreflightResult =
  | Readonly<{ ok: true; discovered: readonly CapabilityFinding[] }>
  | Readonly<{ ok: false; gaps: readonly ApiGap[] }>;

export interface ProposedNarrativeAuthoringAdapter {
  discoverPublicCapabilities(names: readonly string[]): Promise<readonly CapabilityFinding[]>;
  preflight(draft: ContentDraftReference): Promise<DraftPreflightResult>;
  requestAuthorizedPublication(draft: ContentDraftReference, adminPrincipalId: string): Promise<
    | Readonly<{ accepted: true; actualPackId: string; activeVersion: string }>
    | Readonly<{ accepted: false; reason: string }>
  >;
}
