import { describe, expect, it, vi } from 'vitest';
import type { StoredGameEvent } from '@mudd/engine-core';
import {
  interactionPlugin,
  interactionStreamId,
  projectCharacterInteractions,
  projectInteractionEvents,
  updateInteractionRequestStatus,
} from './interactions.js';

const worldId = 'interaction-unit-world';
const initiatorId = 'character-a';
const recipientId = 'character-b';
const now = new Date('2026-10-27T12:00:00.000Z');

function request(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'request-1',
    kind: 'challenge',
    initiatorCharacterId: initiatorId,
    initiatorName: 'Aster',
    recipientCharacterId: recipientId,
    recipientName: 'Briar',
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

function stored(
  type: string,
  payload: Record<string, unknown>,
  revision = 1,
): StoredGameEvent {
  return {
    eventId: `event-${revision}`,
    worldInstanceId: worldId,
    streamId: interactionStreamId(worldId),
    aggregateId: interactionStreamId(worldId),
    aggregateVersion: revision,
    type,
    version: 1,
    payload,
    causationCommandId: `command-${revision}`,
    actorId: 'system',
    occurredAt: now.toISOString(),
    tick: revision,
  } as unknown as StoredGameEvent;
}

function requestHistory(value = request()) {
  return [stored('interaction.request.created', { request: value })];
}

function harness(options: {
  history?: readonly StoredGameEvent[];
  recipientExists?: boolean;
  now?: Date;
} = {}) {
  const commands = new Map<string, (command: any, context: any) => Promise<unknown>>();
  let registry: { register(kind: string, policy: any): void } | undefined;
  const policies = new Map<string, any>();
  const history = [...(options.history ?? [])];
  const append = vi.fn(async (_request: unknown) => ({ receipt: { ok: true } }));
  const lookupCommand = vi.fn(async () => undefined);
  const readStream = vi.fn(async (_world: string, streamId: string) =>
    streamId === interactionStreamId(worldId)
      ? history
      : options.recipientExists === false ? [] : [stored('character.created', {}, 1)]);

  interactionPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: unknown) => {
      commands.set(name, handler as (command: any, context: any) => Promise<unknown>);
    },
    provideCapability: (_token: unknown, implementation: unknown) => {
      registry = implementation as typeof registry;
    },
  } as never);
  if (!registry) throw new Error('Interaction policy registry was not provided.');
  const context = {
    worldInstanceId: worldId,
    session: { playerId: 'player-a' },
    now: () => options.now ?? now,
    makeId: () => 'generated-request',
    store: { readStream, append, lookupCommand },
  };
  return { commands, policies, registry, history, append, lookupCommand, readStream, context };
}

function requestCommand(overrides: Record<string, unknown> = {}) {
  return {
    characterId: initiatorId,
    payload: { kind: 'challenge', recipientCharacterId: recipientId },
    ...overrides,
  };
}

function respondCommand(overrides: Record<string, unknown> = {}) {
  return {
    characterId: recipientId,
    payload: { requestId: 'request-1', response: 'accept' },
    ...overrides,
  };
}

describe('interaction event projections', () => {
  it('indexes requests by participant and encounter state', () => {
    const encounter = {
      encounterId: 'pvp-1',
      requestId: 'request-1',
      locationId: 'market',
      participants: [
        { characterId: initiatorId, name: 'Aster', health: 8, maximumHealth: 10 },
        { characterId: recipientId, name: 'Briar', health: 7, maximumHealth: 10 },
      ],
      turnCharacterId: initiatorId,
      round: 1,
      status: 'active',
      lastNarration: 'The duel begins.',
      updatedAt: now.toISOString(),
    };
    const events = [
      stored('interaction.request.created', { request: request() }),
      stored('interaction.request.updated', { request: request({ status: 'accepted' }) }, 2),
      stored('pvp.encounter.started', { encounter }, 3),
    ];
    expect(projectCharacterInteractions(events, initiatorId)).toMatchObject({
      requests: [{ requestId: 'request-1', status: 'accepted' }],
      encounter: { encounterId: 'pvp-1' },
    });
    expect(projectCharacterInteractions(events, 'unrelated-character'))
      .toEqual({ requests: [], encounter: null });
    expect(projectInteractionEvents(events)).toMatchObject({
      requests: [{ requestId: 'request-1', status: 'accepted' }],
      latestEncounterEvent: { type: 'pvp.encounter.started' },
    });
    expect(projectInteractionEvents([
      stored('interaction.request.created', { request: { malformed: true } }),
    ]).requests).toEqual([]);
  });
});

describe('interaction request lifecycle helpers', () => {
  it('returns idempotent status updates, ignores resolved or missing requests, and retries conflicts', async () => {
    const alreadyApplied = {
      lookupCommand: vi.fn(async () => ({ commandId: 'existing' })),
      readStream: vi.fn(),
      append: vi.fn(),
    } as any;
    await expect(updateInteractionRequestStatus(alreadyApplied, worldId, 'request-1', 'expired'))
      .resolves.toBe(true);
    expect(alreadyApplied.readStream).not.toHaveBeenCalled();

    const missing = {
      lookupCommand: vi.fn(async () => undefined),
      readStream: vi.fn(async () => []),
      append: vi.fn(),
    } as any;
    await expect(updateInteractionRequestStatus(missing, worldId, 'missing', 'cancelled'))
      .resolves.toBe(false);

    const resolved = {
      lookupCommand: vi.fn(async () => undefined),
      readStream: vi.fn(async () => requestHistory(request({ status: 'accepted' }))),
      append: vi.fn(),
    } as any;
    await expect(updateInteractionRequestStatus(resolved, worldId, 'request-1', 'expired'))
      .resolves.toBe(false);

    const conflict = {
      lookupCommand: vi.fn(async () => undefined),
      readStream: vi.fn(async () => requestHistory()),
      append: vi.fn(async () => ({ receipt: { ok: false } })),
    } as any;
    await expect(updateInteractionRequestStatus(conflict, worldId, 'request-1', 'expired'))
      .resolves.toBe(false);
    expect(conflict.append).toHaveBeenCalledTimes(3);

    const success = {
      lookupCommand: vi.fn(async () => undefined),
      readStream: vi.fn(async () => requestHistory()),
      append: vi.fn(async () => ({ receipt: { ok: true } })),
    } as any;
    await expect(updateInteractionRequestStatus(success, worldId, 'request-1', 'cancelled'))
      .resolves.toBe(true);
    expect(success.append.mock.calls[0]?.[0]).toMatchObject({
      expectedVersion: 1,
      events: [expect.objectContaining({
        type: 'interaction.request.updated',
        payload: { request: expect.objectContaining({ status: 'cancelled' }) },
      })],
    });
  });
});

describe('interaction request commands', () => {
  it('creates only valid requests and enforces policy, self, availability, and request limits', async () => {
    const test = harness();
    await expect(test.commands.get('interaction.request')!(requestCommand(), test.context))
      .rejects.toThrow('interaction is not available');
    test.registry.register('challenge', {
      prepareRequest: vi.fn(async () => ({ initiatorName: 'Aster', recipientName: 'Briar' })),
      prepareAcceptance: vi.fn(async () => []),
    });

    await expect(test.commands.get('interaction.request')!(
      requestCommand({ payload: { kind: 'challenge', recipientCharacterId: initiatorId } }),
      test.context,
    )).rejects.toThrow('cannot challenge yourself');

    const created = await test.commands.get('interaction.request')!(requestCommand(), test.context);
    expect(created).toMatchObject({
      streamId: interactionStreamId(worldId),
      expectedVersion: 0,
      events: [expect.objectContaining({
        type: 'interaction.request.created',
        payload: { request: expect.objectContaining({
          requestId: 'generated-request',
          status: 'pending',
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        }) },
      })],
    });

    const unavailable = harness({ recipientExists: false });
    unavailable.registry.register('challenge', {
      prepareRequest: vi.fn(async () => ({ initiatorName: 'Aster', recipientName: 'Briar' })),
      prepareAcceptance: vi.fn(async () => []),
    });
    await expect(unavailable.commands.get('interaction.request')!(requestCommand(), unavailable.context))
      .rejects.toThrow('player is not available');

    const duplicate = harness({ history: requestHistory() });
    duplicate.registry.register('challenge', {
      prepareRequest: vi.fn(async () => ({ initiatorName: 'Aster', recipientName: 'Briar' })),
      prepareAcceptance: vi.fn(async () => []),
    });
    await expect(duplicate.commands.get('interaction.request')!(requestCommand(), duplicate.context))
      .rejects.toThrow('already have a pending request');

    const pendingHistory = [0, 1, 2].map((index) =>
      stored('interaction.request.created', {
        request: request({ requestId: `pending-${index}` }),
      }, index + 1),
    );
    const capped = harness({ history: pendingHistory });
    capped.registry.register('challenge', {
      prepareRequest: vi.fn(async () => ({ initiatorName: 'Aster', recipientName: 'Briar' })),
      prepareAcceptance: vi.fn(async () => []),
    });
    await expect(capped.commands.get('interaction.request')!(requestCommand(), capped.context))
      .rejects.toThrow('several pending requests');

    const recentHistory = Array.from({ length: 5 }, (_, index) =>
      stored('interaction.request.created', {
        request: request({ requestId: `recent-${index}`, status: 'declined' }),
      }, index + 1),
    );
    const rateLimited = harness({ history: recentHistory });
    rateLimited.registry.register('challenge', {
      prepareRequest: vi.fn(async () => ({ initiatorName: 'Aster', recipientName: 'Briar' })),
      prepareAcceptance: vi.fn(async () => []),
    });
    await expect(rateLimited.commands.get('interaction.request')!(requestCommand(), rateLimited.context))
      .rejects.toThrow('sending requests too quickly');
  });

  it('responds to pending requests, expires stale requests, and includes policy guards on acceptance', async () => {
    const test = harness({ history: requestHistory() });
    const prepareAcceptance = vi.fn(async () => ({
      events: [{ type: 'pvp.encounter.started', version: 1, payload: { started: true } }],
      guards: [{ streamId: 'character-a', expectedVersion: 3 }],
    }));
    test.registry.register('challenge', { prepareAcceptance });

    const accepted = await test.commands.get('interaction.respond')!(respondCommand(), test.context) as any;
    expect(accepted.events.map((event: any) => event.type))
      .toEqual(['interaction.request.updated', 'pvp.encounter.started']);
    expect(accepted.guards).toEqual([{ streamId: 'character-a', expectedVersion: 3 }]);
    expect(prepareAcceptance).toHaveBeenCalledOnce();

    const declined = await test.commands.get('interaction.respond')!(respondCommand({
      payload: { requestId: 'request-1', response: 'decline' },
    }), test.context) as any;
    expect(declined.events).toHaveLength(1);
    expect(declined.events[0].payload.request.status).toBe('declined');

    const simpleAcceptance = harness({ history: requestHistory() });
    simpleAcceptance.registry.register('challenge', {
      prepareRequest: vi.fn(),
      prepareAcceptance: vi.fn(async () => [
        { type: 'pvp.encounter.started', version: 1, payload: { accepted: true } },
      ]),
    });
    const simpleResponse = await simpleAcceptance.commands.get('interaction.respond')!(
      respondCommand(),
      simpleAcceptance.context,
    ) as any;
    expect(simpleResponse.events.map((event: any) => event.type))
      .toEqual(['interaction.request.updated', 'pvp.encounter.started']);

    const expired = harness({
      history: requestHistory(request({ expiresAt: '2026-10-27T11:59:00.000Z' })),
    });
    const expiredResponse = await expired.commands.get('interaction.respond')!(respondCommand(), expired.context) as any;
    expect(expiredResponse.events[0].payload.request.status).toBe('expired');

    const wrongRecipient = harness({ history: requestHistory() });
    await expect(wrongRecipient.commands.get('interaction.respond')!(respondCommand({
      characterId: initiatorId,
    }), wrongRecipient.context)).rejects.toThrow('Only the intended recipient');

    const missing = harness();
    await expect(missing.commands.get('interaction.respond')!(respondCommand(), missing.context))
      .rejects.toThrow('no longer available');

    const alreadyResolved = harness({ history: requestHistory(request({ status: 'declined' })) });
    await expect(alreadyResolved.commands.get('interaction.respond')!(respondCommand(), alreadyResolved.context))
      .rejects.toThrow('already been resolved');
  });
});
