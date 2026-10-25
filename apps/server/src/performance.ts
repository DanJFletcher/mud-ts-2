import { AsyncLocalStorage } from 'node:async_hooks';
import { monitorEventLoopDelay } from 'node:perf_hooks';

export type QueryTiming = { fingerprint: string; durationMs: number };
export type Measurements = {
  stages: Record<string, number>;
  queries: number;
  poolWaitMs: number;
  queryMs: number;
  traceId?: string;
  queryTimings: QueryTiming[];
};
export const requestMeasurements = new AsyncLocalStorage<Measurements>();
export function newMeasurements(traceId?: string): Measurements {
  return { stages: {}, queries: 0, poolWaitMs: 0, queryMs: 0, traceId, queryTimings: [] };
}
export async function measureStage<T>(stage: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { return await run(); }
  finally {
    const metrics = requestMeasurements.getStore();
    if (metrics) metrics.stages[stage] = (metrics.stages[stage] ?? 0) + performance.now() - started;
  }
}
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
const reset = setInterval(() => loop.reset(), 60_000);
reset.unref();
export function eventLoopDelayMs() {
  return { p95: Math.round(loop.percentile(95) / 1e6), max: Math.round(loop.max / 1e6) };
}
