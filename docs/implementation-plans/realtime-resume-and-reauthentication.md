# MUDD feature implementation plan — Realtime resume and in-band re-authentication

**Status:** Proposed; not started.
**Source:** [round-trip latency audit](../performance/round-trip-latency-audit.md), finding 2 and recommendation 9.
**ADRs affected:** once accepted, amends [ADR 0034](../adr/0034-room-read-model-and-realtime-invalidations.md) and [ADR 0035](../adr/0035-typed-realtime-transport-and-recovery.md).

**Goal / user-observable behavior:**
- The game stops refetching everything every minute.
- A move no longer triggers a follow-up snapshot request.
- Sockets stay open for as long as the player stays signed in.
- After a brief disconnect, the client refetches only what changed.
- HTTP stays authoritative for all state.

**Existing repo findings:**
- **Sockets expire on a timer.** The gateway closes a socket when its view expires ([realtime-gateway.ts:70](../../apps/server/src/realtime-gateway.ts#L70)). For guests, that is 60 s after the last refresh ([index.ts:423](../../apps/server/src/index.ts#L423)). For signed-in players, it is the `exp` of the Clerk token in the upgrade request ([index.ts:424](../../apps/server/src/index.ts#L424)), which an open socket cannot refresh.
- **Every connect triggers a full resync.** The first refresh after connecting sends `ready` and `resync_required` ([realtime-gateway.ts:73](../../apps/server/src/realtime-gateway.ts#L73)). The SDK then marks every watcher dirty ([realtime.ts:63](../../packages/client-sdk/src/realtime.ts#L63)), which costs about six HTTP refetches.
- **Every wakeup reruns the full view read** for all subscribed channels: identity, session, character stream, chat cursor, occupants, interactions, party and team ([index.ts:396](../../apps/server/src/index.ts#L396)).
- **The client can't tell when a refetch is redundant.** `invalidate` frames carry only channel names, under strict v1 schemas ([engine-contracts/src/realtime.ts](../../engine-contracts/src/realtime.ts)). So the `character` watcher refetches `/api/game` after every move ([App.tsx:1044](../../apps/web/src/App.tsx#L1044)), even though the move response already carried that projection.
- **Client frames are capped at 1 KiB** ([realtime-gateway.ts:105](../../apps/server/src/realtime-gateway.ts#L105), plus `maxPayload` in `index.ts`). A Clerk session token may not fit.
- **The current ADRs constrain the protocol.** ADR 0035 requires every reconnect to begin with an explicit HTTP resync, and invalidations to carry no domain payload. ADR 0034 requires the gateway to re-authenticate before each view refresh.

**Owning plugin/capability:** The realtime transport:
- the `@mudd/contracts` realtime schemas;
- the server gateway;
- the `@mudd/client-sdk` transport;
- the web app's watchers.

**Assumptions and deferred scope:**
- Pushing game state over the socket is out of scope. That is the audit's structural direction; it would revisit ADR 0035 and needs its own ADR.
- [Request identity and world-session cache](request-identity-cache.md) lands first, so re-authenticating on each refresh is cheap.
- Installed PWAs can run old SDK code for a while, so v1 frames must keep working.

## Contract changes

Protocol v2 is negotiated per connection. v1 schemas stay as they are.

- **Client `subscribe` frame:** two optional fields:
  - `protocols: [1, 2]`;
  - `resume: { channel: hash }`, holding the last view hash the client received for each channel.
- **Client `authenticate` frame (v2):** carries a fresh Clerk session token, sent before the current one expires. Only signed-in clients send it; for guests, the server re-validates the session from the upgrade request's cookie.
- **Server `invalidate` frame (v2):** adds `hashes: { channel: hash }`. For the `character` channel it also adds `revision`, a version number rather than game state.
- **`resync_required`** is sent only when the client provides no usable resume hashes.

## Boundary map

- **Core/ports touched:** none.
- **Plugin(s) touched:** none.
- **Persistence/migration touched:** none.
- **Client SDK / PWA / TTY impact:**
  - The SDK negotiates v2.
  - It stores the last hash per channel after each successful refetch, and sends `resume` on reconnect.
  - It sends `authenticate` before the token expires.
  - It skips a `character` refetch when its snapshot revision is at least the frame's revision.
  - The web app supplies the token through Clerk's `getToken`.
- **Operational / networking impact:** `authenticate` frames get a 4 KiB limit; all other frames stay at 1 KiB.

## Design

- **Guest expiry:** replace the fixed 60 s expiry with a server-side re-check of the guest session every 60 s, using the identity cache. Close the socket only when the session is invalid or expired.
- **Signed-in expiry:**
  - Verify each `authenticate` token with the same Clerk verification as HTTP, bound to the socket's user and session.
  - On success, extend the socket's expiry to the new token's `exp`.
  - On a verification failure or user mismatch, close the socket.
- **Wakeup scope:** recompute only the channels a wakeup can affect, and run the identity check from the cache on every refresh.
  - `character`, for the socket's own character.
  - `presence` and `chat`, on a room change.
  - `interactions`, `party` and `team`, for wakeups of their own kind.
- **Resume:** on reconnect, compute the current view and send `invalidate` only for channels whose hash differs from the client's `resume` value. A sequence gap still marks every watcher dirty, as today.

## Invariants and failure paths

- HTTP remains authoritative. Frames carry only hashes and a revision number, never state or commands.
- Every refresh still checks the account, session and character before emitting anything (ADR 0034).
- A client that fails a refetch must drop that channel's stored hash, so resume never skips a channel it failed to load.
- v1 clients keep today's behavior exactly, including `resync_required` on every connect.
- Oversized, malformed or unauthenticated frames close the socket, as today.
- Tokens are never logged.

## Steps

1. Amend ADR 0035 and ADR 0034 to cover hash-based resume, revision metadata in invalidations, in-band re-authentication and v1 compatibility.
2. Add v2 schemas to `@mudd/contracts` with version negotiation, keeping the v1 strict schemas.
3. Gateway: implement negotiation, the guest re-check, `authenticate` handling, per-kind recompute, hashes and revision in v2 frames, and resume.
4. SDK transport: implement negotiation, per-channel hashes, resume on reconnect, a token refresh hook and the revision-based skip.
5. Web app: provide the token hook, and confirm the move flow no longer refetches `/api/game` after the command response.
6. Add tests:
   - **Gateway:**
     - resume with matching and with differing hashes;
     - `authenticate` success, failure and user mismatch;
     - an oversized token frame;
     - the guest re-check;
     - a v1 client.
   - **SDK:**
     - resume after a drop;
     - a sequence gap forcing a full refresh;
     - the revision skip;
     - a failed refetch clearing its hash.
   - **App:** a move makes one command request and no snapshot request.
   - **End-to-end:** two clients observe the same move.
7. Measure in development: requests per idle minute per player, and requests per move.

## Acceptance criteria

- [ ] An idle player, guest or signed-in, keeps one socket open without a periodic full resync.
- [ ] A reconnect after a short drop refetches only the channels that changed.
- [ ] A move produces no follow-up `/api/game` request.
- [ ] v1 clients behave exactly as today.
- [ ] The amended ADRs are accepted.

## Rollout and rollback

1. Ship the server first, accepting both protocols.
2. Ship the SDK and web app with v2 behind a client build flag.

To roll back, disable v2 in the client; the server keeps serving v1.
