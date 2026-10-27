import { z } from 'zod';
import {
  ObjectExpiredEventSchema,
  ObjectExpiringEventSchema,
  ObjectLifecycleCancelledEventSchema,
  ObjectLifecycleProjectionSchema,
  ObjectLifecycleRescheduledEventSchema,
  ObjectLifecycleScheduledEventSchema,
  type ObjectLifecycleProjection,
} from '@mudd/contracts';
import {
  RuleViolationError,
  SYSTEM_ACTOR_ID,
  type EngineCommandContext,
  type EnginePlugin,
  type QueryContext,
  type StoredGameEvent,
} from '@mudd/engine-core';

export const OBJECT_LIFECYCLE_STREAM_PREFIX = 'world-object-lifecycle:';
export const objectLifecycleStreamId = (objectId: string) =>
  `${OBJECT_LIFECYCLE_STREAM_PREFIX}${objectId}`;

export const objectLifecycleStateCapability = Object.freeze({
  id: 'mudd.object-lifecycle.state.v1',
  version: '1',
});

export interface ObjectLifecycleStateCapability {
  load(
    context: EngineCommandContext | QueryContext,
    objectId: string,
  ): Promise<ObjectLifecycleProjection | undefined>;
}

type LifecycleEvent = {
  type: string;
  version: number;
  payload: Record<string, unknown>;
};

export function projectObjectLifecycle(
  events: readonly StoredGameEvent[],
): ObjectLifecycleProjection | undefined {
  let lifecycle: ObjectLifecycleProjection | undefined;
  for (const event of events) {
    const raw = { ...event, payload: event.payload } as LifecycleEvent;
    if (event.type === 'world.object_lifecycle_scheduled') {
      const payload = ObjectLifecycleScheduledEventSchema.parse(raw).payload;
      lifecycle = ObjectLifecycleProjectionSchema.parse({
        ...payload,
        state: 'scheduled',
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'world.object_lifecycle_rescheduled') {
      const payload = ObjectLifecycleRescheduledEventSchema.parse(raw).payload;
      if (!lifecycle || lifecycle.objectId !== payload.objectId) {
        throw new Error(`Lifecycle reschedule without a scheduled object at revision ${event.aggregateVersion}.`);
      }
      lifecycle = ObjectLifecycleProjectionSchema.parse({
        ...lifecycle,
        ...payload,
        state: 'scheduled',
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'world.object_lifecycle_cancelled') {
      const payload = ObjectLifecycleCancelledEventSchema.parse(raw).payload;
      if (!lifecycle || lifecycle.objectId !== payload.objectId) {
        throw new Error(`Lifecycle cancellation without a scheduled object at revision ${event.aggregateVersion}.`);
      }
      lifecycle = ObjectLifecycleProjectionSchema.parse({
        ...lifecycle,
        ...payload,
        state: 'cancelled',
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'world.object_expiring') {
      const payload = ObjectExpiringEventSchema.parse(raw).payload;
      if (!lifecycle || lifecycle.objectId !== payload.objectId ||
          lifecycle.state === 'expired' || lifecycle.state === 'cancelled') {
        throw new Error(`Invalid object-expiring transition at revision ${event.aggregateVersion}.`);
      }
      lifecycle = ObjectLifecycleProjectionSchema.parse({
        ...lifecycle,
        state: 'expiring',
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'world.object_expired') {
      const payload = ObjectExpiredEventSchema.parse(raw).payload;
      if (!lifecycle || lifecycle.objectId !== payload.objectId ||
          lifecycle.state === 'expired' || lifecycle.state === 'cancelled') {
        throw new Error(`Invalid object-expired transition at revision ${event.aggregateVersion}.`);
      }
      lifecycle = ObjectLifecycleProjectionSchema.parse({
        ...lifecycle,
        locationId: payload.locationId,
        state: 'expired',
        revision: event.aggregateVersion,
      });
    }
  }
  return lifecycle;
}

export function objectLifecycleScheduledEvent(
  payload: z.infer<typeof ObjectLifecycleScheduledEventSchema>['payload'],
) {
  return {
    type: 'world.object_lifecycle_scheduled',
    version: 1,
    payload: ObjectLifecycleScheduledEventSchema.shape.payload.parse(payload),
  };
}

export function objectLifecycleExpiredEvent(
  payload: z.infer<typeof ObjectExpiredEventSchema>['payload'],
) {
  return {
    type: 'world.object_expired',
    version: 1,
    payload: ObjectExpiredEventSchema.shape.payload.parse(payload),
  };
}

const ExpireObjectCommandSchema = z.object({
  type: z.literal('world.object.expire'),
  version: z.literal(1),
  commandId: z.string().min(1).max(128),
  worldInstanceId: z.string().min(1).max(128),
  expectedVersion: z.number().int().nonnegative(),
  payload: z.object({ objectId: z.string().min(1).max(128) }).strict(),
}).strict();

export const objectLifecyclePlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.object-lifecycle',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    provides: [objectLifecycleStateCapability.id],
    eventSchemaVersions: {
      'world.object_lifecycle_scheduled': 1,
      'world.object_lifecycle_rescheduled': 1,
      'world.object_lifecycle_cancelled': 1,
      'world.object_expiring': 1,
      'world.object_expired': 1,
    },
  },
  register({ registerSystemCommand, provideCapability }) {
    provideCapability(
      objectLifecycleStateCapability,
      {
        async load(context, objectId) {
          const events = await context.store.readStream(
            context.worldInstanceId,
            objectLifecycleStreamId(objectId),
          );
          return projectObjectLifecycle(events);
        },
      } satisfies ObjectLifecycleStateCapability,
    );

    registerSystemCommand(
      'world.object.expire',
      ExpireObjectCommandSchema,
      async (command, context) => {
        const streamId = objectLifecycleStreamId(command.payload.objectId);
        const history = await context.store.readStream(context.worldInstanceId, streamId);
        const lifecycle = projectObjectLifecycle(history);
        if (!lifecycle || lifecycle.state === 'cancelled' || lifecycle.state === 'expired') {
          throw new RuleViolationError('That object is no longer scheduled to expire.');
        }
        if (Date.parse(lifecycle.expiresAt) > context.now().getTime()) {
          throw new RuleViolationError('That object is not due to expire yet.');
        }
        return {
          streamId,
          expectedVersion: command.expectedVersion,
          events: [{
            type: 'world.object_expiring',
            version: 1,
            payload: {
              objectId: lifecycle.objectId,
              objectType: lifecycle.objectType,
              locationId: lifecycle.locationId,
              expiresAt: lifecycle.expiresAt,
            },
          }],
        };
      },
    );
  },
};

export function objectLifecycleSystemActorId(): string {
  return SYSTEM_ACTOR_ID;
}
