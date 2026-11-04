# Decompose character replay

## Why

A single function reconstructs character state from 44 event types. Changing a fishing rule requires editing the same function that validates respawn, interprets historical combat events, and resumes a character from a checkpoint. These responsibilities can be separated while preserving the meaning of saved histories.

## What Changes

- Establish public-behavior coverage for checkpoint forks, replay-only evidence, and competing validation failures before restructuring the implementation.
- Give character replay and generic incremental projections a shared internal owner for immutable history tracking.
- Keep one ordered replay loop and statically compose event handlers by gameplay responsibility within engine-core. Verify both full reconstruction and replay after an append.

## Capabilities

### New Capabilities

None. This internal refactor uses `skip_specs: true`.

### Modified Capabilities

None. The acceptance baseline is existing replay behavior, including historical event versions and rejection precedence.

## Impact

Implementation centers on `packages/engine-core/src/replay.ts`, `incremental-projection.ts`, and their tests. PostgreSQL callers and gameplay plugins exercise the public boundary. The work preserves their imports, stored event formats, projection shapes, and the process-local checkpoint policy from ADR 0033.
