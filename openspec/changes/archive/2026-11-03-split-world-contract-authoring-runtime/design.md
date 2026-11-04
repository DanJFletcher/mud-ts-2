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

### Keep authored content in `world.ts`; extract runtime contracts

- `world.ts` remains the authoring module for location, object, road, NPC/dialogue, and world-pack schemas. Keep `WorldPackDraftSchema`, its input/output types, and `validateDraftWorldGraph` together because they compose and validate authored content.
- `world-runtime.ts` owns world queries and commands, NPC presence, and location/map/runtime projection schemas and types.
- `world-shared.ts` owns only schemas used on both sides, including map terrain/color, readable action, container-kind, and NPC combat-disposition schemas. Their definitions and inferred types must not be duplicated.
- `world.ts` re-exports runtime and shared contracts to preserve direct imports. `engine-contracts/src/index.ts` keeps exporting `world.ts`, with no public export rename.

The shared module avoids making runtime contracts depend on the full world-pack authoring schema just to reuse a few primitives. It also prevents an authoring-to-runtime dependency.

### Make implementation imports point to the owning module

Update runtime consumers such as `client.ts`, `stream.ts`, and `movement-projection.ts` to import from `world-runtime.ts`. Authored-world consumers such as `world-map-data.ts` and type-only world-pack consumers can continue to import from `world.ts`.

`world-runtime.ts` must not import from `world.ts`; it should depend only on shared and lower-level contracts. `world.ts` can then re-export runtime contracts without creating a cycle.

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
- **A hidden module cycle** → Keep `world-runtime.ts` independent of `world.ts`; only `world.ts` re-exports runtime contracts.
- **Too many small modules** → Limit the new structure to content, runtime, and a small shared-schema module; do not split unrelated domains in this change.

## Migration Plan

1. Extract shared schemas, then move runtime contracts into `world-runtime.ts`, keeping their exported names and definitions.
2. Re-export runtime contracts from `world.ts` and update runtime consumers to import from their owning module.
3. Run the `engine-contracts` build/tests and relevant downstream type/test checks to confirm compatibility.

There is no data migration or deployment change. If verification finds an incompatible change, revert the extraction and restore the original `world.ts` implementation.
