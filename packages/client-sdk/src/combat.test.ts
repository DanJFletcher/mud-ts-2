import { describe, expect, it } from 'vitest';
import { CharacterStaminaSpentEventSchema, FLEE_STAMINA_COST } from '@mudd/contracts';
import { EngineHost, InMemoryEventStore, replayCharacter, type EnginePlugin } from '@mudd/engine-core';
import {
  characterPlugin,
  combatPlugin,
  combatRoomPresenceCapability,
  groupsPlugin,
  interactionPlugin,
  merchantPlugin,
  movementPlugin,
  partyCombatPolicyPlugin,
  partyPlugin,
  partyQuestPlugin,
  roadTravelPlugin,
  teamCombatPlugin,
  worldItemsPlugin,
} from '@mudd/core-plugins';
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

const testCombatPresencePlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.room-combat-presence',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    provides: [combatRoomPresenceCapability.id],
  },
  register({ provideCapability }) {
    provideCapability(combatRoomPresenceCapability, {
      listActiveCharacters: async () => [],
    });
  },
};

const testPlugins = [
  worldItemsPlugin,
  characterPlugin,
  groupsPlugin,
  partyPlugin,
  partyQuestPlugin,
  interactionPlugin,
  combatPlugin,
  testCombatPresencePlugin,
  partyCombatPolicyPlugin,
  teamCombatPlugin,
  movementPlugin,
  roadTravelPlugin,
  merchantPlugin,
];

const demoRoadRoutes = {
  'fountain-to-clearing': ['fountain-to-stillwater-path', 'stillwater-path-to-clearing'],
  'clearing-to-bridge': ['clearing-to-glasswater-road', 'glasswater-approach-to-bridge'],
  'bridge-to-clearing': ['bridge-to-glasswater-road', 'glasswater-approach-to-clearing'],
  'bridge-to-tower-west': [
    'bridge-to-glasswater-road',
    'glasswater-approach-to-clearing',
    'clearing-to-bellwarden-track',
    'bellwarden-track-to-tower-west',
  ],
  'bell-tower-west-to-bridge': [
    'bell-tower-west-to-bellwarden-track',
    'bellwarden-track-to-clearing',
    'clearing-to-glasswater-road',
    'glasswater-approach-to-bridge',
  ],
  'clearing-to-tower-west': ['clearing-to-bellwarden-track', 'bellwarden-track-to-tower-west'],
  'bell-tower-west-to-clearing': ['bell-tower-west-to-bellwarden-track', 'bellwarden-track-to-clearing'],
  'bridge-to-reedbank': ['bridge-to-reedbank-road', 'reedbank-road-to-stalls'],
  'reedbank-to-bridge': ['reedbank-to-reedbank-road', 'reedbank-road-to-bridge'],
  'reedbank-to-willowrest': ['reedbank-to-willowrest-lane', 'willowrest-lane-to-inn'],
  'willowrest-to-reedbank': ['willowrest-to-lane', 'willowrest-lane-to-reedbank'],
} as const;

type DemoRoadRoute = keyof typeof demoRoadRoutes;

async function moveAlongDemoRoad(
  client: MuddHttpClient,
  characterId: string,
  route: DemoRoadRoute,
  expectedVersion: number,
  commandId: string,
) {
  let result;
  for (const [index, exitId] of demoRoadRoutes[route].entries()) {
    result = await client.roadStep(
      characterId,
      exitId,
      expectedVersion + index,
      `${commandId}-step-${index + 1}`,
    );
    if (!result.receipt.ok) return result;
  }
  return result!;
}

function makeClient(world = demoWorld) {
  const store = new InMemoryEventStore();
  const testWorld = structuredClone(world);
  for (const road of testWorld.roads ?? []) road.encounterChancePercent = 0;
  const engine = new EngineHost(
    testPlugins,
    store,
    { canAccessInstance: async () => true, ownsCharacter: async () => true },
    testWorld,
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
  return { client, store, engine };
}

async function travelToWillowrestInn(
  client: MuddHttpClient,
  store: InMemoryEventStore,
  characterId: string,
  commandPrefix: string,
  beginInjured = true,
) {
  let state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
  if (beginInjured) {
    const room = await client.look(characterId, `${commandPrefix}-look-clearing`);
    await client.performCombatAction(
      characterId,
      'attack',
      room.revision,
      { targetNpcId: 'mossgate-training-sentinel' },
      `${commandPrefix}-attack`,
    );
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await client.performCombatAction(
      characterId,
      'flee',
      state.revision,
      { encounterId: state.combat!.encounterId },
      `${commandPrefix}-flee`,
    );
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
  }

  const path: DemoRoadRoute[] = [
    'clearing-to-bridge',
    'bridge-to-reedbank',
    'reedbank-to-willowrest',
  ];
  for (const [index, route] of path.entries()) {
    await moveAlongDemoRoad(client, characterId, route, state.revision, `${commandPrefix}-move-${index}`);
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
  }
  return state;
}

async function spendStaminaForTest(
  store: InMemoryEventStore,
  characterId: string,
  causeId: string,
  staminaSpent = FLEE_STAMINA_COST,
) {
  const state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
  const payload = CharacterStaminaSpentEventSchema.shape.payload.parse({
    characterId,
    cause: 'team-flee',
    causeId,
    staminaSpent,
    resources: {
      ...state.resources,
      stamina: {
        ...state.resources.stamina,
        current: state.resources.stamina.current - staminaSpent,
      },
    },
  });
  const result = await store.append({
    worldInstanceId: DEMO_WORLD_INSTANCE_ID,
    streamId: characterId,
    actorId: 'test:resource-setup',
    commandId: `test-stamina-${causeId}`,
    payloadHash: `${characterId}:${causeId}:${staminaSpent}`,
    expectedVersion: state.revision,
    events: [{ type: 'character.stamina_spent', version: 1, payload }],
  });
  if (!result.receipt.ok) throw new Error('Could not prepare stamina test state.');
  return replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
}

describe('turn-based PvE combat', () => {
  it('spends 20 stamina once when fleeing solo combat and rejects an unaffordable flee', async () => {
    const { client, store } = makeClient();
    const created = await client.createCharacter('Briar', 'stamina-flee-create');
    const characterId = created.streamId!;
    const room = await client.look(characterId, 'stamina-flee-look');
    await client.performCombatAction(
      characterId,
      'attack',
      room.revision,
      { targetNpcId: 'mossgate-training-sentinel' },
      'stamina-flee-start',
    );
    const active = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    const flee = await client.performCombatAction(
      characterId,
      'flee',
      active.revision,
      { encounterId: active.combat!.encounterId },
      'stamina-flee-once',
    );
    const fled = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(fled).toMatchObject({
      combat: { status: 'fled' },
      resources: { stamina: { current: 80, maximum: 100 } },
    });
    const retry = await client.performCombatAction(
      characterId,
      'flee',
      active.revision,
      { encounterId: active.combat!.encounterId },
      'stamina-flee-once',
    );
    expect(retry.receipt).toEqual(flee.receipt);
    expect((await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))
      .filter((event) => event.type === 'character.stamina_spent')).toHaveLength(1);

    for (let index = 0; index < 4; index += 1) {
      await spendStaminaForTest(store, characterId, `exhaust-${index}`);
    }
    const exhausted = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(exhausted.resources.stamina.current).toBe(0);
    const newRoom = await client.look(characterId, 'stamina-flee-look-again');
    await client.performCombatAction(
      characterId,
      'attack',
      newRoom.revision,
      { targetNpcId: 'mossgate-training-sentinel' },
      'stamina-flee-start-again',
    );
    const activeWithoutStamina = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    const eventCount = (await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).length;
    await expect(client.performCombatAction(
      characterId,
      'flee',
      activeWithoutStamina.revision,
      { encounterId: activeWithoutStamina.combat!.encounterId },
      'stamina-flee-unaffordable',
    )).rejects.toThrow(`You need ${FLEE_STAMINA_COST} stamina to flee.`);
    expect(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).toHaveLength(eventCount);
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))?.combat?.status)
      .toBe('active');
  });

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
    await expect(client.roadStep(firstId, 'clearing-to-glasswater-road', firstState.revision, 'combat-move-during'))
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
    await expect(moveAlongDemoRoad(client, firstId, 'clearing-to-bridge', wonState.revision, 'combat-move-after'))
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
    await expect(moveAlongDemoRoad(client, secondId, 'clearing-to-bridge', fledState.revision, 'combat-move-after-flee'))
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

    await moveAlongDemoRoad(client, characterId, 'clearing-to-bridge', state.revision, 'combat-potion-to-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await moveAlongDemoRoad(client, characterId, 'bridge-to-reedbank', state.revision, 'combat-potion-to-stalls');
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

    await moveAlongDemoRoad(client, characterId, 'reedbank-to-bridge', state.revision, 'combat-potion-back-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await moveAlongDemoRoad(client, characterId, 'bridge-to-clearing', state.revision, 'combat-potion-back-clearing');
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
    await moveAlongDemoRoad(client, characterId, 'clearing-to-bridge', state.revision, 'combat-potion-outside-to-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await moveAlongDemoRoad(client, characterId, 'bridge-to-reedbank', state.revision, 'combat-potion-outside-to-stalls');
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

    await moveAlongDemoRoad(client, characterId, 'reedbank-to-bridge', state.revision, 'combat-potion-outside-back-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await moveAlongDemoRoad(client, characterId, 'bridge-to-clearing', state.revision, 'combat-potion-outside-back-clearing');
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
    await moveAlongDemoRoad(client, characterId, 'clearing-to-bridge', state.revision, 'combat-potion-full-to-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await moveAlongDemoRoad(client, characterId, 'bridge-to-reedbank', state.revision, 'combat-potion-full-to-stalls');
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
    await moveAlongDemoRoad(client, characterId, 'reedbank-to-bridge', state.revision, 'combat-potion-full-back-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await moveAlongDemoRoad(client, characterId, 'bridge-to-clearing', state.revision, 'combat-potion-full-back-clearing');
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

  it('creates a searchable shared corpse and awards its item and currency loot once', async () => {
    const lootWorld = {
      ...demoWorld,
      locations: demoWorld.locations.map((location) => location.id !== 'mossgate-clearing'
        ? location
        : {
          ...location,
          npcs: location.npcs?.map((npc) => npc.id !== 'mossgate-training-sentinel'
            ? npc
            : {
              ...npc,
              loot: {
                items: [{
                  id: 'test-sentinel-badge',
                  label: 'Practice badge',
                  description: 'A small wooden badge from the training ground.',
                }],
                currencyAmount: 3,
              },
            }),
        }),
    };
    const { client, store, engine } = makeClient(lootWorld);
    const created = await client.createCharacter('Briar', 'combat-corpse-create');
    const characterId = created.streamId!;
    let character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    let action = 0;
    do {
      await client.performCombatAction(
        characterId,
        'attack',
        character.revision,
        character.combat?.status === 'active'
          ? { encounterId: character.combat.encounterId }
          : { targetNpcId: 'mossgate-training-sentinel' },
        `combat-corpse-action-${++action}`,
      );
      character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    } while (character.combat?.status !== 'victory');
    await engine.processPendingEffects();

    const room = await client.look(characterId, 'combat-corpse-look');
    const corpse = room.objects.find((object) => object.containerKind === 'corpse');
    expect(corpse).toMatchObject({
      label: 'Practice Sentinel’s corpse',
      takeable: false,
      contents: expect.arrayContaining([
        expect.objectContaining({ label: 'Practice badge' }),
        expect.objectContaining({ label: `3 ${demoWorld.currency!.name}` }),
      ]),
    });
    const details = await client.inspect(characterId, corpse!.id, 'combat-corpse-inspect');
    expect(details.description).toContain('Practice badge');
    expect(details.description).toContain(`3 ${demoWorld.currency!.name}`);

    const badge = corpse!.contents!.find((content) => content.label === 'Practice badge')!;
    const gold = corpse!.contents!.find((content) => content.label.startsWith('3 '))!;
    await client.take(characterId, badge.id, character.revision, 'combat-corpse-take-badge');
    await engine.processPendingEffects();
    character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(character.inventory).toContainEqual(expect.objectContaining({
      label: 'Practice badge',
      sharedItemId: badge.id,
    }));

    const second = await client.createCharacter('Moss', 'combat-corpse-second-character');
    const secondCharacterId = second.streamId!;
    const secondCharacter = replayCharacter(
      await store.readStream(DEMO_WORLD_INSTANCE_ID, secondCharacterId),
    )!;
    const goldClaims = await Promise.allSettled([
      client.take(characterId, gold.id, character.revision, 'combat-corpse-take-gold-first'),
      client.take(secondCharacterId, gold.id, secondCharacter.revision, 'combat-corpse-take-gold-second'),
    ]);
    expect(goldClaims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(1);
    await engine.processPendingEffects();
    const finalCharacters = [
      replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!,
      replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, secondCharacterId))!,
    ];
    expect(finalCharacters.reduce((sum, candidate) => sum + candidate.wallet!.balance, 0))
      .toBe(demoWorld.currency!.startingBalance * 2 + 3);
    expect(finalCharacters.filter((candidate) => candidate.claimedCorpseGoldIds.length > 0))
      .toHaveLength(1);
    const corpses = (await store.readStream(DEMO_WORLD_INSTANCE_ID, 'world-items'))
      .filter((event) => event.type === 'world.corpse_created');
    expect(corpses).toHaveLength(1);
    expect((await store.readStream(DEMO_WORLD_INSTANCE_ID, 'world-items'))
      .filter((event) => event.type === 'world.corpse_gold_claimed')).toHaveLength(1);
    await engine.stop();
  });

  it('respawns the same character at the fountain after defeat', async () => {
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

    expect(state.locationId).toBe('stillwater-fountain');
    expect(state.health).toEqual({ current: 6, maximum: 6 });
    expect(state.combat).toBeUndefined();
    expect(state.visitedLocationIds).toContain('stillwater-fountain');
    expect((await moveAlongDemoRoad(
      client,
      characterId,
      'fountain-to-clearing',
      state.revision,
      'combat-respawn-return',
    )).receipt.ok).toBe(true);
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))?.locationId)
      .toBe('mossgate-clearing');
  });

  it('persists character equipment and applies weapon and armor bonuses to combat', async () => {
    const { client, store } = makeClient();
    const created = await client.createCharacter('Briar', 'combat-gear-create');
    const characterId = created.streamId!;
    let state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;

    await moveAlongDemoRoad(client, characterId, 'clearing-to-bridge', state.revision, 'combat-gear-to-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await moveAlongDemoRoad(client, characterId, 'bridge-to-reedbank', state.revision, 'combat-gear-to-stalls');
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

    await moveAlongDemoRoad(client, characterId, 'reedbank-to-bridge', state.revision, 'combat-gear-return-bridge');
    state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await moveAlongDemoRoad(client, characterId, 'bridge-to-clearing', state.revision, 'combat-gear-return-clearing');
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

describe('paid inn rest', () => {
  it('charges five moss marks, restores health atomically, and retries without charging twice', async () => {
    const { client, store } = makeClient();
    const created = await client.createCharacter('Briar', 'inn-rest-create');
    const characterId = created.streamId!;
    const injuredAtInn = await travelToWillowrestInn(client, store, characterId, 'inn-rest');
    expect(injuredAtInn).toMatchObject({
      locationId: 'willowrest-inn',
      health: { current: 5, maximum: 6 },
      resources: {
        stamina: { current: 80, maximum: 100 },
        mana: { current: 100, maximum: 100 },
      },
      wallet: { currencyId: 'moss-mark', balance: 12 },
      visitedLocationIds: expect.arrayContaining(['willowrest-inn']),
    });

    const innRoom = await client.look(characterId, 'inn-rest-look-inn');
    expect(innRoom.inn).toMatchObject({
      id: 'willowrest-inn-service',
      name: 'Willowrest Inn',
      restPrice: 5,
      currency: { id: 'moss-mark', name: 'moss mark', symbol: 'm' },
    });

    const rest = await client.restAtInn(
      characterId,
      'willowrest-inn-service',
      injuredAtInn.revision,
      'inn-rest-paid',
    );
    expect(rest.receipt.ok).toBe(true);
    const rested = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(rested).toMatchObject({
      locationId: 'willowrest-inn',
      health: { current: 6, maximum: 6 },
      resources: {
        stamina: { current: 100, maximum: 100 },
        mana: { current: 100, maximum: 100 },
      },
      wallet: { currencyId: 'moss-mark', balance: 7 },
    });
    const restEvent = (await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))
      .find((event) => event.type === 'character.inn_rest_completed');
    expect(restEvent).toMatchObject({
      type: 'character.inn_rest_completed',
      version: 2,
      payload: {
        characterId,
        locationId: 'willowrest-inn',
        innId: 'willowrest-inn-service',
        currencyId: 'moss-mark',
        price: 5,
        healthRestored: 1,
        staminaRestored: 20,
        manaRestored: 0,
        health: { current: 6, maximum: 6 },
        resources: {
          stamina: { current: 100, maximum: 100 },
          mana: { current: 100, maximum: 100 },
        },
      },
    });

    const eventCount = (await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).length;
    const retry = await client.restAtInn(
      characterId,
      'willowrest-inn-service',
      injuredAtInn.revision,
      'inn-rest-paid',
    );
    expect(retry.receipt).toEqual(rest.receipt);
    expect(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).toHaveLength(eventCount);
  });

  it('restores stamina at an inn even when health is already full', async () => {
    const { client, store } = makeClient();
    const created = await client.createCharacter('Rowan', 'inn-rest-stamina-only-create');
    const characterId = created.streamId!;
    await spendStaminaForTest(store, characterId, 'inn-rest-stamina-only-flee');
    const atInn = await travelToWillowrestInn(client, store, characterId, 'inn-rest-stamina-only', false);
    expect(atInn.health).toBeUndefined();
    expect(atInn.resources.stamina.current).toBe(80);

    const rest = await client.restAtInn(
      characterId,
      'willowrest-inn-service',
      atInn.revision,
      'inn-rest-stamina-only',
    );
    expect(rest.receipt.ok).toBe(true);
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))).toMatchObject({
      health: { current: 6, maximum: 6 },
      resources: {
        stamina: { current: 100, maximum: 100 },
        mana: { current: 100, maximum: 100 },
      },
    });
  });

  it('prevents concurrent rest requests from spending the same balance twice', async () => {
    const { client, store } = makeClient();
    const created = await client.createCharacter('Ash', 'inn-rest-concurrent-create');
    const characterId = created.streamId!;
    const state = await travelToWillowrestInn(client, store, characterId, 'inn-rest-concurrent');
    const eventCount = (await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).length;

    const results = await Promise.allSettled([
      client.restAtInn(characterId, 'willowrest-inn-service', state.revision, 'inn-rest-concurrent-a'),
      client.restAtInn(characterId, 'willowrest-inn-service', state.revision, 'inn-rest-concurrent-b'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).toHaveLength(eventCount + 1);
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))).toMatchObject({
      health: { current: 6, maximum: 6 },
      wallet: { currencyId: 'moss-mark', balance: 7 },
    });
  });

  it('rejects resting away from the inn, at full health, during combat, or without enough money', async () => {
    const { client, store } = makeClient();
    const created = await client.createCharacter('Alder', 'inn-rest-invalid-create');
    const characterId = created.streamId!;
    let state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    await expect(client.restAtInn(characterId, 'willowrest-inn-service', state.revision, 'inn-rest-away'))
      .rejects.toThrow('There is no such inn here.');
    expect(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).toHaveLength(1);

    state = await travelToWillowrestInn(client, store, characterId, 'inn-rest-full', false);
    const fullHealthEventCount = (await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).length;
    await expect(client.restAtInn(characterId, 'willowrest-inn-service', state.revision, 'inn-rest-full'))
      .rejects.toThrow('Your health, stamina, and mana are already full.');
    expect(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).toHaveLength(fullHealthEventCount);

    const poorWorld = {
      ...demoWorld,
      currency: { ...demoWorld.currency!, startingBalance: 4 },
    };
    const poor = makeClient(poorWorld);
    const poorCharacter = await poor.client.createCharacter('Cedar', 'inn-rest-poor-create');
    const poorId = poorCharacter.streamId!;
    const poorAtInn = await travelToWillowrestInn(poor.client, poor.store, poorId, 'inn-rest-poor');
    const beforeFailedRest = (await poor.store.readStream(DEMO_WORLD_INSTANCE_ID, poorId)).length;
    await expect(poor.client.restAtInn(
      poorId,
      'willowrest-inn-service',
      poorAtInn.revision,
      'inn-rest-unaffordable',
    )).rejects.toThrow('You need 5 moss marks to rest.');
    const unchangedPoor = replayCharacter(await poor.store.readStream(DEMO_WORLD_INSTANCE_ID, poorId))!;
    expect(unchangedPoor).toMatchObject({
      health: { current: 5, maximum: 6 },
      wallet: { currencyId: 'moss-mark', balance: 4 },
    });
    expect(await poor.store.readStream(DEMO_WORLD_INSTANCE_ID, poorId)).toHaveLength(beforeFailedRest);
  });

  it('rejects inn rest while a combat encounter is active', async () => {
    const { client, store } = makeClient();
    const created = await client.createCharacter('Willow', 'inn-rest-combat-create');
    const characterId = created.streamId!;
    const room = await client.look(characterId, 'inn-rest-combat-look');
    await client.performCombatAction(
      characterId,
      'attack',
      room.revision,
      { targetNpcId: 'mossgate-training-sentinel' },
      'inn-rest-combat-start',
    );
    const state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    const eventCount = (await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).length;
    await expect(client.restAtInn(
      characterId,
      'willowrest-inn-service',
      state.revision,
      'inn-rest-during-combat',
    )).rejects.toThrow('You cannot rest while combat is active. Flee first.');
    expect(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId)).toHaveLength(eventCount);
  });
});
