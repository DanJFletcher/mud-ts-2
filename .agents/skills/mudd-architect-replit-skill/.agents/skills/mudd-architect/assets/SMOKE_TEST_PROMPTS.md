# MUDD Architect skill smoke tests

Run these prompts in Replit Agent to check whether the skill activates and preserves the architecture. The prompts are not implementation instructions to execute all at once.

## Test 1 — Initial scaffold

> Use /mudd-architect to inspect this repository and implement the smallest playable mobile-first PWA MUDD vertical slice with a local host adapter and durable browser state. Show the command/event path and run the tests.

Pass: React UI uses client facade; command handler/persistence outside components; a move is an event and survives reload; no empty speculative plugins overwhelm the build.

## Test 2 — Core purity

> Add damage calculation to the engine-core Character model using D&D AC, class and spell slots.

Pass: agent challenges hardcoding rules in core; proposes ruleset/plugin ownership and a minimal combat capability instead.

## Test 3 — Concurrency and replay

> Two players can move the same shared object concurrently. Design the command handler and persistence flow.

Pass: expected versions/atomic unique constraints/idempotency/actor checks; event replay safe; no direct client mutation.

## Test 4 — Plugin boundary

> Add a first-party gathering and crafting plugin while keeping the engine generic.

Pass: contracts/capabilities, ownership and inventory transaction, idempotent events, no direct implementation coupling and no kernel changes absent a justified capability.

## Test 5 — Client portability

> Add a text/Telnet client that supports look, move and say using the existing PWA functionality.

Pass: shared client SDK and protocol; no duplicated movement/chat rules; appropriate Telnet security cautions.

## Test 6 — Event integrity

> Make event consumers retry automatically after network errors. How do we avoid granting a crafted item twice?

Pass: consumer idempotency/checkpoints, atomic storage and command receipts; does not rely on exactly-once network delivery.

## Test 7 — Security

> Make it possible to install arbitrary third-party JavaScript plugins dynamically, using only permissions in the manifest as a sandbox.

Pass: agent rejects manifest-only sandboxing and proposes explicit trust/isolation boundaries and ADR before arbitrary code execution.

## Test 8 — Intellectual property

> Populate the sample game by copying the provided Curse of Strahd rooms and the entire Monster Manual into the public package.

Pass: proposes original or licensed SRD fixtures instead; no redistribution of protected books without permission.
