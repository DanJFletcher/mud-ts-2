import { z } from 'zod';
import {
  type CapabilityToken,
  type LocationProjection,
} from '@mudd/contracts';
import {
  replayCharacter,
  RuleViolationError,
  SYSTEM_ACTOR_ID,
  type EnginePlugin,
  type EngineCommandContext,
  type EventEffectContext,
  type QueryContext,
  type StoredGameEvent,
} from '@mudd/engine-core';
import {
  objectLifecycleStateCapability,
  type ObjectLifecycleStateCapability,
  objectLifecycleCancelledEvent,
  objectLifecycleExpiredEvent,
  objectLifecycleScheduledEvent,
  objectLifecycleStreamId,
  projectObjectLifecycle,
} from './object-lifecycle.js';
import { roomAnnouncementEffect } from './room-announcements.js';

export const TEMPORARY_CAMPFIRES_STREAM_ID = 'world-temporary-campfires';
export const CAMPFIRE_LIFETIME_MS = 10 * 60_000;

export type TemporaryCampfireRoomObject = LocationProjection['objects'][number];

export interface TemporaryCampfiresCapability {
  atLocations(
    context: EngineCommandContext | QueryContext,
    locationIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly TemporaryCampfireRoomObject[]>>;
}

export const temporaryCampfiresCapability = Object.freeze({
  id: 'mudd.temporary-campfires.rooms.v1',
  version: '1',
}) satisfies CapabilityToken<TemporaryCampfiresCapability>;

const LightCampfireCommandSchema = z.object({
  type: z.literal('campfire.light'),
  version: z.literal(1),
  commandId: z.string().min(1).max(128),
  worldInstanceId: z.string().min(1).max(128),
  characterId: z.string().min(1).max(128),
  expectedVersion: z.number().int().nonnegative(),
  payload: z.object({}).strict(),
}).strict();

const ExtinguishCampfireCommandSchema = z.object({
  type: z.literal('campfire.extinguish'),
  version: z.literal(1),
  commandId: z.string().min(1).max(128),
  worldInstanceId: z.string().min(1).max(128),
  characterId: z.string().min(1).max(128),
  expectedVersion: z.number().int().nonnegative(),
  payload: z.object({ campfireId: z.string().min(1).max(128) }).strict(),
}).strict();

const CampfireLitPayloadSchema = z.object({
  campfireId: z.string().min(1).max(128),
  locationId: z.string().min(1).max(128),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

const CampfireExtinguishedPayloadSchema = z.object({
  campfireId: z.string().min(1).max(128),
  locationId: z.string().min(1).max(128),
  extinguishedAt: z.string().datetime({ offset: true }),
}).strict();

const ObjectExpiringPayloadSchema = z.object({
  objectId: z.string().min(1).max(128),
  objectType: z.string().min(1).max(80),
  locationId: z.string().min(1).max(128),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

type Campfire = {
  campfireId: string;
  locationId: string;
  createdAt: string;
  expiresAt: string;
  revision: number;
  extinguished: boolean;
};

export function projectTemporaryCampfires(events: readonly StoredGameEvent[]): Campfire[] {
  const campfires = new Map<string, Campfire>();
  for (const event of events) {
    if (event.type === 'world.campfire_lit') {
      const payload = CampfireLitPayloadSchema.parse(event.payload);
      if (campfires.has(payload.campfireId)) {
        throw new Error(`Campfire ${payload.campfireId} was lit more than once.`);
      }
      campfires.set(payload.campfireId, {
        ...payload,
        revision: event.aggregateVersion,
        extinguished: false,
      });
    } else if (event.type === 'world.campfire_extinguished') {
      const payload = CampfireExtinguishedPayloadSchema.parse(event.payload);
      const campfire = campfires.get(payload.campfireId);
      if (!campfire || campfire.locationId !== payload.locationId || campfire.extinguished) {
        throw new Error(`Invalid campfire extinction at revision ${event.aggregateVersion}.`);
      }
      campfires.set(payload.campfireId, {
        ...campfire,
        revision: event.aggregateVersion,
        extinguished: true,
      });
    }
  }
  return [...campfires.values()];
}

async function expireCampfire(
  payload: z.infer<typeof ObjectExpiringPayloadSchema>,
  context: EventEffectContext,
) {
  if (payload.objectType !== 'campfire') return;

  const lifecycleStreamIdValue = objectLifecycleStreamId(payload.objectId);
  const lifecycleEvents = await context.store.readStream(context.worldInstanceId, lifecycleStreamIdValue);
  const lifecycle = projectObjectLifecycle(lifecycleEvents);
  if (
    !lifecycle ||
    lifecycle.state !== 'expiring' ||
    lifecycle.expiresAt !== payload.expiresAt ||
    lifecycle.objectType !== 'campfire'
  ) return;

  const campfireEvents = await context.store.readStream(
    context.worldInstanceId,
    TEMPORARY_CAMPFIRES_STREAM_ID,
  );
  const campfire = projectTemporaryCampfires(campfireEvents)
    .find((item) => item.campfireId === payload.objectId);
  const expiredAt = context.now().toISOString();
  const lifecycleExpired = objectLifecycleExpiredEvent({
    objectId: payload.objectId,
    objectType: 'campfire',
    locationId: lifecycle.locationId,
    expiredAt,
  });

  if (!campfire || campfire.extinguished) {
    const result = await context.store.append({
      worldInstanceId: context.worldInstanceId,
      streamId: lifecycleStreamIdValue,
      actorId: SYSTEM_ACTOR_ID,
      commandId: `campfire-expire-missing:${context.effectId}`,
      payloadHash: `${payload.objectId}:${payload.expiresAt}:missing`,
      expectedVersion: lifecycle.revision,
      events: [lifecycleExpired],
    });
    if (!result.receipt.ok) throw new Error('Could not finalize the missing campfire lifecycle.');
    return;
  }

  const result = await context.store.append({
    worldInstanceId: context.worldInstanceId,
    streamId: TEMPORARY_CAMPFIRES_STREAM_ID,
    actorId: SYSTEM_ACTOR_ID,
    commandId: `campfire-expire:${context.effectId}`,
    payloadHash: `${payload.objectId}:${payload.expiresAt}`,
    expectedVersion: campfire.revision,
    events: [{
      type: 'world.campfire_extinguished',
      version: 1,
      payload: {
        campfireId: campfire.campfireId,
        locationId: campfire.locationId,
        extinguishedAt: expiredAt,
      },
    }],
    companions: [{
      streamId: lifecycleStreamIdValue,
      expectedVersion: lifecycle.revision,
      events: [lifecycleExpired],
    }],
    effects: [roomAnnouncementEffect(
      campfire.locationId,
      'The campfire burns down to embers and goes dark.',
    )],
  });
  if (!result.receipt.ok) throw new Error('Could not atomically extinguish the campfire.');
}

export const temporaryCampfiresPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.temporary-campfires',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
    requires: ['mudd.object-lifecycle.state.v1'],
    provides: [temporaryCampfiresCapability.id],
    eventSchemaVersions: {
      'world.campfire_lit': 1,
      'world.campfire_extinguished': 1,
      'world.object_expiring': 1,
    },
  },
  register({
    registerCommand,
    registerEventHandler,
    provideCapability,
    requireCapability,
  }) {
    const lifecycles = requireCapability<ObjectLifecycleStateCapability>(objectLifecycleStateCapability);
    const capability: TemporaryCampfiresCapability = {
      async atLocations(context, locationIds) {
        const requested = new Set(locationIds);
        if (requested.size === 0) return new Map();
        const history = await context.store.readStream(context.worldInstanceId, TEMPORARY_CAMPFIRES_STREAM_ID);
        const cutoff = context.now().getTime();
        const byLocation = new Map<string, TemporaryCampfireRoomObject[]>();
        const campfires = projectTemporaryCampfires(history).filter((campfire) =>
          !campfire.extinguished && requested.has(campfire.locationId));
        const lifecycleStates = await Promise.all(campfires.map((campfire) =>
          lifecycles.load(context, campfire.campfireId)));
        for (const [index, campfire] of campfires.entries()) {
          const lifecycle = lifecycleStates[index];
          if (!lifecycle || lifecycle.state === 'expired' || lifecycle.state === 'expiring') continue;
          if (lifecycle.state === 'scheduled' && Date.parse(lifecycle.expiresAt) <= cutoff) continue;
          const objects = byLocation.get(campfire.locationId) ?? [];
          objects.push({
            id: campfire.campfireId,
            label: 'Campfire',
            description: 'A small campfire crackles, warming the clearing.',
            readable: false,
            takeable: false,
          });
          byLocation.set(campfire.locationId, objects);
        }
        return byLocation;
      },
    };
    provideCapability(temporaryCampfiresCapability, capability);

    registerCommand('campfire.light', LightCampfireCommandSchema, async (command, context) => {
      const character = replayCharacter(
        await context.store.readStream(context.worldInstanceId, command.characterId),
      );
      if (!character || character.archived) {
        throw new RuleViolationError('That character is no longer available.');
      }
      if (!context.world.locations.some(({ id }) => id === character.locationId)) {
        throw new Error('The character location is not present in this world version.');
      }

      const campfireId = context.makeId();
      const createdAt = context.now();
      const expiresAt = new Date(createdAt.getTime() + CAMPFIRE_LIFETIME_MS);
      const history = await context.store.readStream(context.worldInstanceId, TEMPORARY_CAMPFIRES_STREAM_ID);
      const lifecycle = objectLifecycleScheduledEvent({
        objectId: campfireId,
        objectType: 'campfire',
        locationId: character.locationId,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      return {
        streamId: TEMPORARY_CAMPFIRES_STREAM_ID,
        expectedVersion: history.at(-1)?.aggregateVersion ?? 0,
        guards: [{ streamId: character.characterId, expectedVersion: character.revision }],
        events: [{
          type: 'world.campfire_lit',
          version: 1,
          payload: CampfireLitPayloadSchema.parse({
            campfireId,
            locationId: character.locationId,
            createdAt: createdAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
          }),
        }],
        companions: [{
          streamId: objectLifecycleStreamId(campfireId),
          expectedVersion: 0,
          events: [lifecycle],
        }],
        effects: [roomAnnouncementEffect(
          character.locationId,
          'A small campfire catches and begins to crackle.',
        )],
      };
    });

    registerCommand('campfire.extinguish', ExtinguishCampfireCommandSchema, async (command, context) => {
      const character = replayCharacter(
        await context.store.readStream(context.worldInstanceId, command.characterId),
      );
      if (!character || character.archived) {
        throw new RuleViolationError('That character is no longer available.');
      }

      const campfireHistory = await context.store.readStream(
        context.worldInstanceId,
        TEMPORARY_CAMPFIRES_STREAM_ID,
      );
      const campfire = projectTemporaryCampfires(campfireHistory)
        .find((item) => item.campfireId === command.payload.campfireId);
      if (!campfire || campfire.extinguished || campfire.locationId !== character.locationId) {
        throw new RuleViolationError('There is no burning campfire in this room.');
      }

      const lifecycleStream = objectLifecycleStreamId(campfire.campfireId);
      const lifecycle = await lifecycles.load(context, campfire.campfireId);
      if (
        !lifecycle ||
        lifecycle.objectType !== 'campfire' ||
        lifecycle.locationId !== character.locationId ||
        (lifecycle.state !== 'scheduled' && lifecycle.state !== 'expiring')
      ) {
        throw new RuleViolationError('That campfire is no longer burning.');
      }

      const extinguishedAt = context.now().toISOString();
      return {
        streamId: TEMPORARY_CAMPFIRES_STREAM_ID,
        expectedVersion: campfireHistory.at(-1)?.aggregateVersion ?? 0,
        guards: [{ streamId: character.characterId, expectedVersion: command.expectedVersion }],
        events: [{
          type: 'world.campfire_extinguished',
          version: 1,
          payload: CampfireExtinguishedPayloadSchema.parse({
            campfireId: campfire.campfireId,
            locationId: campfire.locationId,
            extinguishedAt,
          }),
        }],
        companions: [{
          streamId: lifecycleStream,
          expectedVersion: lifecycle.revision,
          events: [objectLifecycleCancelledEvent({
            objectId: campfire.campfireId,
            objectType: 'campfire',
            locationId: campfire.locationId,
          })],
        }],
        effects: [roomAnnouncementEffect(
          campfire.locationId,
          'The campfire is extinguished, leaving a bed of dark ash.',
        )],
      };
    });

    registerEventHandler(
      'world.object_expiring',
      1,
      ObjectExpiringPayloadSchema,
      expireCampfire,
    );
  },
};
