# Proposal

## Why

Orraveth's world entry point mixes roughly 2,000 lines of dialogue generation, settlement content, economy, encounters, quests, and assembly. This makes changes difficult to review and conceals concrete dialogue-access problems and a shared NPC identity validation gap.

## What Changes

- Extract typed settlement and gameplay content modules, leaving the public entry point responsible for exports, composition, schema parsing, and graph validation. Preserve the accepted JSON-layout/TypeScript-content boundary.
- Replace the eight-position small-talk helper with named options and explicit visibility semantics; preserve existing authored IDs and defaults.
- Share repeated creature profiles through local factories with explicit loot overrides, and format crafting recipes for review without rebalancing content.
- Keep Anwen's eligible quest acceptance and turn-in choices available after town small talk, without requiring conversation restart.
- Correct the Independent Boatman's overlapping topic keywords so ferry-stage questions return passage information and guild-dispute questions retain their response.
- Reject duplicate authored NPC IDs across a complete world pack, including static/static and static/mobile collisions.
- Add output-equivalence coverage for the extraction and focused regression coverage for the intentional behavior changes.

## Capabilities

### New Capabilities

- `orraveth-npc-dialogue`: Quest access independent of incidental small talk and unambiguous ferry-stage topic routing in Orraveth.
- `world-npc-identity`: World-wide uniqueness of authored NPC identities at schema and graph-validation boundaries.

### Modified Capabilities

None. The main capability inventory is currently empty. The structural refactoring is specified in the design and tasks rather than inventing a new runtime capability.

## Impact

- Main implementation area: `packages/world-orraveth/src/`, with local internal modules and unchanged package exports.
- Shared validation: `engine-contracts/src/world.ts` and contract regression tests. Previously accepted packs containing duplicate NPC IDs will be rejected deliberately; current valid packs retain their identity and behavior.
- Verification: world-package tests, NPC dialogue tests, and Orraveth server integration tests, including assertions that currently require Anwen's quest actions to disappear in the town branch.
- No new dependencies, database migrations, protocol/event schema changes, engine ownership changes, generic topic-ranking algorithm, map-data reorganization, or creature balance changes. Existing saved progress remains valid.
