# ADR 0040 — Cache request identity and active world sessions

- **Status:** Accepted
- **Date:** 2026-10-30
- **Owners:** MUDD server
- **Related tasks:** [Request identity and world-session cache plan](../implementation-plans/request-identity-cache.md)

## Context

Every authenticated API request resolves the account profile, and world requests separately resolve the active session. The realtime gateway repeats those lookups on refresh. The round-trip latency audit estimates about 27 ms for each lookup in the measured environment, even for a single player.

Authentication and world membership are trust boundaries. A cache may avoid repeated database reads, but it must not authenticate a request without the current Clerk middleware check or a valid guest cookie, and it must not reuse a world session for another player or world.

## Decision

- Add an opt-in process-local LRU cache, enabled only when `MUDD_IDENTITY_CACHE=1`, with a 60-second maximum TTL and a 10,000-entry bound.
- Cache only successful account identity lookups. Guest identities are keyed by the existing HMAC token hash and expire no later than the guest session itself. Clerk identities are keyed by Clerk user ID only after Clerk middleware authenticates the request.
- Cache active world sessions by the composite player/world key. Use those entries only while the process's membership-notification listener is connected; clear world-session entries when it disconnects.
- On a cache miss where a world is requested, fetch the account identity and that world's active session in one joined query. Preserve existing authorization checks after resolution.
- Invalidate locally after guest creation or claim/migration, world entry or exit, character archive, and relevant membership notifications. Update cached presence timestamps after successful heartbeats.
- Record cache hit/miss counts in the existing slow/traced HTTP request measurements. Do not log cache keys, guest tokens, or identity data.
- Guest revocation through external deletion may take effect within the 60-second identity TTL if the process does not receive an invalidation. Clerk revocation remains immediate because Clerk middleware validates each request. The one-time guest cleanup runs as a deployment pre-start operation; during rolling overlap, an older process can retain an already-cached guest identity for at most the TTL.
- No database schema, event, HTTP response, or realtime frame changes are introduced. Unset the feature flag to bypass the caches and restore per-request lookups.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Keep querying on every request | No cache invalidation or revocation window | Retains the avoidable database round trips identified by the audit |
| Add a shared distributed cache | Cross-process reads and invalidation | Adds another network dependency and operational surface for a small, short-lived cache |
| Use bounded process-local caches with membership invalidation | No external dependency; short bounded TTL; notification-aware world-session validity | Identity entries can remain until TTL expiry when cross-process invalidation is unavailable |

## Consequences and trade-offs

- Positive: warm requests and gateway refreshes can skip identity and active-session lookups; a cold world request combines them into one database query.
- Negative: each server process holds a bounded in-memory copy, and external guest deletion has a maximum 60-second stale-identity window if its notification is missed.
- Compatibility/migration: no schema or client migration; the feature remains disabled unless the flag is set.
- Security/abuse/trust: Clerk authentication is still checked for every request; guests must present the token used to derive the cache key; active sessions remain scoped to one player and world.
- Performance/operational: memory is capped at 10,000 entries per cache. World-session cache use stops when the membership listener is disconnected. Cache counters share existing request traces.
- Rollback/reversibility: unset `MUDD_IDENTITY_CACHE`; no persisted state or rollback migration is required.

## Verification

- Unit tests cover cache expiry, LRU eviction and bounds, guest-session expiry, claim and migration invalidation, Clerk sign-out, cache-disabled behavior, and world-scoped session invalidation.
- A server-boot integration test verifies warm game snapshots reuse the active world session and membership notifications force a fresh lookup.
- Development traces and the existing test suite are used for before/after validation. Production is not published or mutated as part of this decision.

## Follow-up / revisit trigger

Reconsider the 60-second guest revocation window if guest deletion becomes a frequent user-facing operation or if membership notifications cannot be relied on during cleanup. Enable the cache in production only after development measurements confirm the expected savings.
