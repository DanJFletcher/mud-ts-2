# Optimistic action feedback: implementation and measurements

Captured 2026-10-25. This change improves perceived responsiveness; it does not
make server commands complete faster or change who owns game state.

## Scope and baseline

The baseline was captured before implementation with the workspace build and
tests. The browser had no first-feedback timing trace for chat, movement, or PvP.
The UI waited for the chat POST before showing a sent message, and movement/PvP
did not show a dedicated pending-action status. Movement refreshed the
authoritative game snapshot before presenting the resulting room.

| Measure | Before |
| --- | ---: |
| Web entry JavaScript | 1,073.08 kB minified / 294.10 kB gzip |
| Web CSS | 112.30 kB minified / 20.47 kB gzip |
| Typecheck | Pass |
| Client SDK tests | 49 pass, 1 stale NPC-projection expectation failed |
| Web tests | 120 pass, 1 stale movement-timer expectation failed |
| Lint | 9 existing errors |

No matched guest-session browser action traces were captured as part of that
baseline, so there is no defensible before latency percentile to compare.

## Architecture and behavior

- `@mudd/client-sdk` owns a framework-neutral, bounded `PendingActionCoordinator`.
  Actions are scoped by world and character, with room scope for chat/movement;
  old entries expire and the collection has a maximum size. React subscribes to
  this state and only renders it.
- HTTP remains authoritative for commands and snapshots. Existing WebSocket
  invalidations and polling continue to trigger recovery; this change adds no
  WebSocket transport or protocol.
- Chat renders a local pending message immediately, without advancing the
  server cursor. It uses the same `clientMessageId` for retries and reconciles
  against history. The chat history response includes that submission ID only
  for the authoring character; NPC and other-player messages do not expose it.
- Movement displays intent but does not predict the destination or change the
  room projection. It confirms only when an authoritative snapshot shows the
  character in a different location. Ambiguous retries reuse the command ID.
- PvP challenge and response actions show pending/uncertain status and are
  confirmed only by matching authoritative interaction-inbox state. They use
  caller-provided, stable command IDs, including when the player repeats an
  uncertain action.
- Explicit command rejections are shown as errors. A network failure or server
  5xx is treated as uncertain rather than as proof the command failed. Repeating
  the same action reuses its ID. No combat, destination, or chat outcome is
  speculated.
- `ActionRefreshGate`, event ordering, chat history cursors, command schemas,
  and world/character isolation remain in place.

## After measurements

Automated deferred-response tests verified that:

- Chat feedback is present while the POST is deliberately unresolved.
- A confirmed chat history entry replaces the pending bubble once, with no
  duplicate and no local cursor advancement.
- Movement feedback appears while the command is unresolved, while the visible
  room remains unchanged until the server snapshot arrives.
- A repeated ambiguous movement sends the same command ID.
- PvP request/response SDK calls preserve their supplied command IDs.

With `?muddTrace=1`, chat, movement, and PvP now emit
`[mudd_perf_trace_feedback]` records containing
`actionToFirstFeedbackPaintMs`. Movement also retains the existing matched
command/snapshot/paint trace. Two animation frames approximate the first paint
opportunity; this is not a browser rendering profiler. No live browser trace
was collected here, so actual P50/P95 feedback or server latency remains
unmeasured.

| Measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| Web entry JavaScript | 1,073.08 kB / 294.10 kB gzip | 1,086.48 kB / 297.35 kB gzip | +13.40 kB / +3.25 kB gzip |
| Web CSS | 112.30 kB / 20.47 kB gzip | 114.24 kB / 20.80 kB gzip | +1.94 kB / +0.33 kB gzip |
| PWA precache | 1,159.55 KiB | 1,174.53 KiB | +14.98 KiB |

The build succeeds, but the main JavaScript chunk remains above Vite’s 500 kB
warning threshold. This task did not perform route splitting or lazy-load
changes.

## Verification

- `npm run typecheck`: passed across all workspaces.
- `npm run build`: passed.
- Client SDK: 56 tests passed.
- Web: 127 tests passed.
- UI: 28 tests passed.
- Contracts: 34 tests passed; engine core: 64 passed; core plugins: 18 passed.
- Server integration cases for PostgreSQL were skipped by the test environment;
  the new author-history correlation assertion is present but was not executed.
- The complete root test command remains blocked by unrelated server test
  failures: a Vitest mock missing `PartyListQuerySchema`, and daily-job fixture
  expectations that do not match the current Bellwold supply sources.
- Lint still reports 7 errors in untouched database/plugin/DailyBoard files,
  plus existing warnings. No lint errors were reported in the changed files.

## Remaining limits

This reduces the time until players see feedback, not the time until the server
commits or projects a command. The coordinator is in-memory and scoped to the
current page lifetime; recovery after a socket reconnect uses the existing
snapshot/history/inbox refresh paths, while a full page reload does not restore
an unresolved client command ID. Production latency and cross-environment
percentiles still need matched `muddTrace=1` runs.
