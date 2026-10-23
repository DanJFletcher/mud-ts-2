import {
  InteractionRequestCommandSchema,
  InteractionRequestProjectionSchema,
  InteractionRespondCommandSchema,
  type InteractionRequestProjection,
} from '@mudd/contracts';
import type {
  EngineCommandContext,
  EventStorePort,
  EnginePlugin,
  ProposedDomainEvent,
} from '@mudd/engine-core';
import { RuleViolationError, SYSTEM_ACTOR_ID } from '@mudd/engine-core';
import type { CapabilityToken } from '@mudd/contracts';

const REQUEST_TTL_MS = 60_000;
const REQUESTS_PER_MINUTE = 5;
const MAX_PENDING_REQUESTS = 3;
const INTERACTION_STREAM_PREFIX = 'world-interactions:';

export const interactionStreamId = (worldInstanceId: string) =>
  `${INTERACTION_STREAM_PREFIX}${worldInstanceId}`;

export interface InteractionRequestPolicy {
  prepareRequest(
    request: {
      initiatorCharacterId: string;
      recipientCharacterId: string;
    },
    context: EngineCommandContext,
  ): Promise<{ initiatorName: string; recipientName: string }>;
  prepareAcceptance(
    request: InteractionRequestProjection,
    context: EngineCommandContext,
  ): Promise<readonly ProposedDomainEvent[]>;
}

export interface InteractionPolicyRegistry {
  register(kind: string, policy: InteractionRequestPolicy): void;
}

export const interactionPolicyRegistry = Object.freeze({
  id: 'mudd.interactions.policy-registry.v1',
  version: '1',
}) satisfies CapabilityToken<InteractionPolicyRegistry>;

type InteractionRecord = {
  requests: InteractionRequestProjection[];
  latestEncounterEvent?: { type: string; payload: Record<string, unknown> };
};

export function projectInteractionEvents(
  events: readonly { type: string; payload: Readonly<Record<string, unknown>> }[],
): InteractionRecord {
  const requests = new Map<string, InteractionRequestProjection>();
  let latestEncounterEvent: InteractionRecord['latestEncounterEvent'];
  for (const event of events) {
    if (event.type === 'interaction.request.created' || event.type === 'interaction.request.updated') {
      const parsed = InteractionRequestProjectionSchema.safeParse(event.payload.request);
      if (parsed.success) requests.set(parsed.data.requestId, parsed.data);
    } else if (
      event.type === 'pvp.encounter.started' ||
      event.type === 'pvp.action.resolved' ||
      event.type === 'pvp.outcome.applied'
    ) {
      latestEncounterEvent = { type: event.type, payload: event.payload };
    }
  }
  return { requests: [...requests.values()], latestEncounterEvent };
}

export async function updateInteractionRequestStatus(
  store: EventStorePort,
  worldInstanceId: string,
  requestId: string,
  status: 'expired' | 'cancelled',
): Promise<boolean> {
  const streamId = interactionStreamId(worldInstanceId);
  const commandId = `interaction-${status}:${requestId}`;
  const payloadHash = `${commandId}:v1`;
  if (await store.lookupCommand(worldInstanceId, SYSTEM_ACTOR_ID, commandId, payloadHash)) return true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const events = await store.readStream(worldInstanceId, streamId);
    const request = projectInteractionEvents(events).requests.find((candidate) => candidate.requestId === requestId);
    if (!request || request.status !== 'pending') return false;
    const updated = { ...request, status };
    const result = await store.append({
      worldInstanceId,
      streamId,
      actorId: SYSTEM_ACTOR_ID,
      commandId,
      payloadHash,
      expectedVersion: latestVersion(events),
      events: [requestEvent('interaction.request.updated', updated)],
    });
    if (result.receipt.ok) return true;
  }
  return false;
}

function latestVersion(events: readonly { aggregateVersion: number }[]): number {
  return events.at(-1)?.aggregateVersion ?? 0;
}

function requestEvent(
  eventType: 'interaction.request.created' | 'interaction.request.updated',
  request: InteractionRequestProjection,
): ProposedDomainEvent {
  return { type: eventType, version: 1, payload: { request } };
}

export const interactionPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.interactions',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    provides: [interactionPolicyRegistry.id],
    eventSchemaVersions: {
      'interaction.request.created': 1,
      'interaction.request.updated': 1,
    },
  },
  register({ registerCommand, provideCapability }) {
    const policies = new Map<string, InteractionRequestPolicy>();
    provideCapability(interactionPolicyRegistry, {
      register(kind: string, policy: InteractionRequestPolicy) {
        if (!kind.trim() || policies.has(kind)) throw new Error(`Duplicate interaction policy: ${kind}`);
        policies.set(kind, policy);
      },
    });

    registerCommand('interaction.request', InteractionRequestCommandSchema, async (command, context) => {
      const policy = policies.get(command.payload.kind);
      if (!policy) throw new RuleViolationError('That interaction is not available.');
      if (command.characterId === command.payload.recipientCharacterId) {
        throw new RuleViolationError('You cannot challenge yourself.');
      }
      const streamId = interactionStreamId(context.worldInstanceId);
      const events = await context.store.readStream(context.worldInstanceId, streamId);
      const state = projectInteractionEvents(events);
      const activeOutgoing = state.requests.filter((request) =>
        request.initiatorCharacterId === command.characterId && request.status === 'pending');
      if (activeOutgoing.length >= MAX_PENDING_REQUESTS) {
        throw new RuleViolationError('You already have several pending requests. Wait for a response first.');
      }
      const recentOutgoing = state.requests.filter((request) =>
        request.initiatorCharacterId === command.characterId &&
        Date.parse(request.createdAt) > context.now().getTime() - 60_000);
      if (recentOutgoing.length >= REQUESTS_PER_MINUTE) {
        throw new RuleViolationError('You are sending requests too quickly. Try again in a moment.');
      }
      if (state.requests.some((request) =>
        request.status === 'pending' &&
        request.initiatorCharacterId === command.characterId &&
        request.recipientCharacterId === command.payload.recipientCharacterId &&
        request.kind === command.payload.kind)) {
        throw new RuleViolationError('You already have a pending request to that player.');
      }

      const recipientStream = await context.store.readStream(
        context.worldInstanceId,
        command.payload.recipientCharacterId,
      );
      if (!recipientStream.length) throw new RuleViolationError('That player is not available.');
      const requestId = context.makeId();
      const createdAt = context.now();
      const names = await policy.prepareRequest({
        initiatorCharacterId: command.characterId,
        recipientCharacterId: command.payload.recipientCharacterId,
      }, context);
      const requestBase = {
        requestId,
        kind: command.payload.kind,
        initiatorCharacterId: command.characterId,
        initiatorName: names.initiatorName,
        recipientCharacterId: command.payload.recipientCharacterId,
        recipientName: names.recipientName,
      };

      const request = InteractionRequestProjectionSchema.parse({
        ...requestBase,
        status: 'pending',
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + REQUEST_TTL_MS).toISOString(),
      });
      return {
        streamId,
        expectedVersion: latestVersion(events),
        events: [requestEvent('interaction.request.created', request)],
      };
    });

    registerCommand('interaction.respond', InteractionRespondCommandSchema, async (command, context) => {
      const streamId = interactionStreamId(context.worldInstanceId);
      const events = await context.store.readStream(context.worldInstanceId, streamId);
      const state = projectInteractionEvents(events);
      const request = state.requests.find((candidate) => candidate.requestId === command.payload.requestId);
      if (!request) throw new RuleViolationError('That request is no longer available.');
      if (request.recipientCharacterId !== command.characterId) {
        throw new RuleViolationError('Only the intended recipient can respond to this request.');
      }
      if (request.status !== 'pending') throw new RuleViolationError('That request has already been resolved.');

      if (Date.parse(request.expiresAt) <= context.now().getTime()) {
        const expired = { ...request, status: 'expired' as const };
        return {
          streamId,
          expectedVersion: latestVersion(events),
          events: [requestEvent('interaction.request.updated', expired)],
        };
      }

      const responseStatus: InteractionRequestProjection['status'] =
        command.payload.response === 'accept' ? 'accepted' : 'declined';
      const resolved = { ...request, status: responseStatus };
      const responseEvents: ProposedDomainEvent[] = [
        requestEvent('interaction.request.updated', resolved),
      ];
      if (command.payload.response === 'accept') {
        const policy = policies.get(request.kind);
        if (!policy) throw new RuleViolationError('That interaction is no longer supported.');
        responseEvents.push(...await policy.prepareAcceptance(request, context));
      }
      return {
        streamId,
        expectedVersion: latestVersion(events),
        events: responseEvents,
      };
    });
  },
};
