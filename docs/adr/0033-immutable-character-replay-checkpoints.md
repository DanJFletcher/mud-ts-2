# Immutable character replay checkpoints

## Status
Accepted.

## Context
An event-array cache alone still leaves every caller parsing every character event.
Histories above the former 512 KiB ceiling also miss that cache entirely. Recovery
ticks multiply this work across offline sessions, competing with player commands.

## Decision
- PostgreSQL remains authoritative. Every stream read checks its indexed head.
  Transactions, optimistic revisions, advisory locks and idempotent receipts are unchanged.
- The adapter explicitly registers immutable histories for process-local projection
  checkpoints. Registration freezes the array and event payloads. Public mutable
  histories continue to use pure replay.
- A checkpoint retains the projection **and all** replay-only outcome/action
  deduplication sets. An adapter-verified appended tail resumes from that checkpoint;
  an independent history, eviction, restart or missing checkpoint fully replays.
- Return cloned projections, never the private checkpoint object.
- History retention is LRU-bounded to 128 streams / 32 MiB serialized events, with
  an 8 MiB per-stream ceiling. This is not an exact heap-size limit: projections,
  sets and JavaScript object overhead also consume memory. Account for appended
  bytes without reserializing the full prefix. Empty histories can be cached since
  the head is still checked, so newly created streams remain discoverable.
- Recovery reconciles saved sessions once at startup, then queries recent sessions
  and tracks their final offline settlement. Failed settlements remain retryable;
  settled offline characters do not trigger a stream read every second.
- Browser background refreshes pause during actions and reject results crossing
  an action boundary. Party/team discovery remains enabled at a lower idle cadence;
  chat resumes immediately when a hidden tab becomes visible.

## Consequences
No persisted snapshots, event/schema migrations or client-trusted state are introduced.
History beyond the size ceiling still requires cold replay. Multiple server processes
maintain independent caches and always check database heads. Cold-start reconciliation
can still be expensive for many saved sessions; durable compatible snapshots or a
persisted recovery watermark should be considered if measurements warrant them.

## Verification
Real PostgreSQL tests cover large histories, cross-writer freshness, stale revisions,
idempotency, companion updates and cache eviction. Client tests cover delayed snapshot
ordering and hidden chat polling. The guarded local benchmark compares the former
history policy with the new adapter using real command/query handlers; it is not a
production network-latency measurement.
