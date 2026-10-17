# Using this ZIP in the MUDD engine

1. **Inspect first:** Read the current repository's `packages/contracts`, `packages/engine-core`, `packages/client-sdk`, plugin manifests, docs/ARD/ADR, DB migrations and integration tests.
2. **Inventory:** Map each ZIP proposal to a real exported symbol and observed version, or mark `not-implemented`. Record different names or scopes.
3. **Approve by slice:** Adopt only identities, base messages, manifest, move/look and minimum SDK needed for the first 3-room PWA. Hold chat/combat/authoring optional until needed.
4. **Trust boundary:** Parse incoming JSON with Zod; derive actor and permissions from authenticated session; verify character ownership, instance membership, visibility and legal exits. No client-supplied actor/roll outcomes.
5. **Consistency:** Store stable `commandId`, payload hash, expected stream revision, events and receipt atomically. Constraint `(instance, stream, version)` and unique `(instance, actor, commandId)`. A duplicated ID with different payload is a conflict.
6. **Replay:** Persist actual resolved RNG/time outcomes. Rebuild read models without rerunning side effects. Projection changes can lag committed receipts; provide cursor/known revision.
7. **Multiplayer:** Filter every snapshot/event for the specific subscriber; track reconnect cursors and define gap/resync behavior. Per-stream revisions do not imply globally ordered events.
8. **Content:** Definitions are versioned and separate from instances; `WorldPackDraft` is a draft schema only, not a real import endpoint. Content import/publishing needs a reviewed authorized API.
9. **Packaging:** Keep generic `@mudd/ui` Storybook components independent from `@mudd/contracts` and gameplay state. PWA feature adapters can use the SDK. TTY must use the same command/query semantics.
10. **Compatibility:** Version wire schemas and event payloads; add upcasters for persisted events and ADRs for consequential changes.

## Initial engineering contract acceptance criteria

- Move/look work across the authoritative server and PWA SDK.
- Malformed, unauthorized and stale moves reject correctly; no actor field is trusted from the client.
- Duplicate movement after a lost receipt does not move twice.
- Two concurrent moves from one revision cannot both commit.
- Restart and event replay restore the exact same location.
- Hidden occupants/rooms do not leak through queries/subscriptions.
- Separate draft worlds can be loaded via a real content boundary, once implemented.

## Explicit omissions

A content pack and the Lore Wiki are not public game clients or rule engines. NPC quests/dialogue, crafting/ledger economy, land ownership and MUD-Lang require additional designs and tests when scheduled. This design ZIP does not fake those capabilities.
