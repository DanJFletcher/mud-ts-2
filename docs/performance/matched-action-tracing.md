# Matched gameplay action trace

Use this opt-in trace to compare one movement action in development and production.
It follows the movement command, the authoritative movement projection returned
with it (or a full-snapshot fallback), and the browser's next paint opportunity.
It does not change gameplay behavior.

## Collect a trace

1. Open the game page with `?muddTrace=1` at the end of its URL. If the URL already
   has a query string, append `&muddTrace=1`.
2. Open the browser developer console and perform one ordinary room movement.
3. In the browser console, save the `[mudd_perf_trace_request]` command record
   and `[mudd_perf_trace_action]` record. They share a `traceId`. A normal move
   should not issue a second `snapshot` request; if the compact projection is
   unavailable, the action logs `projectionSource: "snapshot-fallback"` and a
   snapshot request will appear.
4. In the server logs, find the `mudd_traced_http_request` command record with
   that `traceId`. Match its `requestId` to `serverRequestId` in the browser
   request record. The command log now includes the `movementProjection` stage.
5. Repeat the same kind of movement in development and production under similar
   browser/network conditions, then compare the timings.
6. Remove `muddTrace=1` from the URL to stop collecting traces.

## Reading the measurements

- `fetchToHeadersMs` includes browser-to-server transport, server handling, and
  response-header return time.
- Server `durationMs` measures time inside the Express request pipeline.
- `poolWaitMs` is accumulated PostgreSQL connection acquisition time.
- `queryMs` is accumulated PostgreSQL driver query time. Individual traced query
  durations are in `queryTimings`; each has a short SHA-256 fingerprint so query
  shapes can be grouped without logging SQL text or parameter values.
- `bodyReadMs` includes reading and parsing the response body.
- `schemaValidationMs` measures client SDK response validation.
- `commandAndProjectionMs` spans movement through the authoritative projection
  being applied to React state. `projectionSource` distinguishes the compact
  command response from the full-snapshot fallback. `projectionToPaintMs` and `actionToPaintMs` use two
  animation-frame callbacks as an approximation of when the browser can display
  the updated room; they are not a browser rendering profiler.

Only explicitly traced movement command/snapshot requests receive per-query
fingerprints and detailed server logs. Normal sessions continue to produce only
the existing slow-request logs.
