import { describe, expect, it } from 'vitest';
import { EngineHost, InMemoryEventStore, replayCharacter } from '@mudd/engine-core';
import { characterPlugin, combatPlugin, merchantPlugin, movementPlugin } from '@mudd/core-plugins';
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
    [characterPlugin, combatPlugin, merchantPlugin, movementPlugin],
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
    expect((await store.readStream(DEMO_WORLD_INSTANCE_ID, firstId))[1]?.version).toBe(3);
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

    const victory = await client.performCombatAction(
      firstId,
      'attack',
      defendedState.revision,
      { encounterId: defendedState.combat!.encounterId },
      'combat-finish',
    );
    const wonState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, firstId))!;
    expect(wonState.combat).toMatchObject({ status: 'victory', playerHealth: 5, opponentHealth: 0 });
    expect(wonState.advancement).toEqual({
      experience: 10,
      level: 1,
      lastRewardedEncounterId: defendedState.combat!.encounterId,
    });
    const eventCountAfterVictory = (await store.readStream(DEMO_WORLD_INSTANCE_ID, firstId)).length;
    const retriedVictory = await client.performCombatAction(
      firstId,
      'attack',
      defendedState.revision,
      { encounterId: defendedState.combat!.encounterId },
      'combat-finish',
    );
    expect(retriedVictory.receipt).toEqual(victory.receipt);
    expect(await store.readStream(DEMO_WORLD_INSTANCE_ID, firstId)).toHaveLength(eventCountAfterVictory);
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

  it('resolves heavy wind-ups and guardian defenses from authored opponent styles', async () => {
    const { client, store } = makeClient();
    const heavyCharacter = await client.createCharacter('Rowan', 'combat-heavy-create');
    const heavyId = heavyCharacter.streamId!;
    let heavyState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, heavyId))!;

    await client.performCombatAction(
      heavyId,
      'attack',
      heavyState.revision,
      { targetNpcId: 'mossgate-practice-mauler' },
      'combat-heavy-windup',
    );
    heavyState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, heavyId))!;
    expect(heavyState.combat).toMatchObject({
      opponentStyle: 'heavy',
      round: 1,
      playerHealth: 6,
      opponentHealth: 4,
      lastNarration: 'You deal 2 damage to Practice Mauler. It winds up for a heavy strike.',
    });

    await client.performCombatAction(
      heavyId,
      'attack',
      heavyState.revision,
      { encounterId: heavyState.combat!.encounterId },
      'combat-heavy-strike',
    );
    heavyState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, heavyId))!;
    expect(heavyState.combat).toMatchObject({
      round: 2,
      playerHealth: 4,
      lastNarration: 'You deal 2 damage to Practice Mauler. Its heavy strike for 2.',
    });

    const guardianCharacter = await client.createCharacter('Sable', 'combat-guardian-create');
    const guardianId = guardianCharacter.streamId!;
    const guardianState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, guardianId))!;
    await client.performCombatAction(
      guardianId,
      'attack',
      guardianState.revision,
      { targetNpcId: 'mossgate-practice-guardian' },
      'combat-guardian-block',
    );
    const defendedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, guardianId))!;
    expect(defendedState.combat).toMatchObject({
      opponentStyle: 'guardian',
      opponentHealth: 5,
      playerHealth: 5,
      lastNarration: 'You deal 1 damage to Practice Guardian. Its guard softens your blow. It strikes back for 1.',
    });
  });

  it('uses a carried healing draught during combat, applies incoming damage, and consumes it once', async () => {
    const strongSentinelWorld = {
      ...demoWorld,
      locations: demoWorld.locations.map((location) => ({
        ...location,
        npcs: location.npcs?.map((npc) => npc.id === 'mossgate-training-sentinel'
          ? { ...npc, combatProfile: { maxHealth: 12, attackDamage: 2, style: 'steady' as const } }
          : npc),
      })),
    };
    const { client, store } = makeClient(strongSentinelWorld);
    const created = await client.createCharacter('Willow', 'combat-potion-create');
    const characterId = created.streamId!;
    let state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;

    await client.move(characterId, 'clearing-to-bridge', state.revision, 'combat-potion-to-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.move(characterId, 'bridge-to-reedbank', state.revision, 'combat-potion-to-stalls');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.purchaseMerchantListing(
      characterId,
      'sella-reedbank-merchant',
      'reedbank-healing-draught',
      state.revision,
      'combat-potion-buy',
    );
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    const potion = state.inventory.find((item) => item.consumable?.effect === 'heal')!;
    expect(potion.consumable?.amount).toBe(3);

    await client.move(characterId, 'reedbank-to-bridge', state.revision, 'combat-potion-back-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.move(characterId, 'bridge-to-clearing', state.revision, 'combat-potion-back-clearing');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.performCombatAction(
      characterId,
      'attack',
      state.revision,
      { targetNpcId: 'mossgate-training-sentinel' },
      'combat-potion-start',
    );
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(state.combat).toMatchObject({ playerHealth: 4, opponentHealth: 10, status: 'active' });

    const useResult = await client.performCombatAction(
      characterId,
      'use-item',
      state.revision,
      { encounterId: state.combat!.encounterId, itemId: potion.id },
      'combat-potion-use',
    );
    const eventsAfterUse = await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId);
    state = replayCharacter(eventsAfterUse)!;
    expect(state.combat).toMatchObject({
      round: 2,
      playerHealth: 4,
      opponentHealth: 10,
      lastAction: 'use-item',
      lastNarration: 'You use the small healing draught and recover 2 health. It strikes back for 2.',
    });
    expect(state.inventory.some((item) => item.id === potion.id)).toBe(false);
    expect(state.itemLocations.some((entry) => entry.item.id === potion.id)).toBe(false);
    expect(eventsAfterUse.at(-1)).toMatchObject({
      type: 'character.combat_action_resolved',
      version: 3,
      payload: { consumedItemId: potion.id, healingDone: 2 },
    });

    const retry = await client.performCombatAction(
      characterId,
      'use-item',
      state.revision - 1,
      { encounterId: state.combat!.encounterId, itemId: potion.id },
      'combat-potion-use',
    );
    expect(retry.receipt).toEqual(useResult.receipt);
    expect(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).toHaveLength(eventsAfterUse.length);
  });

  it('uses a healing draught between encounters and preserves health in the character stream', async () => {
    const { client, store } = makeClient();
    const created = await client.createCharacter('Fern', 'combat-potion-outside-create');
    const characterId = created.streamId!;
    let state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.move(characterId, 'clearing-to-bridge', state.revision, 'combat-potion-outside-to-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.move(characterId, 'bridge-to-reedbank', state.revision, 'combat-potion-outside-to-stalls');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.purchaseMerchantListing(
      characterId,
      'sella-reedbank-merchant',
      'reedbank-healing-draught',
      state.revision,
      'combat-potion-outside-buy',
    );
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    const potion = state.inventory.find((item) => item.consumable?.effect === 'heal')!;

    await client.move(characterId, 'reedbank-to-bridge', state.revision, 'combat-potion-outside-back-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.move(characterId, 'bridge-to-clearing', state.revision, 'combat-potion-outside-back-clearing');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.performCombatAction(
      characterId,
      'attack',
      state.revision,
      { targetNpcId: 'mossgate-training-sentinel' },
      'combat-potion-outside-start',
    );
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.performCombatAction(
      characterId,
      'attack',
      state.revision,
      { encounterId: state.combat!.encounterId },
      'combat-potion-outside-victory',
    );
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(state.combat?.status).toBe('victory');
    expect(state.health).toEqual({ current: 5, maximum: 6 });

    const used = await client.performCombatAction(
      characterId,
      'use-item',
      state.revision,
      { itemId: potion.id },
      'combat-potion-between-fights',
    );
    const events = await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId);
    const healed = replayCharacter(events)!;
    expect(healed.health).toEqual({ current: 6, maximum: 6 });
    expect(healed.inventory.some((item) => item.id === potion.id)).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: 'character.combat_item_used',
      version: 1,
      payload: { characterId, itemId: potion.id, healingDone: 1 },
    });
    expect(used.receipt.ok).toBe(true);
  });

  it('rejects a healing item at full health without consuming it or advancing combat', async () => {
    const { client, store } = makeClient();
    const created = await client.createCharacter('Elm', 'combat-potion-full-create');
    const characterId = created.streamId!;
    let state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.move(characterId, 'clearing-to-bridge', state.revision, 'combat-potion-full-to-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.move(characterId, 'bridge-to-reedbank', state.revision, 'combat-potion-full-to-stalls');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.purchaseMerchantListing(
      characterId,
      'sella-reedbank-merchant',
      'reedbank-healing-draught',
      state.revision,
      'combat-potion-full-buy',
    );
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    const potion = state.inventory.find((item) => item.consumable?.effect === 'heal')!;
    const fullHealthStreamLength = (await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).length;
    await expect(client.performCombatAction(
      characterId,
      'use-item',
      state.revision,
      { itemId: potion.id },
      'combat-potion-outside-full',
    )).rejects.toThrow('You are already at full health.');
    expect(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).toHaveLength(fullHealthStreamLength);
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))?.inventory)
      .toEqual(state.inventory);
    await client.move(characterId, 'reedbank-to-bridge', state.revision, 'combat-potion-full-back-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.move(characterId, 'bridge-to-clearing', state.revision, 'combat-potion-full-back-clearing');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.performCombatAction(
      characterId,
      'attack',
      state.revision,
      { targetNpcId: 'mossgate-practice-mauler' },
      'combat-potion-full-start',
    );
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(state.combat).toMatchObject({ playerHealth: 6, status: 'active' });
    const streamLength = (await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).length;

    await expect(client.performCombatAction(
      characterId,
      'use-item',
      state.revision,
      { encounterId: state.combat!.encounterId, itemId: potion.id },
      'combat-potion-full-use',
    )).rejects.toThrow('You are already at full health.');
    const unchanged = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(unchanged.combat).toEqual(state.combat);
    expect(unchanged.inventory.some((item) => item.id === potion.id)).toBe(true);
    expect(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).toHaveLength(streamLength);
  });

  it('awards experience once per victory, increases max health on level-up, and preserves current health', async () => {
    const { client, store } = makeClient();
    const created = await client.createCharacter('Rowan', 'combat-advancement-create');
    const characterId = created.streamId!;

    async function winEncounter(prefix: string) {
      let state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
      let commandNumber = 0;
      do {
        await client.performCombatAction(
          characterId,
          'attack',
          state.revision,
          state.combat?.status === 'active'
            ? { encounterId: state.combat.encounterId }
            : { targetNpcId: 'mossgate-training-sentinel' },
          `${prefix}-${++commandNumber}`,
        );
        state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
      } while (state.combat?.status !== 'victory');
      return state;
    }

    const firstVictory = await winEncounter('combat-advancement-first');
    expect(firstVictory.advancement).toMatchObject({ experience: 10, level: 1 });

    const secondVictory = await winEncounter('combat-advancement-second');
    expect(secondVictory.advancement).toMatchObject({ experience: 20, level: 2 });
    expect(secondVictory.advancement?.lastRewardedEncounterId).toBe(secondVictory.combat?.encounterId);

    await client.performCombatAction(
      characterId,
      'attack',
      secondVictory.revision,
      { targetNpcId: 'mossgate-training-sentinel' },
      'combat-advancement-third-start',
    );
    const thirdEncounter = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(thirdEncounter.combat).toMatchObject({
      status: 'active',
      playerHealth: 3,
      playerMaxHealth: 8,
    });
    expect(thirdEncounter.health).toEqual({ current: 3, maximum: 8 });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))).toEqual(thirdEncounter);
  });

  it('makes defeat terminal and requires a new character to begin again', async () => {
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
    const deathRevision = state.revision;
    await expect(client.performCombatAction(
      characterId,
      'use-item',
      deathRevision,
      { itemId: 'small-healing-draught' },
      'combat-defeat-revive',
    )).rejects.toThrow('Your character has died. Start a new character to begin again.');
    await expect(client.move(
      characterId,
      'clearing-to-bridge',
      deathRevision,
      'combat-defeat-move',
    )).rejects.toThrow('Your character has died. Start a new character to begin again.');
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))?.revision).toBe(deathRevision);

    const restart = await client.createCharacter('Rowan Again', 'combat-death-new-character');
    const newCharacter = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, restart.streamId!))!;
    expect(newCharacter.locationId).toBe('mossgate-clearing');
    expect(newCharacter.visitedLocationIds).toEqual(['mossgate-clearing']);
    expect(newCharacter.combat).toBeUndefined();
    expect(newCharacter.health).toBeUndefined();
  });

  it('persists character equipment and applies weapon and armor bonuses to combat', async () => {
    const { client, store } = makeClient();
    const created = await client.createCharacter('Briar', 'combat-gear-create');
    const characterId = created.streamId!;
    let state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;

    await client.move(characterId, 'clearing-to-bridge', state.revision, 'combat-gear-to-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.move(characterId, 'bridge-to-reedbank', state.revision, 'combat-gear-to-stalls');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;

    await client.purchaseMerchantListing(characterId, 'sella-reedbank-merchant', 'reedbank-practice-blade', state.revision, 'combat-buy-blade');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.purchaseMerchantListing(characterId, 'sella-reedbank-merchant', 'reedbank-padded-vest', state.revision, 'combat-buy-vest');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    const blade = state.inventory.find((item) => item.equipment?.slot === 'weapon')!;
    const vest = state.inventory.find((item) => item.equipment?.slot === 'armor')!;

    await client.equip(characterId, blade.id, state.revision, 'combat-equip-blade');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.equip(characterId, vest.id, state.revision, 'combat-equip-vest');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(state.equipment).toEqual({ weaponItemId: blade.id, armorItemId: vest.id });
    await expect(client.drop(characterId, vest.id, state.revision, 'combat-drop-equipped-vest'))
      .rejects.toThrow('Unequip that item before dropping it.');

    await client.move(characterId, 'reedbank-to-bridge', state.revision, 'combat-gear-return-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.move(characterId, 'bridge-to-clearing', state.revision, 'combat-gear-return-clearing');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.performCombatAction(characterId, 'attack', state.revision, { targetNpcId: 'mossgate-training-sentinel' }, 'combat-gear-first-attack');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(state.combat).toMatchObject({
      opponentHealth: 1,
      playerHealth: 6,
      lastNarration: 'You deal 3 damage to Practice Sentinel. It strikes back for 0 after your armor absorbs 1.',
    });
    await expect(client.equip(characterId, blade.id, state.revision, 'combat-equip-mid-fight'))
      .rejects.toThrow('You cannot change equipment during an active encounter.');
    await client.performCombatAction(characterId, 'attack', state.revision, { encounterId: state.combat!.encounterId }, 'combat-gear-final-attack');
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))?.combat?.status).toBe('victory');
  });
});
