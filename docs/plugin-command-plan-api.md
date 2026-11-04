# Plugin command-plan API: stream kinds

The engine host API is **2.0**. Every command plan and atomic stream write must declare the kind of aggregate it writes.

## Required metadata

Add `streamKind` to the primary `CommandPlan`, every companion `StreamWrite`, and any direct `AppendRequest`:

- `character` — the stream is owned by a character and participates in the character room-state projection.
- `non-character` — the stream is a shared-world, system, or other custom aggregate.

Classify by aggregate ownership, not by stream ID format or event name. Character IDs are not required to look like UUIDs, and a UUID-shaped shared stream is still `non-character`.

```ts
return {
  streamId: characterId,
  streamKind: 'character',
  expectedVersion,
  events,
  companions: [{
    streamId: worldItemsStreamId,
    streamKind: 'non-character',
    expectedVersion: worldItemsRevision,
    events: itemEvents,
  }],
};
```

System commands follow the same rule. Declare the kind for the primary stream and for every companion independently.

## Migrating a plugin

1. Change the plugin manifest's exact `apiVersion` to `2.0`.
2. Add `streamKind` to every primary and companion command-plan write.
3. Add it to direct event-store append requests, if the plugin or host adapter creates any.
4. Run the plugin typecheck and dispatch tests. The host rejects mismatched API versions and rejects missing or invalid stream-kind metadata before appending.

This is a code/API migration only. It does not change event formats, stored data, the PostgreSQL function, or require a database migration. Plugins using API 1.0 must be updated and rebuilt before they can load in the API 2.0 host.
