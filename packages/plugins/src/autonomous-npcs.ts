import {
  AutonomousNpcTickCommandSchema,
  WorldNpcMovedEventSchema,
  WorldNpcMovementWaitedEventSchema,
  type CapabilityToken,
  type NpcDefinition,
  type WorldPackDraft,
} from '@mudd/contracts';
import type {
  EngineCommandContext,
  EnginePlugin,
  QueryContext,
  StoredGameEvent,
} from '@mudd/engine-core';
import { RuleViolationError } from '@mudd/engine-core';
import { exitsForLocationState } from './location-state.js';

export const AUTONOMOUS_NPC_STREAM_PREFIX = 'world-npc:';
export const MIN_AUTONOMOUS_NPC_MOVEMENT_INTERVAL_MS = 60_000;

export function effectiveAutonomousNpcMovementIntervalMs(authoredIntervalMs: number): number {
  return Math.max(MIN_AUTONOMOUS_NPC_MOVEMENT_INTERVAL_MS, authoredIntervalMs);
}

export function autonomousNpcStreamId(npcId: string): string {
  return `${AUTONOMOUS_NPC_STREAM_PREFIX}${npcId}`;
}

export type NpcLocationContext = Pick<EngineCommandContext | QueryContext, 'worldInstanceId' | 'store' | 'world'>;

export type AutonomousNpcPosition = Readonly<{
  npcId: string;
  locationId: string;
  revision: number;
  lastAttemptAt?: string;
  routeIndex?: number;
}>;

export interface AutonomousNpcStateCapability {
  position(context: NpcLocationContext, npcId: string, initialLocationId: string): Promise<AutonomousNpcPosition>;
  atLocation(context: NpcLocationContext, locationId: string): Promise<readonly NpcDefinition[]>;
}

export const autonomousNpcStateCapability = Object.freeze({
  id: 'mudd.autonomous-npc.state.v1',
  version: '1',
}) satisfies CapabilityToken<AutonomousNpcStateCapability>;

export function mobileNpcDefinitions(world: WorldPackDraft): Array<{
  npc: NpcDefinition;
  initialLocationId: string;
}> {
  return world.locations.flatMap((location) =>
    (location.npcs ?? [])
      .filter((npc) => npc.movement)
      .map((npc) => ({ npc, initialLocationId: location.id })),
  );
}

export function projectAutonomousNpcPosition(
  events: readonly StoredGameEvent[],
  npcId: string,
  initialLocationId: string,
): AutonomousNpcPosition {
  let position: AutonomousNpcPosition = {
    npcId,
    locationId: initialLocationId,
    revision: events.at(-1)?.aggregateVersion ?? 0,
  };

  for (const event of events) {
    if (event.type === 'world.npc.moved' && event.version === 1) {
      const { payload } = WorldNpcMovedEventSchema.parse({
        type: event.type,
        version: event.version,
        payload: event.payload,
      });
      if (payload.npcId !== npcId || payload.fromLocationId !== position.locationId) {
        throw new Error(`NPC ${npcId} movement history is inconsistent.`);
      }
      position = {
        npcId,
        locationId: payload.toLocationId,
        revision: event.aggregateVersion,
        lastAttemptAt: payload.attemptedAt,
        ...(payload.routeIndex === undefined ? {} : { routeIndex: payload.routeIndex }),
      };
    } else if (event.type === 'world.npc.movement_waited' && event.version === 1) {
      const { payload } = WorldNpcMovementWaitedEventSchema.parse({
        type: event.type,
        version: event.version,
        payload: event.payload,
      });
      if (payload.npcId !== npcId || payload.locationId !== position.locationId) {
        throw new Error(`NPC ${npcId} movement history is inconsistent.`);
      }
      position = {
        ...position,
        revision: event.aggregateVersion,
        lastAttemptAt: payload.attemptedAt,
        ...(payload.routeIndex === undefined ? {} : { routeIndex: payload.routeIndex }),
      };
    } else if (event.type.startsWith('world.npc.')) {
      throw new Error(`Unsupported NPC world event version: ${event.type}@${event.version}.`);
    }
  }

  return position;
}

export const autonomousNpcsPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.autonomous-npcs',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    provides: [autonomousNpcStateCapability.id],
    eventSchemaVersions: {
      'world.npc.moved': 1,
      'world.npc.movement_waited': 1,
    },
  },
  register({ registerSystemCommand, provideCapability }) {
    const positionCache = new Map<string, {
      readonly revision: number;
      readonly position: AutonomousNpcPosition;
    }>();
    const projectPosition = (
      worldInstanceId: string,
      npcId: string,
      initialLocationId: string,
      events: readonly StoredGameEvent[],
    ) => {
      const revision = events.at(-1)?.aggregateVersion ?? 0;
      const cacheKey = `${worldInstanceId}\u0000${npcId}`;
      const cached = positionCache.get(cacheKey);
      if (cached?.revision === revision) {
        positionCache.delete(cacheKey);
        positionCache.set(cacheKey, cached);
        return cached.position;
      }

      const position = Object.freeze(projectAutonomousNpcPosition(events, npcId, initialLocationId));
      positionCache.delete(cacheKey);
      positionCache.set(cacheKey, { revision, position });
      while (positionCache.size > 256) {
        const oldestKey = positionCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        positionCache.delete(oldestKey);
      }
      return position;
    };

    const state: AutonomousNpcStateCapability = {
      async position(context, npcId, initialLocationId) {
        const events = await context.store.readStream(
          context.worldInstanceId,
          autonomousNpcStreamId(npcId),
        );
        return projectPosition(context.worldInstanceId, npcId, initialLocationId, events);
      },
      async atLocation(context, locationId) {
        const definitions = context.world.locations.flatMap((location) =>
          (location.npcs ?? []).map((npc) => ({ npc, initialLocationId: location.id })),
        );
        const movingDefinitions = definitions.filter(({ npc }) => npc.movement);
        let positions: AutonomousNpcPosition[];
        if (context.store.readStreams) {
          const histories = await context.store.readStreams(
            context.worldInstanceId,
            movingDefinitions.map(({ npc }) => autonomousNpcStreamId(npc.id)),
          );
          positions = movingDefinitions.map(({ npc, initialLocationId }) =>
            projectPosition(
              context.worldInstanceId,
              npc.id,
              initialLocationId,
              histories.get(autonomousNpcStreamId(npc.id)) ?? [],
            ));
        } else {
          positions = await Promise.all(movingDefinitions
            .map(({ npc, initialLocationId }) => state.position(context, npc.id, initialLocationId)));
        }
        const dynamicLocations = new Map(positions.map((position) => [position.npcId, position.locationId]));
        return definitions
          .filter(({ npc, initialLocationId }) =>
            (dynamicLocations.get(npc.id) ?? initialLocationId) === locationId)
          .map(({ npc }) => npc);
      },
    };
    provideCapability(autonomousNpcStateCapability, state);

    registerSystemCommand(
      'world.npc.tick',
      AutonomousNpcTickCommandSchema,
      async (command, context) => {
        const definition = mobileNpcDefinitions(context.world)
          .find(({ npc }) => npc.id === command.npcId);
        const movement = definition?.npc.movement;
        if (!definition || !movement) throw new RuleViolationError('That NPC has no autonomous movement behavior.');
        const { npc, initialLocationId } = definition;
        const position = await state.position(context, npc.id, initialLocationId);
        if (npc.combatProfile) {
          throw new RuleViolationError('NPCs that can participate in combat cannot wander in this version.');
        }

        const attemptedAt = context.now();
        const movementIntervalMs = effectiveAutonomousNpcMovementIntervalMs(movement.intervalMs);
        if (
          position.lastAttemptAt &&
          attemptedAt.getTime() - Date.parse(position.lastAttemptAt) < movementIntervalMs
        ) {
          throw new RuleViolationError('This NPC is not due to move yet.');
        }

        const currentLocation = context.world.locations.find((location) => location.id === position.locationId);
        if (!currentLocation) throw new RuleViolationError('The NPC is in a location missing from this world.');
        const currentState = currentLocation.defaultStateId;
        const validExits = exitsForLocationState(currentLocation, currentState)
          .filter((exit) => {
            if (exit.requiredInteractionId) return false;
            const destination = context.world.locations.find((location) => location.id === exit.toLocationId);
            return Boolean(destination && !destination.requiredVisitedLocationId);
          });

        let selectedExit = undefined as typeof validExits[number] | undefined;
        let routeIndex: number | undefined;
        if (movement.strategy === 'wander') {
          const allowed = new Set(movement.allowedLocationIds);
          const candidates = validExits.filter((exit) =>
            exit.toLocationId !== position.locationId && allowed.has(exit.toLocationId));
          if (candidates.length && context.rng.roll(100) > movement.stayChancePercent) {
            selectedExit = candidates[context.rng.roll(candidates.length) - 1];
          }
        } else {
          const route = movement.routeLocationIds;
          const currentIndex = position.routeIndex ??
            Math.max(0, route.indexOf(position.locationId));
          const nextIndex = (currentIndex + 1) % route.length;
          const nextLocationId = route[nextIndex]!;
          selectedExit = validExits.find((exit) => exit.toLocationId === nextLocationId);
          routeIndex = selectedExit ? nextIndex : currentIndex;
        }

        if (!selectedExit) {
          const payload = {
            npcId: npc.id,
            locationId: position.locationId,
            attemptedAt: attemptedAt.toISOString(),
            ...(routeIndex === undefined ? {} : { routeIndex }),
          };
          WorldNpcMovementWaitedEventSchema.shape.payload.parse(payload);
          return {
            streamId: autonomousNpcStreamId(npc.id),
            expectedVersion: position.revision,
            events: [{ type: 'world.npc.movement_waited', version: 1, payload }],
          };
        }

        const movedPayload = {
          npcId: npc.id,
          fromLocationId: position.locationId,
          toLocationId: selectedExit.toLocationId,
          exitId: selectedExit.id,
          ...(selectedExit.direction ? { direction: selectedExit.direction } : {}),
          attemptedAt: attemptedAt.toISOString(),
          ...(routeIndex === undefined ? {} : { routeIndex }),
        };
        WorldNpcMovedEventSchema.shape.payload.parse(movedPayload);
        return {
          streamId: autonomousNpcStreamId(npc.id),
          expectedVersion: position.revision,
          events: [{ type: 'world.npc.moved', version: 1, payload: movedPayload }],
        };
      },
    );
  },
};
