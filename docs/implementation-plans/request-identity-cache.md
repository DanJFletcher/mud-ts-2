# MUDD feature implementation plan — Request identity and world-session cache

**Status:** Proposed; not started. Source: [round-trip latency audit](../performance/round-trip-latency-audit.md), recommendation 8.

**Goal / user-observable behavior:** Most requests and realtime refreshes skip the account and active-world-session lookups. Each saves 2 round trips, about 55 ms at 27 ms each. The gateway saves more, because it repeats both lookups on every wakeup. Authentication and authorization stay as strict as today.

**Existing repo findings:**
- On every request, `accountFor` calls `getAccountIdentity` ([session-service.ts:41](../../apps/server/src/session-service.ts#L41)). That runs a guest lookup by token hash, or a Clerk profile lookup by `clerkUserId` ([session-service.ts:80](../../apps/server/src/session-service.ts#L80)). On first sign-in it also creates or claims a player and migrates guest characters ([session-service.ts:91](../../apps/server/src/session-service.ts#L91), [session-service.ts:134](../../apps/server/src/session-service.ts#L134)).
- `activeSession` ([index.ts:370](../../apps/server/src/index.ts#L370)) reads `world_sessions` by player and world on every world request.
- The realtime gateway repeats both lookups on every refresh ([index.ts:396](../../apps/server/src/index.ts#L396)).
- `clerkMiddleware` verifies Clerk session tokens on every request. That check is outside this cache and stays per request.
- The `world_sessions` trigger already sends `membership` notifications on insert, on delete, and when a session's character or world changes ([0009_realtime_wakeups.sql](../../apps/server/drizzle/0009_realtime_wakeups.sql)).

**Owning plugin/capability:** Server request wiring in `apps/server` (`session-service.ts`, `index.ts`). No plugin or contract changes.

**Assumptions and deferred scope:**
- Caches are in-process and in memory only. Nothing is persisted.
- Only successful lookups are cached. Misses and errors always go to the database.
- **Revocation timing (needs sign-off in the ADR):**
  - Revoking a guest session takes effect within the cache TTL of 60 s, not immediately.
  - Clerk sign-out still takes effect immediately, because Clerk verification runs on every request.

## Contract changes

None. HTTP responses and realtime frames are unchanged.

## Boundary map

- Core/ports touched: none.
- Plugin(s) touched: none.
- Persistence/migration touched: none.
- Client SDK / PWA / TTY impact: none.
- Operational / networking impact: memory is bounded by an LRU limit, and the slow-request log gains hit and miss counters.

## Design

- **Identity cache**
  - Guests: keyed by the HMAC token hash, never the raw token. Each entry stores the player ID, display name, session ID and session expiry. It expires at whichever comes first: 60 s or the session's own expiry.
  - Clerk users: keyed by Clerk user ID. Each entry stores the player ID and display name, with a 60 s TTL.
  - Entries are written only after a successful lookup, never during the create-or-claim path.
- **World-session cache**
  - Keyed by player and world. Each entry stores the session ID, character ID and `lastSeenAt`.
  - When this process touches presence, it updates the entry in place.
- **Invalidation.** Clear entries on these local events:
  - guest session creation;
  - guest-to-account claim and migration;
  - world entry (`enterWorld`) and `DELETE /api/world-session`;
  - character archive.

  Changes made by other processes arrive as `membership` notifications, which also clear entries.
- **Misses.** On a cache miss, fetch the account and the world session with one joined query instead of two.

## Invariants and failure paths

- The cache never authenticates a request by itself. A Clerk user must still pass `clerkMiddleware` on the same request, and a guest must present the token whose hash is the cache key.
- A cached world session is used only for the same player and world. A command for a different character still gets the existing 403 response.
- Expired guest sessions are rejected based on the expiry stored in the entry, without waiting for the TTL.
- Cache keys and entries never appear in logs; only counters do.

## Steps

1. Write a short ADR for the trust-boundary change. It covers what is cached, the TTLs, revocation timing and the invalidation events.
2. Implement the identity and world-session caches with LRU bounds and hit and miss counters.
3. Wire invalidation into:
   - session creation;
   - account claim and migration;
   - world entry and exit;
   - character archive;
   - the `membership` notification handler.
4. Replace the two queries on the miss path with one joined query.
5. Add tests for:
   - guest session expiry;
   - guest-to-account claim and migration (the old guest entry must not resolve);
   - sign-out;
   - switching worlds;
   - character archive;
   - cross-process invalidation through `membership` notifications;
   - behavior with the cache disabled.
6. Compare development traces. `account.*` and `world_session.active_lookup` operations should disappear from warm requests.

## Acceptance criteria

- [ ] Warm HTTP requests and gateway refreshes issue no account or world-session queries.
- [ ] Claim, migration, sign-out, archive and world-switch tests pass.
- [ ] Revocation timing matches the accepted ADR.
- [ ] Memory stays within the configured bound under a synthetic many-player test.

## Rollout and rollback

Ship behind `MUDD_IDENTITY_CACHE=1`. To roll back, unset the flag; every request then does its own lookups again.
