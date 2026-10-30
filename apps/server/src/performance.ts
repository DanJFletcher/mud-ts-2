import { AsyncLocalStorage } from 'node:async_hooks';
import { monitorEventLoopDelay } from 'node:perf_hooks';

export type QueryTiming = { fingerprint: string; durationMs: number };
export type DatabaseOperationTiming = {
  operation: string;
  calls: number;
  queries: number;
  queryMs: number;
  maxQueryMs: number;
  poolWaitMs: number;
  maxPoolWaitMs: number;
  elapsedMs: number;
  maxElapsedMs: number;
};
export type Measurements = {
  stages: Record<string, number>;
  queries: number;
  poolWaitMs: number;
  queryMs: number;
  identityCacheHits: number;
  identityCacheMisses: number;
  worldSessionCacheHits: number;
  worldSessionCacheMisses: number;
  /** New physical PostgreSQL connections opened while serving the request. */
  connectionsOpened: number;
  traceId?: string;
  queryTimings: QueryTiming[];
  databaseOperations: Record<string, DatabaseOperationTiming>;
};
type ActiveDatabaseOperation = {
  operation: string;
  queries: number;
  queryMs: number;
  maxQueryMs: number;
  poolWaitMs: number;
  maxPoolWaitMs: number;
};
export type DatabaseMeasurementContext = {
  measurements?: Measurements;
  operation?: ActiveDatabaseOperation;
};
export const requestMeasurements = new AsyncLocalStorage<Measurements>();
const databaseOperation = new AsyncLocalStorage<ActiveDatabaseOperation>();
const MAX_DATABASE_OPERATION_NAMES = 32;
const SAFE_DATABASE_OPERATION_NAMES = new Set([
  'account.guest_session_lookup',
  'account.clerk_profile_lookup',
  'account.profile_ensure',
  'account.guest_profile_migration',
  'account.guest_identity_create',
  'world_session.active_lookup',
  'interaction.recipient_presence_lookup',
  'effect_batch.process_pending',
  'character.ownership_lookup',
  'event_store.stream_revision_lookup',
  'event_store.stream_revisions_lookup',
  'event_store.stream_rows_read',
  'event_store.command_receipt_lookup',
  'event_store.command_append',
  'room_presence.heartbeat_update',
  'room_presence.occupants_lookup',
  'room_presence.active_characters_lookup',
  'room_chat.player_message_submit',
  'room_chat.message_id_lookup',
  'room_chat.effect_message_lookup',
  'room_chat.authorized_history_read',
  'location_group.catalog_read',
]);
export function newMeasurements(traceId?: string): Measurements {
  return {
    stages: {},
    queries: 0,
    poolWaitMs: 0,
    queryMs: 0,
    identityCacheHits: 0,
    identityCacheMisses: 0,
    worldSessionCacheHits: 0,
    worldSessionCacheMisses: 0,
    connectionsOpened: 0,
    traceId,
    queryTimings: [],
    databaseOperations: {},
  };
}

export function recordRequestCacheLookup(cache: 'identity' | 'worldSession', hit: boolean): void {
  const metrics = requestMeasurements.getStore();
  if (!metrics) return;
  const key = cache === 'identity'
    ? hit ? 'identityCacheHits' : 'identityCacheMisses'
    : hit ? 'worldSessionCacheHits' : 'worldSessionCacheMisses';
  metrics[key]++;
}
export async function measureStage<T>(stage: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { return await run(); }
  finally {
    const metrics = requestMeasurements.getStore();
    if (metrics) metrics.stages[stage] = (metrics.stages[stage] ?? 0) + performance.now() - started;
  }
}

export async function measureDatabaseOperation<T>(operation: string, run: () => Promise<T>): Promise<T> {
  if (!SAFE_DATABASE_OPERATION_NAMES.has(operation)) {
    throw new Error('Database operation names must be registered, static labels.');
  }
  const metrics = requestMeasurements.getStore();
  if (!metrics) return run();

  const active: ActiveDatabaseOperation = {
    operation,
    queries: 0,
    queryMs: 0,
    maxQueryMs: 0,
    poolWaitMs: 0,
    maxPoolWaitMs: 0,
  };
  const started = performance.now();
  try {
    return await databaseOperation.run(active, async () => await run());
  } finally {
    if (active.queries > 0 || active.poolWaitMs > 0) {
      const name = metrics.databaseOperations[operation]
        ? operation
        : Object.keys(metrics.databaseOperations).length < MAX_DATABASE_OPERATION_NAMES
          ? operation
          : 'other';
      const summary = metrics.databaseOperations[name] ??= {
        operation: name,
        calls: 0,
        queries: 0,
        queryMs: 0,
        maxQueryMs: 0,
        poolWaitMs: 0,
        maxPoolWaitMs: 0,
        elapsedMs: 0,
        maxElapsedMs: 0,
      };
      const elapsedMs = performance.now() - started;
      summary.calls++;
      summary.queries += active.queries;
      summary.queryMs += active.queryMs;
      summary.maxQueryMs = Math.max(summary.maxQueryMs, active.maxQueryMs);
      summary.poolWaitMs += active.poolWaitMs;
      summary.maxPoolWaitMs = Math.max(summary.maxPoolWaitMs, active.maxPoolWaitMs);
      summary.elapsedMs += elapsedMs;
      summary.maxElapsedMs = Math.max(summary.maxElapsedMs, elapsedMs);
    }
  }
}

export function databaseMeasurementContext(): DatabaseMeasurementContext {
  return {
    measurements: requestMeasurements.getStore(),
    operation: databaseOperation.getStore(),
  };
}

export function recordDatabaseQueryStart(context: DatabaseMeasurementContext): void {
  if (context.measurements) context.measurements.queries++;
  if (context.operation) context.operation.queries++;
}

export function recordDatabaseQueryFinish(
  context: DatabaseMeasurementContext,
  durationMs: number,
  fingerprint?: string,
): void {
  if (context.measurements) {
    context.measurements.queryMs += durationMs;
    if (fingerprint && context.measurements.traceId && context.measurements.queryTimings.length < 100) {
      context.measurements.queryTimings.push({
        fingerprint,
        durationMs: Math.round(durationMs * 10) / 10,
      });
    }
  }
  if (context.operation) {
    context.operation.queryMs += durationMs;
    context.operation.maxQueryMs = Math.max(context.operation.maxQueryMs, durationMs);
  }
}

export function recordDatabaseConnectionOpened(context: DatabaseMeasurementContext): void {
  if (context.measurements) context.measurements.connectionsOpened++;
}

export function recordDatabasePoolWait(context: DatabaseMeasurementContext, durationMs: number): void {
  if (context.measurements) context.measurements.poolWaitMs += durationMs;
  if (context.operation) {
    context.operation.poolWaitMs += durationMs;
    context.operation.maxPoolWaitMs = Math.max(context.operation.maxPoolWaitMs, durationMs);
  }
}

export function formatDatabaseOperationTimings(metrics: Measurements): DatabaseOperationTiming[] {
  const round = (value: number) => Math.round(value * 10) / 10;
  return Object.values(metrics.databaseOperations)
    .sort((a, b) => b.queryMs - a.queryMs || b.poolWaitMs - a.poolWaitMs)
    .map((operation) => ({
      ...operation,
      queryMs: round(operation.queryMs),
      maxQueryMs: round(operation.maxQueryMs),
      poolWaitMs: round(operation.poolWaitMs),
      maxPoolWaitMs: round(operation.maxPoolWaitMs),
      elapsedMs: round(operation.elapsedMs),
      maxElapsedMs: round(operation.maxElapsedMs),
    }));
}

const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
const reset = setInterval(() => loop.reset(), 60_000);
reset.unref();
export function eventLoopDelayMs() {
  return { p95: Math.round(loop.percentile(95) / 1e6), max: Math.round(loop.max / 1e6) };
}
