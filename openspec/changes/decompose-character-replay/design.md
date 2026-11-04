# Character replay design

## Context

`replayCharacterUncached` reconstructs a character from the first event. `replayCharacter` can resume adapter-registered immutable histories from a process-local checkpoint. Both use `reconstructCharacter`. A checkpoint contains the public projection, the count of events folded, and four private sets. Generic incremental projections also consult history registration and parentage, which currently ties group, interaction, and team projections to the character replay module. [ADR 0033](../../../docs/adr/0033-immutable-character-replay-checkpoints.md)

## Goals / Non-Goals

A maintainer changing a fishing event should be able to review its parsing, invariants and projection update together without tracing the combat or cache code. A maintainer changing checkpoint lifetime should be able to verify both character and generic projections. Gameplay policy changes, a public reducer API, persisted snapshots and storage migrations are outside scope.

## Decisions

### Separate history identity from character checkpoint contents

Move immutable registration, freezing and weak parent links into a shared internal history module. Keep character checkpoint lookup, retention of an available parent checkpoint at registration, and cloning of returned character state with character replay. A weak link to a parent history alone cannot guarantee that a previously retained checkpoint remains available. Preserve the adapter's existing explicit registration contract, including cold rebuilds for independent histories and mutable input. Retain existing exports through the public facade so callers continue using the same registrations.

### Keep an ordered fold and static event handlers

Both replay entry points use one fold. It checks revision continuity before dispatch, selects a handler by the exact stored event type, and fails on unknown types. Within each handler preserve the ordering of creation preconditions, version-specific schema parsing, domain validation, and state updates. Keep the storage-only stream ID out of schema input. Derive available class actions after the fold as today.

Group related handlers around shared decisions, such as inventory and equipment, gathering and crafting, or combat outcomes and advancement. Review the complete event list at cutover. Keep historical handlers available independently of currently loaded plugins. A runtime registry would make recovery depend on world configuration. Consolidate repeated validation only when the original branches enforce the same rule, particularly for PvP and team consumables.

### Treat encounter evidence as part of the replay state

A team victory authorizes a later advancement award. Team outcomes and zero-health PvP outcomes can authorize respawn, which consumes the relevant encounter evidence. A spent class ability action ID prevents a second spend. Preserve all four sets across checkpoints and isolate each resumed fold's writes from its parent and siblings. Only handlers that need a particular piece of evidence should receive it. Publish the completed checkpoint after the whole tail succeeds.

## Risks / Trade-offs

- **Matching two wrong results.** Cached and uncached replay share code. Assert specific outcomes, including respawn health and location, and the reason and revision of rejected events alongside parity checks.
- **Silently changing old characters.** Preserve historical combat and recovery semantics and recorded movement costs. Run the existing version-focused replay tests against the public entry points.
- **Losing incremental performance.** Character state can remain correct even if every append triggers full replay. Exercise generic tail-only reduction, PostgreSQL cache freshness and eviction, and the documented local latency benchmark. Compare baseline and candidate on the same fixture and policy. The benchmark's own policy labels do not identify the two revisions. [Benchmark procedure](../../../docs/performance/gameplay-latency.md)

## Migration Plan

1. Land characterization coverage against the existing implementation. Capture the performance baseline on the unmodified runtime.
2. Separate immutable-history tracking and verify it through the existing public adapters and projection tests.
3. Replace the monolithic reducer in one mergeable cutover. Develop and review handlers in event-family slices within that stage. Editing even one surviving branch selects the entire enclosing function for the PR quality gate. All touched production functions must comply at cutover; prune obsolete allowances and review cohesion separately. [PR quality](../../../docs/pr-quality.md)

Each stage can be reverted in reverse order. Saved events require no conversion. A behavior discrepancy discovered during characterization is a separate bug-fix decision and should be reported before refactoring that path.
