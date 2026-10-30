# ADR 0038 — Revision hints in realtime invalidations

- **Status:** Accepted
- **Date:** 2026-10-30
- **Owners:** Engine and game client
- **Amends:** [ADR 0035](0035-typed-realtime-transport-and-recovery.md), [ADR 0034](0034-room-read-model-and-realtime-invalidations.md)
- **Related tasks:** [Round-trip latency audit](../performance/round-trip-latency-audit.md), quick win 2

## Context

Every committed character event reaches the client as a `character` invalidation, and the client answers it by fetching the full `/api/game` snapshot. After a move, the command response already carries that projection. After other actions, the client has just fetched the snapshot itself. The realtime-triggered refetch is therefore usually redundant, and it adds about seven database round trips per action at production latency. The frame cannot tell the client whether it already holds the change.

Installed PWAs can keep running an older SDK build. Those builds parse server frames with strict v1 schemas and close the socket on any unknown field, so adding a field to every frame would break them.

## Decision

- Clients opt in to protocol 2 by adding `protocol=2` to the realtime socket URL. Servers that predate this ignore the parameter.
- For protocol 2 connections, `invalidate` frames use `version: 2`. When the `character` channel changed, they include `revisions: { character }`, the character's stream revision. It is a version number, not game state; HTTP stays authoritative for every value.
- Protocol 1 connections receive exactly the frames they did before.
- The SDK keeps the latest hint only for the open, in-sequence connection. It clears hints on a new connection, on `resync_required` and on close, so polling fallback never relies on them.
- The web client skips the snapshot refetch for a `character` invalidation only when the hinted revision is no newer than the revision it has applied. Visibility, polling and resync refreshes are unchanged.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Add `revisions` to every v1 frame | Simplest server change | Breaks installed clients that parse strict v1 frames |
| Server suppresses invalidations a client already received over HTTP | No protocol change | Races with the commit notification, and cannot tell which open tab holds the state |
| Client skips refetches shortly after its own actions | No server change | Can drop a real change made in that window |
| Push the snapshot over the socket | Removes the refetch entirely | A second authority, which ADR 0035 rejects; revisit separately |

## Consequences and trade-offs

- **Positive:** one fewer full snapshot request per action for current clients, with no change to authority or recovery.
- **Negative:** two frame versions exist until old clients age out.
- **Compatibility/migration:** fully backward compatible in both directions; no data migration.
- **Security/abuse/trust:** frames still carry no game state, and every view refresh is still re-authorized before anything is sent.
- **Performance/operational:** removes the post-action `/api/game` request and its database work.
- **Rollback/reversibility:** stop sending `protocol=2` from the client; the server keeps serving both versions.

## Verification

- Gateway tests: protocol 2 frames carry the hint only when `character` changed, and protocol 1 frames are unchanged.
- SDK tests: hints are scoped to the open, in-sequence connection and cleared on resync and close; the socket URL requests protocol 2.
- Web suite passes with the skip in place.

## Follow-up / revisit trigger

- In-band re-authentication and hash-based resume build on this negotiation; see the [realtime resume plan](../implementation-plans/realtime-resume-and-reauthentication.md).
- Remove protocol 1 support once installed clients have updated past it.
