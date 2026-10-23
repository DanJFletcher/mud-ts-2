import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineHost, InMemoryEventStore, replayCharacter } from '@mudd/engine-core';
import {
  characterPlugin,
  combatPlugin,
  interactionPlugin,
  interactionStreamId,
  worldItemsPlugin,
} from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';

type Identity = { playerId: string; actorId: string; sessionId: string };

function makeHarness() {
  let id = 0;
  let now = new Date('2026-10-19T12:00:00.000Z');
  const owners = new Map<string, string>();
  const store = new InMemoryEventStore();
  const engine = new EngineHost(
    [worldItemsPlugin, characterPlugin, combatPlugin, interactionPlugin],
    store,
    {
      canAccessInstance: async () => true,
      ownsCharacter: async (session, characterId) => owners.get(characterId) === session.playerId,
    },
    demoWorld,
    () => `pvp-test-id-${++id}`,
    () => now,
  );
  const identity = (playerId: string): Identity => ({
    playerId,
    actorId: playerId,
    sessionId: `session-${playerId}`,
  });
  const sessionFor = (user: Identity) => ({
    ...user,
    worldInstanceId: DEMO_WORLD_INSTANCE_ID,
    grantedPermissions: [],
    authenticated: true,
  } as const);
  const createCharacter = async (user: Identity, name: string) => {
    const result = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: `create-${user.playerId}`,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name },
    }, sessionFor(user));
    if (!result.receipt.ok) throw new Error(result.receipt.message);
    const created = result.events.find((event) => event.type === 'character.created');
    const characterId = (created?.payload as { characterId?: string } | undefined)?.characterId;
    if (!characterId) throw new Error('Character creation returned no ID.');
    owners.set(characterId, user.playerId);
    return characterId;
  };
  const challenge = async (challenger: Identity, challengerId: string, recipientId: string) => {
    const result = await engine.dispatch({
      type: 'interaction.request',
      version: 1,
      commandId: `challenge-${challengerId}`,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: challengerId,
      payload: { kind: 'pvp.challenge', recipientCharacterId: recipientId },
    }, sessionFor(challenger));
    return result;
  };
  const respond = (user: Identity, characterId: string, requestId: string, response: 'accept' | 'decline', commandId = `${response}-${requestId}`) =>
    engine.dispatch({
      type: 'interaction.respond',
      version: 1,
      commandId,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: { requestId, response },
    }, sessionFor(user));
  const requests = async () => (await store.readStream(
    DEMO_WORLD_INSTANCE_ID,
    interactionStreamId(DEMO_WORLD_INSTANCE_ID),
  )).filter((event) => event.type === 'interaction.request.created');
  return {
    engine,
    store,
    owners,
    identity,
    createCharacter,
    challenge,
    respond,
    requests,
    advance(ms: number) { now = new Date(now.getTime() + ms); },
  };
}

describe('consent-based PvP interaction requests', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts one shared encounter only after the intended recipient accepts', async () => {
    const h = makeHarness();
    const challenger = h.identity('challenger');
    const recipient = h.identity('recipient');
    await h.engine.start();
    const challengerId = await h.createCharacter(challenger, 'Rill');
    const recipientId = await h.createCharacter(recipient, 'Mara');

    const challenged = await h.challenge(challenger, challengerId, recipientId);
    expect(challenged.receipt.ok).toBe(true);
    const request = (await h.requests())[0]!;
    const requestId = (request.payload as { request: { requestId: string } }).request.requestId;
    const accepted = await h.respond(recipient, recipientId, requestId, 'accept', 'same-accept-command');
    const repeatedAcceptance = await h.respond(recipient, recipientId, requestId, 'accept', 'same-accept-command');

    expect(accepted.receipt.ok).toBe(true);
    expect(repeatedAcceptance.commitOutcome).toBe('duplicate');
    expect(accepted.events.map((event) => event.type)).toContain('pvp.encounter.started');
    const stream = await h.store.readStream(DEMO_WORLD_INSTANCE_ID, interactionStreamId(DEMO_WORLD_INSTANCE_ID));
    expect(stream.filter((event) => event.type === 'pvp.encounter.started')).toHaveLength(1);
    await h.engine.stop();
  });

  it('declining creates no encounter and only the recipient can respond', async () => {
    const h = makeHarness();
    const challenger = h.identity('challenger');
    const recipient = h.identity('recipient');
    await h.engine.start();
    const challengerId = await h.createCharacter(challenger, 'Rill');
    const recipientId = await h.createCharacter(recipient, 'Mara');
    await h.challenge(challenger, challengerId, recipientId);
    const request = (await h.requests())[0]!;
    const requestId = (request.payload as { request: { requestId: string } }).request.requestId;

    const unauthorized = await h.respond(challenger, challengerId, requestId, 'accept', 'wrong-recipient');
    expect(unauthorized.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
    const declined = await h.respond(recipient, recipientId, requestId, 'decline');
    expect(declined.receipt.ok).toBe(true);
    expect(declined.events.map((event) => event.type)).not.toContain('pvp.encounter.started');
    await h.engine.stop();
  });

  it('expires requests after 60 seconds and rejects conflicting responses', async () => {
    const h = makeHarness();
    const challenger = h.identity('challenger');
    const recipient = h.identity('recipient');
    await h.engine.start();
    const challengerId = await h.createCharacter(challenger, 'Rill');
    const recipientId = await h.createCharacter(recipient, 'Mara');
    await h.challenge(challenger, challengerId, recipientId);
    const request = (await h.requests())[0]!;
    const requestId = (request.payload as { request: { requestId: string } }).request.requestId;
    h.advance(60_001);

    const expired = await h.respond(recipient, recipientId, requestId, 'accept');
    expect(expired.receipt.ok).toBe(true);
    expect(expired.events[0]?.payload).toMatchObject({ request: { status: 'expired' } });
    const conflicting = await h.respond(recipient, recipientId, requestId, 'decline', 'late-decline');
    expect(conflicting.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
    await h.engine.stop();
  });

  it('serializes simultaneous accept and decline commands without starting two encounters', async () => {
    const h = makeHarness();
    const challenger = h.identity('challenger');
    const recipient = h.identity('recipient');
    await h.engine.start();
    const challengerId = await h.createCharacter(challenger, 'Rill');
    const recipientId = await h.createCharacter(recipient, 'Mara');
    await h.challenge(challenger, challengerId, recipientId);
    const request = (await h.requests())[0]!;
    const requestId = (request.payload as { request: { requestId: string } }).request.requestId;

    const results = await Promise.all([
      h.respond(recipient, recipientId, requestId, 'accept', 'race-accept'),
      h.respond(recipient, recipientId, requestId, 'decline', 'race-decline'),
    ]);
    const stream = await h.store.readStream(DEMO_WORLD_INSTANCE_ID, interactionStreamId(DEMO_WORLD_INSTANCE_ID));
    expect(results.some((result) => result.receipt.ok)).toBe(true);
    expect(stream.filter((event) => event.type === 'pvp.encounter.started')).toHaveLength(
      results.filter((result) => result.events.some((event) => event.type === 'pvp.encounter.started')).length,
    );
    expect(stream.filter((event) => event.type === 'pvp.encounter.started').length).toBeLessThanOrEqual(1);
    await h.engine.stop();
  });

  it('persists both characters’ PvP health through idempotent outcome effects', async () => {
    const h = makeHarness();
    const challenger = h.identity('challenger');
    const recipient = h.identity('recipient');
    await h.engine.start();
    const challengerId = await h.createCharacter(challenger, 'Rill');
    const recipientId = await h.createCharacter(recipient, 'Mara');
    await h.challenge(challenger, challengerId, recipientId);
    const request = (await h.requests())[0]!;
    const requestId = (request.payload as { request: { requestId: string } }).request.requestId;
    const accepted = await h.respond(recipient, recipientId, requestId, 'accept');
    const startEvent = accepted.events.find((event) => event.type === 'pvp.encounter.started');
    const encounterId = (startEvent?.payload as { encounter?: { encounterId?: string } } | undefined)
      ?.encounter?.encounterId;
    if (!encounterId) throw new Error('PvP acceptance returned no encounter.');

    const action = (user: Identity, characterId: string, commandId: string) => h.engine.dispatch({
      type: 'pvp.action',
      version: 1,
      commandId,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: { encounterId, action: 'attack' },
    }, {
      ...user,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    });
    expect((await action(challenger, challengerId, 'pvp-a-1')).receipt.ok).toBe(true);
    expect((await action(recipient, recipientId, 'pvp-b-1')).receipt.ok).toBe(true);
    expect((await action(challenger, challengerId, 'pvp-a-2')).receipt.ok).toBe(true);
    expect((await action(recipient, recipientId, 'pvp-b-2')).receipt.ok).toBe(true);
    const defeated = await action(challenger, challengerId, 'pvp-a-3');
    expect(defeated.receipt.ok).toBe(true);
    await h.engine.processPendingEffects();

    const challengerState = replayCharacter(await h.store.readStream(DEMO_WORLD_INSTANCE_ID, challengerId));
    const recipientState = replayCharacter(await h.store.readStream(DEMO_WORLD_INSTANCE_ID, recipientId));
    expect(challengerState?.health).toEqual({ current: 2, maximum: 6 });
    expect(recipientState?.health).toEqual({ current: 6, maximum: 6 });
    expect(recipientState?.locationId).toBe('stillwater-fountain');
    expect(recipientState?.combat).toBeUndefined();
    const stream = await h.store.readStream(DEMO_WORLD_INSTANCE_ID, interactionStreamId(DEMO_WORLD_INSTANCE_ID));
    expect(stream.some((event) =>
      event.type === 'pvp.outcome.applied' &&
      (event.payload as { encounter?: { encounterId?: string } }).encounter?.encounterId === encounterId,
    )).toBe(true);
    await h.engine.stop();
  });

  it('blocks rest during consented PvP and doubles an already-legal hit against a resting target', async () => {
    const h = makeHarness();
    const challenger = h.identity('resting-target-challenger');
    const recipient = h.identity('resting-target-recipient');
    await h.engine.start();
    const challengerId = await h.createCharacter(challenger, 'Rill');
    const recipientId = await h.createCharacter(recipient, 'Mara');
    await h.challenge(challenger, challengerId, recipientId);
    const request = (await h.requests())[0]!;
    const requestId = (request.payload as { request: { requestId: string } }).request.requestId;
    const accepted = await h.respond(recipient, recipientId, requestId, 'accept');
    const encounterId = (accepted.events.find((event) => event.type === 'pvp.encounter.started')
      ?.payload as { encounter: { encounterId: string } }).encounter.encounterId;

    const refusedRest = await h.engine.dispatch({
      type: 'character.rest',
      version: 1,
      commandId: 'pvp-rest-refused',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: recipientId,
      expectedVersion: 1,
      payload: {},
    }, {
      ...recipient,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    });
    expect(refusedRest.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });

    const targetState = replayCharacter(await h.store.readStream(DEMO_WORLD_INSTANCE_ID, recipientId))!;
    const seededPosture = await h.store.append({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      streamId: recipientId,
      actorId: recipient.playerId,
      commandId: 'legacy-resting-pvp-target',
      payloadHash: recipientId,
      expectedVersion: targetState.revision,
      events: [{
        type: 'character.posture_changed',
        version: 1,
        payload: {
          characterId: recipientId,
          posture: 'resting',
          locationId: targetState.locationId,
        },
      }],
    });
    expect(seededPosture.receipt.ok).toBe(true);
    const attack = await h.engine.dispatch({
      type: 'pvp.action',
      version: 1,
      commandId: 'pvp-attack-resting-target',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: challengerId,
      payload: { encounterId, action: 'attack' },
    }, {
      ...challenger,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    });
    expect(attack.receipt.ok).toBe(true);
    const resolvedEncounter = attack.events.find((event) => event.type === 'pvp.action.resolved')
      ?.payload.encounter as { participants: { characterId: string; health: number }[] };
    expect(resolvedEncounter.participants.find((participant) => participant.characterId === recipientId)?.health)
      .toBe(2);
    expect(replayCharacter(await h.store.readStream(DEMO_WORLD_INSTANCE_ID, recipientId))?.staminaRecovery.posture)
      .toBe('standing');
    await h.engine.stop();
  });
});
