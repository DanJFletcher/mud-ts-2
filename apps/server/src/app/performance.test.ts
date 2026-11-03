import { describe, expect, it } from 'vitest';
import {
  databaseMeasurementContext,
  eventLoopDelayMs,
  formatDatabaseOperationTimings,
  measureDatabaseOperation,
  newMeasurements,
  recordDatabasePoolWait,
  recordDatabaseQueryFinish,
  recordDatabaseQueryStart,
  requestMeasurements,
} from './performance.js';

describe('database operation measurements', () => {
  it('keeps operation labels isolated across concurrent database work', async () => {
    const measurements = newMeasurements();
    measurements.traceId = 'trace-performance-test';
    await requestMeasurements.run(measurements, async () => {
      await Promise.all([
        measureDatabaseOperation('account.clerk_profile_lookup', async () => {
          const context = databaseMeasurementContext();
          recordDatabaseQueryStart(context);
          recordDatabaseQueryFinish(context, 12.34, 'select-account');
          recordDatabasePoolWait(context, 2.1);
        }),
        measureDatabaseOperation('room_chat.authorized_history_read', async () => {
          const context = databaseMeasurementContext();
          recordDatabaseQueryStart(context);
          recordDatabaseQueryFinish(context, 4.56);
          recordDatabasePoolWait(context, 0.7);
        }),
      ]);
    });

    expect(measurements.queries).toBe(2);
    expect(measurements.databaseOperations['account.clerk_profile_lookup']).toMatchObject({
      calls: 1,
      queries: 1,
      queryMs: 12.34,
      maxQueryMs: 12.34,
      poolWaitMs: 2.1,
      maxPoolWaitMs: 2.1,
    });
    expect(measurements.databaseOperations['room_chat.authorized_history_read']).toMatchObject({
      calls: 1,
      queries: 1,
      queryMs: 4.56,
      maxQueryMs: 4.56,
      poolWaitMs: 0.7,
      maxPoolWaitMs: 0.7,
    });
    expect(measurements.queryTimings).toEqual([{ fingerprint: 'select-account', durationMs: 12.3 }]);
  });

  it('aggregates repeated calls by static operation name for compact logs', async () => {
    const measurements = newMeasurements();
    await requestMeasurements.run(measurements, async () => {
      for (const duration of [3, 9]) {
        await measureDatabaseOperation('event_store.stream_revision_lookup', async () => {
          const context = databaseMeasurementContext();
          recordDatabaseQueryStart(context);
          recordDatabaseQueryFinish(context, duration);
        });
      }
    });

    expect(formatDatabaseOperationTimings(measurements)).toMatchObject([{
      operation: 'event_store.stream_revision_lookup',
      calls: 2,
      queries: 2,
      queryMs: 12,
      maxQueryMs: 9,
    }]);
  });

  it('keeps lazy database query thenables inside their operation measurement context', async () => {
    const measurements = newMeasurements();
    await requestMeasurements.run(measurements, async () => {
      await measureDatabaseOperation('room_presence.heartbeat_update', () => ({
        then(resolve: (value: void) => void) {
          const context = databaseMeasurementContext();
          recordDatabaseQueryStart(context);
          recordDatabaseQueryFinish(context, 2.5);
          resolve();
        },
      }) as unknown as Promise<void>);
    });

    expect(measurements.databaseOperations['room_presence.heartbeat_update']).toMatchObject({
      calls: 1,
      queries: 1,
      queryMs: 2.5,
      maxQueryMs: 2.5,
    });
  });

  it('rejects operation labels that could contain request-specific data', async () => {
    const measurements = newMeasurements();
    await requestMeasurements.run(measurements, async () => {
      await expect(measureDatabaseOperation('account.user-123', async () => undefined))
        .rejects.toThrow('Database operation names must be registered, static labels.');
    });
  });

  it('uses pool wait as the tie-breaker when operation query times are equal', async () => {
    const measurements = newMeasurements();
    await requestMeasurements.run(measurements, async () => {
      await measureDatabaseOperation('account.clerk_profile_lookup', async () => {
        const context = databaseMeasurementContext();
        recordDatabaseQueryFinish(context, 5);
        recordDatabasePoolWait(context, 1);
      });
      await measureDatabaseOperation('room_chat.authorized_history_read', async () => {
        const context = databaseMeasurementContext();
        recordDatabaseQueryFinish(context, 5);
        recordDatabasePoolWait(context, 2);
      });
    });

    expect(formatDatabaseOperationTimings(measurements).map(({ operation }) => operation)).toEqual([
      'room_chat.authorized_history_read',
      'account.clerk_profile_lookup',
    ]);
  });

  it('returns event-loop delay readings as milliseconds', () => {
    const delay = eventLoopDelayMs();

    expect(typeof delay.p95).toBe('number');
    expect(typeof delay.max).toBe('number');
  });
});
