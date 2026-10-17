/**
 * ARCHITECTURAL SKETCH ONLY — deliberately does not import MUDD packages.
 * These names are not verified MUDD public APIs and must not be used verbatim
 * without consulting the actual repo contracts and authoring SDK.
 *
 * The adapter's job is to translate approved, versioned authored content into
 * REAL published MUDD import/validation/query/command interfaces.
 */

type ContractVersion = string;
type CapabilityName = string;
type PackId = string;

export type CapabilityFinding = Readonly<{
  name: CapabilityName;
  version: ContractVersion;
  discoveredFrom: string; // concrete repo export/documentation path
  available: boolean;
  requiredRole?: string;
}>;

export type DesignDraft = Readonly<{
  id: PackId;
  version: string;
  filePath: string;
  knownNonCanonical: true;
}>;

export type ApiGap = Readonly<{
  narrativeNeed: string;
  requiredCapability: CapabilityName;
  status: 'missing' | 'undocumented' | 'incompatible';
  recommendedOwner: 'mudd-architect';
}>;

export type DraftPreflightResult =
  | Readonly<{ ok: true; discovered: readonly CapabilityFinding[] }>
  | Readonly<{ ok: false; gaps: readonly ApiGap[] }>;

/**
 * Proposed boundary only; adopt actual imports and method names from repo.
 * A content author may INSPECT/VALIDATE and REQUEST publication. The engine
 * performs all mutations through authorized server-side import/command APIs.
 */
export interface ProposedNarrativeAuthoringAdapter {
  discoverPublicCapabilities(names: readonly CapabilityName[]): Promise<readonly CapabilityFinding[]>;
  preflight(draft: DesignDraft): Promise<DraftPreflightResult>;
  // An implementation must perform explicit conversion to the ACTUAL schema.
  // Do not publish an unconverted draft or bypass server authorization.
  requestAuthorizedPublication(draft: DesignDraft, adminPrincipalId: string): Promise<
    | Readonly<{ accepted: true; actualPackId: PackId; activeVersion: ContractVersion }>
    | Readonly<{ accepted: false; reason: string }>
  >;
}

/** Example mapping sheet, NOT a runnable adapter or existing API. */
export const authoringNeeds = [
  'content-validate',
  'content-publish',
  'room-read',
  'object-inspect',
  'npc-converse',
  'quest-transition',
  'world-state-projection',
] as const;
