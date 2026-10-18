import { describe, expect, it } from 'vitest';
import { EngineHost, InMemoryEventStore, replayCharacter } from '@mudd/engine-core';
import { characterPlugin, combatPlugin, movementPlugin } from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import { MuddHttpClient } from './index.js';

const session = {
  sessionId: 'combat-session',
  playerId: 'combat-player',
  actorId: 'combat-player',
  worldInstanceId: DEMO_WORLD_INSTANCE_ID,
  grantedPermissions: [],
  authenticated: true,
} as const;

function makeClient(world = demoWorld) {
  const store = new InMemoryEventStore();
  const engine = new EngineHost(
    [characterPlugin, combatPlugin, movementPlugin],
    store,
    { canAccessInstance: async () => true, ownsCharacter: async () => true },
    world,
  );
  const ready = engine.start();
  const fetcher: typeof fetch = async (input, init = {}) => {
    await ready;
    const path = String(input);
    const body = JSON.parse(String(init.body ?? '{}')) as unknown;
    const result = path.endsWith('/commands')
      ? await engine.dispatch(body, session)
      : await engine.query(body, session);
    return Response.json(result);
  };
  const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });
  return { client, store };
}

describe('turn-based PvE combat', () => {
  it('resolves character-scoped actions, retries idempotently, and locks movement only while active', async () => {
    const { client, store } = makeClient();
    const first = await client.createCharacter('Briar', 'combat-create-first');
    const firstId = first.streamId!;
    const room = await client.look(firstId, 'combat-look-first');

    await expect(client.performCombatAction(firstId, 'defend', room.revision, { encounterId: 'missing-encounter' }, 'combat-no-fight'))
      .rejects.toThrow('Choose a combatant here to begin a fight.');

    const attack = await client.performCombatAction(
      firstId,
      'attack',
      room.revision,
      { targetNpcId: 'mossgate-training-sentinel' },
      'combat-first-attack',
    );
    expect(attack.receipt.ok).toBe(true);
    const firstState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, firstId))!;
    expect(firstState.combat).toMatchObject({
      opponentName: 'Practice Sentinel',
      round: 1,
      playerHealth: 5,
      opponentHealth: 2,
      status: 'active',
    });

    const retriedAttack = await client.performCombatAction(
      firstId,
      'attack',
      room.revision,
      { targetNpcId: 'mossgate-training-sentinel' },
      'combat-first-attack',
    );
    expect(retriedAttack.receipt).toEqual(attack.receipt);
    expect((await store.readStream(DEMO_WORLD_INSTANCE_ID, firstId))).toHaveLength(2);
    await expect(client.move(firstId, 'clearing-to-bridge', firstState.revision, 'combat-move-during'))
      .rejects.toThrow('You cannot leave while combat is active. Flee first.');

    await client.performCombatAction(
      firstId,
      'defend',
      firstState.revision,
      { encounterId: firstState.combat!.encounterId },
      'combat-defend',
    );
    const defendedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, firstId))!;
    expect(defendedState.combat).toMatchObject({ round: 2, playerHealth: 5, opponentHealth: 2, status: 'active' });

    await client.performCombatAction(
      firstId,
      'attack',
      defendedState.revision,
      { encounterId: defendedState.combat!.encounterId },
      'combat-finish',
    );
    const wonState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, firstId))!;
    expect(wonState.combat).toMatchObject({ status: 'victory', playerHealth: 5, opponentHealth: 0 });
    await expect(client.move(firstId, 'clearing-to-bridge', wonState.revision, 'combat-move-after'))
      .resolves.toMatchObject({ receipt: { ok: true } });

    const second = await client.createCharacter('Alder', 'combat-create-second');
    const secondId = second.streamId!;
    const secondRoom = await client.look(secondId, 'combat-look-second');
    await client.performCombatAction(
      secondId,
      'attack',
      secondRoom.revision,
      { targetNpcId: 'mossgate-training-sentinel' },
      'combat-second-start',
    );
    const secondState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, secondId))!;
    expect(secondState.combat?.status).toBe('active');
    expect(secondState.combat?.encounterId).not.toBe(wonState.combat?.encounterId);
    await client.performCombatAction(
      secondId,
      'flee',
      secondState.revision,
      { encounterId: secondState.combat!.encounterId },
      'combat-second-flee',
    );
    const fledState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, secondId))!;
    expect(fledState.combat?.status).toBe('fled');
    await expect(client.move(secondId, 'clearing-to-bridge', fledState.revision, 'combat-move-after-flee'))
      .resolves.toMatchObject({ receipt: { ok: true } });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, firstId))?.combat?.status)
      .toBe('victory');
  });

  it('records a nonlethal defeat when an authored opponent overwhelms the player', async () => {
    const hardWorld = {
      ...demoWorld,
      locations: demoWorld.locations.map((location) => ({
        ...location,
        npcs: location.npcs?.map((npc) => npc.id === 'mossgate-training-sentinel'
          ? { ...npc, combatProfile: { maxHealth: 12, attackDamage: 2 } }
          : npc),
      })),
    };
    const { client, store } = makeClient(hardWorld);
    const created = await client.createCharacter('Rowan', 'combat-defeat-create');
    const characterId = created.streamId!;
    let state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    let commandId = 0;

    for (let turn = 0; turn < 3; turn += 1) {
      await client.performCombatAction(
        characterId,
        'attack',
        state.revision,
        state.combat?.status === 'active'
          ? { encounterId: state.combat.encounterId }
          : { targetNpcId: 'mossgate-training-sentinel' },
        `combat-defeat-${++commandId}`,
      );
      state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    }

    expect(state.combat).toMatchObject({
      status: 'defeat',
      playerHealth: 0,
      opponentHealth: 6,
      lastAction: 'attack',
    });
  });
});
