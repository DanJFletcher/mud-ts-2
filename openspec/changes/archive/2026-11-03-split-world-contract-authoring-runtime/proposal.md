# Proposal

## Why

`engine-contracts/src/world.ts` combines authored world-pack definitions and cross-reference validation with runtime queries, commands, and client projections. Separating these lifecycle responsibilities will make contract ownership easier to follow and safer to change without altering the schemas' behavior.

## What Changes

- Keep authored world definitions, `WorldPackDraftSchema`, its input/output types, and graph validation together in `world.ts`.
- Move world query/command and runtime projection schemas and types into `world-runtime.ts`.
- Re-export runtime and shared contracts from `world.ts` so existing imports remain valid.
- Keep shared schemas single-sourced, and make internal imports follow the authoring/runtime dependency direction.
- Preserve existing validation behavior and verify the package's public exports and contract tests.

This is an internal refactor. It does not change wire formats, gameplay behavior, migrations, or package dependencies.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change does not alter externally observable requirements; specs are intentionally skipped in `.openspec.yaml`.

## Impact

- `engine-contracts/src/world.ts`, `world-runtime.ts`, and `world-shared.ts`.
- Internal consumers such as `client.ts`, `stream.ts`, and `movement-projection.ts`, only where needed to clarify imports.
- Existing `engine-contracts` tests, especially world graph validation and map-data composition.
- The `@mudd/contracts` export surface remains unchanged.
