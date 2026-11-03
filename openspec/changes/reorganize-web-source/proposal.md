# Proposal

## Why

The web source root mixes account bootstrapping, world composition, session infrastructure, panels, and styles even though controllers and screens already have useful ownership boundaries. Stylesheet ownership also crosses application areas, including world recovery controls styled by account CSS, making moves liable to preserve hidden dependencies or alter the cascade.

## What Changes

- Organize app-local code into explicit `app`, `lobby`, `world`, and `codex` areas; rename the gameplay entry module to `WorldClient` and keep tests beside their owners.
- Group world session infrastructure and its focused contracts, retain existing controller/screen boundaries, and place panel/dialog helpers beside their consumers.
- Separate shared app styling and theme overrides from gameplay layout, then split world styles by ownership while preserving visual appearance and deliberate cascade order.
- Establish explicit area stylesheet dependencies: account/lobby and standalone Codex need no world stylesheet, world controls need no account-only rules, and route visitation order does not alter an area's appearance. Preserve current eager world CSS loading in this change.
- Document dependency and stylesheet ownership; update affected imports, configuration references, and quality-record paths without increasing legacy budgets.
- Extend suppression-budget migration to proven import-only, one-to-one renames; resolve dependencies against Git revisions and retain numeric function and site-ledger checks unchanged.

## Capabilities

### New Capabilities

- `web-style-isolation`: Independent area styling, explicit theme inheritance, and consistent appearance across direct loads and route transitions.
- `quality-budget-migration`: Conservative transfer of existing suppression counts across verified module relocations without creating allowances or bypassing changed-code checks.

### Modified Capabilities

None. Folder layout and module renames are implementation decisions rather than new runtime capabilities. Existing session reconciliation, feature lifecycle, command interaction, and history requirements remain unchanged.

## Impact

- Primarily affects `apps/web/src`, its tests and ownership documentation; configuration paths and path-based quality records may require corresponding updates.
- Also affects suppression-budget comparison under `scripts/quality` and its focused regression tests; policy thresholds, coverage floors and site identities remain unchanged.
- May add a narrowly scoped styling hook or variant in `packages/ui` only where an existing cross-boundary override requires it; such additions require stories and behavior coverage first.
- Builds on the substantially implemented, unarchived `refactor-world-client` and completed `extract-game-session-hook` changes; does not complete or claim their outstanding manual checks.
- No gameplay, SDK/protocol, server, persistence, routing-framework, dependency, or intended visual-design changes. No wholesale CSS Modules conversion or general controller rewrite.
