import { describe, expect, it } from 'vitest';
import {
  databaseMeasurementContext,
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
    await requestMeasurements.run(measurements, async () => {
      await Promise.all([
        measureDatabaseOperation('account.clerk_profile_lookup', async () => {
          const context = databaseMeasurementContext();
          recordDatabaseQueryStart(context);
          recordDatabaseQueryFinish(context, 12.34);
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

  it('rejects operation labels that could contain request-specific data', async () => {
    const measurements = newMeasurements();
    await requestMeasurements.run(measurements, async () => {
      await expect(measureDatabaseOperation('account.user-123', async () => undefined))
        .rejects.toThrow('Database operation names must be registered, static labels.');
    });
  });
});
