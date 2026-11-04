# Design

## Context

See `proposal.md` for motivation. `world.ts` currently holds both authored definitions and world-pack validation, plus player-facing queries, commands, and runtime projections. Shared schemas such as map terrain/color, readable actions, and container kind are used across both sides. `world-map-data.ts` currently imports authoring contracts through `world.ts`; `engine-contracts/src/index.ts` exports `world.ts` as the package-facing entry point.

## Goals / Non-Goals

**Goals:**

- Separate authoring and runtime responsibilities without changing schema behavior or exported names.
- Keep dependencies one-way and shared schemas defined only once.
- Preserve both direct `world.ts` imports and the `@mudd/contracts` package export surface.

**Non-Goals:**

- Change protocol versions, wire formats, gameplay behavior, validation rules, or world-pack data.
- Reorganize unrelated contract domains or change the existing autonomous NPC movement contracts.
- Introduce a package or dependency.

## Decisions

### Keep three focused modules behind the existing `world.ts` entry point

- `world-content.ts` owns authored location, object, road, NPC/dialogue, and world-pack schemas; `WorldPackDraftSchema`, its input/output types, and `validateDraftWorldGraph` remain together because they compose and validate authored content.
- `world-runtime.ts` owns world queries and commands, NPC presence, and location/map/runtime projection schemas and types.
- `world-shared.ts` owns only schemas used on both sides, including map terrain/color, readable action, and container-kind schemas. Their definitions and inferred types must not be duplicated.
- `world.ts` becomes a compatibility re-export of these modules. `engine-contracts/src/index.ts` keeps exporting `world.ts`, with no public export rename.

The shared module avoids making runtime contracts depend on the full world-pack authoring schema just to reuse a few primitives. It also prevents an authoring-to-runtime dependency.

### Make implementation imports point to the owning module

Update internal consumers to import from the focused module they use. In particular, `world-map-data.ts` should import location/road authoring schemas and `WorldPackDraftInput` from `world-content.ts`; client, stream, and movement projection code should import runtime contracts from `world-runtime.ts`. Type-only world-pack consumers should import from `world-content.ts`.

The current import graph has no unavoidable cycle: `world-map-data.ts` imports `world.ts`, but `world.ts` does not import the map-data adapter. Direct imports are chosen for ownership clarity and to keep that direction explicit as the compatibility barrel is simplified.

### Keep authoring input and parsed output types distinct

Retain the existing `z.input<typeof WorldPackDraftSchema>` input type and `z.infer<typeof WorldPackDraftSchema>` parsed type unchanged. Move schema definitions and their related exported types together; do not replace authored-input types with parsed types.

### Treat this as a behavior-preserving move

Move existing Zod declarations and refinements without rewriting their constraints. Keep `validateDraftWorldGraph` with the authored pack it validates. Existing graph-validation and map-data tests continue to exercise the public package entry point; add or adjust focused tests only to catch export or schema-identity regressions introduced by the split.

Alternatives considered:

- Keeping everything in `world.ts` avoids import edits but preserves the mixed ownership that prompted the change.
- Splitting immediately into many location, NPC, object, and map modules would add cross-module dependencies around `WorldPackDraftSchema` and its graph validation. Start with lifecycle boundaries and only introduce further domain files when independent ownership is demonstrated.
- Having runtime import shared validators from the full authoring module is acyclic but couples runtime contracts to the world-pack composition module; the small shared module avoids that coupling.

## Risks / Trade-offs

- **Schema behavior changes during extraction** → Move declarations and refinements intact; verify the existing contract suite and downstream type checks.
- **Missing or ambiguous barrel exports** → Preserve each existing named export through `world.ts` and run package build/tests plus affected consumer checks.
- **A hidden module cycle** → Keep `world.ts` as a leaf re-export facade; implementation modules must not import from the facade. Keep `world-map-data.ts` pointed at the authoring module.
- **Too many small modules** → Limit the new structure to content, runtime, and a small shared-schema module; do not split unrelated domains in this change.

## Migration Plan

1. Extract shared schemas, then authored contracts and runtime contracts, keeping their exported names and definitions.
2. Replace `world.ts` implementation with re-exports and update internal imports to their owning modules.
3. Run the `engine-contracts` build/tests and relevant downstream type/test checks to confirm compatibility.

There is no data migration or deployment change. If verification finds an incompatible change, revert the extraction and restore the original `world.ts` implementation.
