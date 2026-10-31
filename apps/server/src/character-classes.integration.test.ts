import { describe, expect, it } from 'vitest';
import { CharacterClassCatalogSchema, WorldPackDraftSchema, type SessionContext } from '@mudd/contracts';
import {
  EngineHost, InMemoryEventStore, replayCharacter,
  type EnginePlugin, type EventStorePort,
} from '@mudd/engine-core';
import {
  characterPlugin, combatPlugin, createClassRulesetPlugin, interactionPlugin,
  combatRoomPresenceCapability, teamCombatPlugin, teamCombatRosterPolicyCapability,
  worldItemsPlugin, interactionStreamId,
} from '@mudd/core-plugins';
import { orravethClassCatalog, orravethWorld } from '@mudd/world-orraveth';

const worldId = 'class-fixture';
// This opponent and inn exist only in this authorized test world, never in Orraveth.
function fixtureWorld(catalog = orravethClassCatalog, armor = 0, damage = 0) {
  return WorldPackDraftSchema.parse({
    formatVersion: 1, packId: 'fixture.classes', packVersion: '1', displayName: 'Class test fixture',
    classCatalog: catalog,
    currency: { id: 'gold', name: 'gold', symbol: 'g', startingBalance: 50 },
    respawn: { locationId: 'training-room' },
    locations: [{ id: 'training-room', name: 'Training room', description: 'Fixture only.', exits: [],
      inn: { id: 'training-inn', name: 'Training inn', restPrice: 2 },
      npcs: [{ id: 'training-target', name: 'Training target', description: 'Fixture only.',
        greeting: 'Ready.', topics: [], unknownTopicResponse: 'Ready.',
        combatProfile: { maxHealth: 100, attackDamage: damage, style: 'guardian', defense: armor } }],
    }],
  });
}

async function harness(options: { catalog?: typeof orravethClassCatalog; armor?: number; damage?: number } = {}) {
  const catalog = options.catalog ?? orravethClassCatalog;
  const world = fixtureWorld(catalog, options.armor, options.damage);
  const store = new InMemoryEventStore();
  const owners = new Map<string, string>();
  let id = 0;
  const session = (playerId = 'alice', authenticated = true): SessionContext => ({
    playerId, actorId: playerId, sessionId: `session-${playerId}`, worldInstanceId: worldId,
    authenticated, grantedPermissions: [],
  });
  const roster: EnginePlugin = {
    manifest: { id: 'fixture.roster', version: '1.0.0', apiVersion: '1.0', category: 'ruleset',
      provides: [teamCombatRosterPolicyCapability.id, combatRoomPresenceCapability.id] },
    register({ provideCapability }) {
      provideCapability(teamCombatRosterPolicyCapability, {
        resolve: async (_context, characterId) => ({
          sourceGroupId: 'fixture-party', maxPlayers: 4,
          players: [{ characterId, playerId: owners.get(characterId)! }],
        }),
        resolveIfPartyPresent: async () => undefined,
      });
      provideCapability(combatRoomPresenceCapability, {
        listActiveCharacters: async () => [],
        getPresenceAnchors: async () => new Map(),
      });
    },
  };
  const plugins = [worldItemsPlugin, characterPlugin, interactionPlugin, combatPlugin, roster, teamCombatPlugin];
  const authorization = {
    canAccessInstance: async (_session: SessionContext, selected: string) => selected === worldId,
    ownsCharacter: async (actor: SessionContext, characterId: string) => owners.get(characterId) === actor.playerId,
  };
  const makeEngine = (classless = false, eventStore: EventStorePort = store, selectedCatalog = catalog) => new EngineHost(
    [...(!classless ? [createClassRulesetPlugin(selectedCatalog)] : []), ...plugins], eventStore, authorization,
    { ...world, classCatalog: classless ? undefined : selectedCatalog },
    () => `class-fixture-${++id}`,
    () => new Date('2026-10-23T12:00:00.000Z'),
  );
  const engine = makeEngine();
  await engine.start();
  const dispatch = (type: string, characterId?: string, payload: Record<string, unknown> = {},
    player = 'alice', expectedVersion?: number, commandId = `command-${++id}`, host = engine) =>
    host.dispatch({ type, version: 1, worldInstanceId: worldId, commandId, ...(characterId ? { characterId } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}), payload }, session(player));
  const load = async (characterId: string) => replayCharacter(await store.readStream(worldId, characterId))!;
  async function create(classId = catalog.classes[0]!.id, player = 'alice', legacy = false, guest = false) {
    const host = legacy ? makeEngine(true) : engine;
    if (legacy) await host.start();
    const result = await host.dispatch({ type: 'character.create', version: 1, worldInstanceId: worldId,
      commandId: `create-${++id}`, payload: { name: player, ...(!legacy ? { classId } : {}) } }, session(player, !guest));
    expect(result.receipt.ok).toBe(true);
    owners.set(result.streamId!, player);
    if (legacy) await host.stop();
    return result.streamId!;
  }
  const solo = async (characterId: string, action = 'attack', abilityId?: string, commandId?: string) => {
    const character = await load(characterId);
    return dispatch('combat.action', characterId, { action,
      ...(character.combat?.status === 'active' ? { encounterId: character.combat.encounterId } : { targetNpcId: 'training-target' }),
      ...(abilityId ? { abilityId } : {}),
    }, owners.get(characterId), character.revision, commandId);
  };
  async function duel(characterId: string) {
    const other = await create(catalog.classes[0]!.id, 'bob');
    const request = await dispatch('interaction.request', characterId, { kind: 'pvp.challenge', recipientCharacterId: other });
    expect(request.receipt.ok).toBe(true);
    const requestId = (request.events[0]!.payload.request as { requestId: string }).requestId;
    const accepted = await dispatch('interaction.respond', other, { requestId, response: 'accept' }, 'bob');
    expect(accepted.receipt.ok).toBe(true);
    const encounter = accepted.events.find((event) => event.type === 'pvp.encounter.started')!.payload.encounter as { encounterId: string };
    return { other, encounterId: encounter.encounterId };
  }
  return { engine, makeEngine, store, world, create, load, dispatch, solo, duel, owners, session };
}

describe('optional world character classes through authorized hosts', () => {
  it('validates bounded catalogs, duplicate IDs, and incompatible runtime wiring before startup', () => {
    const invalid = structuredClone(orravethClassCatalog);
    invalid.classes[0]!.coreAction.cost.amount = 0;
    expect(CharacterClassCatalogSchema.safeParse(invalid).success).toBe(false);
    invalid.classes[0]!.coreAction.cost.amount = 20;
    invalid.classes[1]!.id = invalid.classes[0]!.id;
    expect(CharacterClassCatalogSchema.safeParse(invalid).success).toBe(false);
    const world = fixtureWorld();
    const auth = { canAccessInstance: async () => true, ownsCharacter: async () => true };
    expect(() => new EngineHost([worldItemsPlugin, characterPlugin], new InMemoryEventStore(), auth, world))
      .toThrow(/capability/);
    expect(() => new EngineHost([createClassRulesetPlugin(orravethClassCatalog), worldItemsPlugin, characterPlugin],
      new InMemoryEventStore(), auth, { ...world, classCatalog: undefined })).toThrow(/catalog/);
    expect(orravethWorld.classCatalog).toEqual(orravethClassCatalog);
    expect(orravethWorld.locations.flatMap((room) => room.npcs ?? []).some((npc) => npc.combatProfile)).toBe(false);
  });

  it.each([false, true])('creates a persisted explicit class for guest=%s and rejects foreign/missing choices', async (guest) => {
    const h = await harness();
    const id = await h.create('orraveth.scout', 'alice', false, guest);
    const character = await h.load(id);
    expect(character.characterClass?.id).toBe('orraveth.scout');
    expect(character.attributes.dexterity).toBe(15);
    expect(character.availableClassActions[0]).toMatchObject({ id: 'orraveth.precise-strike', available: true });
    expect(character.resources).toEqual({ stamina: { current: 100, maximum: 100 }, mana: { current: 100, maximum: 100 } });
    for (const payload of [{ name: 'No class' }, { name: 'Foreign', classId: 'foreign.class' }]) {
      const result = await h.dispatch('character.create', undefined, payload);
      expect(result.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
      expect(result.events).toHaveLength(0);
    }
  });

  it('keeps legacy creation classless and adopts once without recovery, XP, or items under concurrency', async () => {
    const h = await harness();
    const id = await h.create(undefined, 'alice', true);
    const original = await h.load(id);
    expect(original.attributes).toEqual({ strength: 10, intelligence: 10, constitution: 10, dexterity: 10 });
    expect(original.characterClass).toBeUndefined();
    const choices = await Promise.all(['orraveth.vanguard', 'orraveth.scout'].map((classId) =>
      h.dispatch('character.class.choose', id, { classId }, 'alice', original.revision)));
    expect(choices.filter((result) => result.receipt.ok)).toHaveLength(1);
    const adopted = await h.load(id);
    const adoptedClass = orravethClassCatalog.classes.find(({ id: classId }) =>
      classId === adopted.characterClass?.id);
    expect(adoptedClass).toBeDefined();
    const expectedMaximum = Math.max(
      1,
      6 + Math.floor(((adoptedClass?.attributes.constitution ?? 10) - 10) / 5),
    );
    expect(adopted.health).toEqual({ current: 6, maximum: expectedMaximum });
    expect(adopted.resources).toEqual(original.resources);
    expect(adopted.inventory).toEqual(original.inventory);
    expect(adopted.advancement).toEqual(original.advancement);
    expect((await h.dispatch('character.class.choose', id, { classId: 'orraveth.kindler' }, 'alice', adopted.revision)).receipt.ok).toBe(false);
    expect((await h.dispatch('character.class.choose', id, { classId: 'orraveth.kindler' }, 'bob', adopted.revision)).receipt)
      .toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('blocks legacy adoption during team/PvP and pending outcomes without resetting state', async () => {
    for (const mode of ['team', 'pvp'] as const) {
      const h = await harness();
      const id = await h.create(undefined, 'alice', true);
      if (mode === 'team') await h.dispatch('team.combat.start', id, { targetNpcId: 'training-target' });
      else await h.duel(id);
      const before = await h.load(id);
      const result = await h.dispatch('character.class.choose', id, { classId: 'orraveth.vanguard' }, 'alice', before.revision);
      expect(result.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
      expect(await h.load(id)).toEqual(before);
      const foreignWorld = await h.engine.dispatch({ type: 'character.class.choose', version: 1,
        worldInstanceId: 'foreign-world', characterId: id, expectedVersion: before.revision,
        commandId: 'foreign-world', payload: { classId: 'orraveth.vanguard' } }, h.session());
      expect(foreignWorld.receipt).toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('adopts a wounded, resource-depleted legacy character without healing or refilling', async () => {
    const h = await harness({ damage: 1 });
    const id = await h.create(undefined, 'alice', true);
    await h.solo(id);
    await h.solo(id, 'flee');
    const before = await h.load(id);
    const result = await h.dispatch('character.class.choose', id, { classId: 'orraveth.vanguard' }, 'alice', before.revision,
      'adopt-wounded');
    expect(result.receipt.ok).toBe(true);
    const after = await h.load(id);
    expect(after.health).toEqual({ current: 5, maximum: 7 });
    expect(after.resources.stamina.current).toBe(80);
    const repeated = await h.dispatch('character.class.choose', id, { classId: 'orraveth.vanguard' }, 'alice',
      before.revision, 'adopt-wounded');
    expect(repeated.commitOutcome).toBe('duplicate');
    expect(await h.load(id)).toEqual(after);
  });

  it('charges class-world team flee before outcome delivery and delays adoption until that outcome is applied', async () => {
    const h = await harness();
    const id = await h.create(undefined, 'alice', true);
    const started = await h.dispatch('team.combat.start', id, { targetNpcId: 'training-target' });
    const encounterId = (started.events.find((event) => event.type === 'team.combat_started')!.payload.encounter as { encounterId: string }).encounterId;
    expect((await h.dispatch('team.combat.action', id, { encounterId, action: 'flee' })).receipt.ok).toBe(true);
    const escaped = await h.load(id);
    expect(escaped.resources.stamina.current).toBe(80);
    expect((await h.dispatch('character.class.choose', id, { classId: 'orraveth.vanguard' }, 'alice', escaped.revision)).receipt.ok)
      .toBe(false);
    await h.engine.processPendingEffects(100);
    const settled = await h.load(id);
    expect(settled.resources.stamina.current).toBe(80);
    expect((await h.dispatch('character.class.choose', id, { classId: 'orraveth.vanguard' }, 'alice', settled.revision)).receipt.ok)
      .toBe(true);
    const adopted = await h.load(id);
    expect(adopted.resources.stamina.current).toBe(80);
    expect(adopted.health).toEqual({ current: 6, maximum: 7 });
  });

  for (const definition of orravethClassCatalog.classes) {
    it(`${definition.label}: solo damage, resource once, stale/duplicate commands, replay and legacy combat block`, async () => {
      const h = await harness({ armor: 1 });
      const id = await h.create(definition.id);
      expect((await h.solo(id)).receipt.ok).toBe(true);
      const before = await h.load(id);
      const result = await h.solo(id, 'ability', definition.coreAction.id, 'same-ability');
      expect(result.receipt.ok).toBe(true);
      expect(result.events.find((event) => event.type === 'character.combat_action_resolved')?.payload.damageDealt).toBe(3);
      const after = await h.load(id);
      expect(after.resources[definition.coreAction.cost.resource].current).toBe(100 - definition.coreAction.cost.amount);
      expect(after.combat?.round).toBe(before.combat!.round + 1);
      const duplicate = await h.dispatch('combat.action', id, {
        action: 'ability', encounterId: before.combat!.encounterId, abilityId: definition.coreAction.id,
      }, 'alice', before.revision, 'same-ability');
      expect(duplicate.commitOutcome).toBe('duplicate');
      expect(await h.load(id)).toEqual(after);
      const stale = await h.dispatch('combat.action', id, {
        action: 'ability', encounterId: before.combat!.encounterId, abilityId: definition.coreAction.id,
      }, 'alice', before.revision);
      expect(stale.receipt).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
      const foreign = await h.solo(id, 'ability', 'not-owned');
      expect(foreign.receipt.ok).toBe(false);
      expect(await h.load(id)).toEqual(after);
      const legacy = await h.create(undefined, 'legacy', true);
      await h.solo(legacy);
      expect((await h.dispatch('character.class.choose', legacy, { classId: definition.id },
        'legacy', (await h.load(legacy)).revision)).receipt.ok).toBe(false);
      const changed = structuredClone(orravethClassCatalog);
      changed.revision += 1;
      changed.classes.find((entry) => entry.id === definition.id)!.coreAction.baseDamage = 9;
      const restarted = h.makeEngine(false, h.store, changed);
      await restarted.start();
      const replayedAction = await h.dispatch('combat.action', id, { action: 'ability',
        encounterId: after.combat!.encounterId, abilityId: definition.coreAction.id },
      'alice', after.revision, undefined, restarted);
      expect(replayedAction.events.find((event) => event.type === 'character.combat_action_resolved')?.payload.damageDealt).toBe(3);
      // Replay of the pre-change history never consults changed catalogs.
      expect(replayCharacter((await h.store.readStream(worldId, id)).slice(0, after.revision))).toEqual(after);
    });

    it(`${definition.label}: team turns commit a character debit atomically, reject invalid targets/actors and replay effects`, async () => {
      const h = await harness({ armor: 1 });
      const id = await h.create(definition.id);
      const started = await h.dispatch('team.combat.start', id, { targetNpcId: 'training-target' });
      expect(started.receipt.ok).toBe(true);
      const encounterId = (started.events.find((event) => event.type === 'team.combat_started')!.payload.encounter as { encounterId: string }).encounterId;
      const before = await h.load(id);
      const invalid = await h.dispatch('team.combat.action', id, {
        encounterId, action: 'ability', abilityId: definition.coreAction.id, targetParticipantId: id,
      });
      expect(invalid.receipt.ok).toBe(false);
      expect(await h.load(id)).toEqual(before);
      const command = { encounterId, action: 'ability', abilityId: definition.coreAction.id };
      const results = await Promise.all([h.dispatch('team.combat.action', id, command, 'alice', undefined, 'team-once'),
        h.dispatch('team.combat.action', id, command, 'alice', undefined, 'team-once')]);
      expect(results.every((result) => result.receipt.ok)).toBe(true);
      const after = await h.load(id);
      expect(after.resources[definition.coreAction.cost.resource].current).toBe(100 - definition.coreAction.cost.amount);
      const history = await h.store.readStream(worldId, 'world-team-combat');
      expect(history.filter((event) => event.type === 'team.combat_action_resolved')).toHaveLength(1);
      expect(history.at(-1)!.payload.damageDealt).toBe(3);
      await h.engine.processPendingEffects(100);
      expect(await h.load(id)).toEqual(after);
      expect((await h.dispatch('team.combat.action', id, command, 'bob')).receipt).toMatchObject({ code: 'FORBIDDEN' });
    });

    it(`${definition.label}: accepted PvP respects turn/consent, armor and duplicate ability spending`, async () => {
      const h = await harness();
      const id = await h.create(definition.id);
      const { other, encounterId } = await h.duel(id);
      const command = { encounterId, action: 'ability', abilityId: definition.coreAction.id };
      expect((await h.dispatch('pvp.action', other, command, 'bob')).receipt.ok).toBe(false);
      const result = await h.dispatch('pvp.action', id, command, 'alice', undefined, 'pvp-once');
      expect(result.receipt.ok).toBe(true);
      expect((await h.dispatch('pvp.action', id, command, 'alice', undefined, 'pvp-once')).commitOutcome).toBe('duplicate');
      const character = await h.load(id);
      expect(character.resources[definition.coreAction.cost.resource].current).toBe(100 - definition.coreAction.cost.amount);
      const events = await h.store.readStream(worldId, interactionStreamId(worldId));
      const encounter = events.at(-1)!.payload.encounter as { participants: { health: number }[]; round: number };
      expect(encounter.participants[1]!.health).toBe(3);
      expect(encounter.round).toBe(1);
      expect(character.advancement).toBeUndefined();
    });

    it(`${definition.label}: insufficient resources reject all three modes without partial effects; free Attack, level-up and inn still work`, async () => {
      const h = await harness();
      const id = await h.create(definition.id);
      await h.solo(id);
      const uses = Math.floor(100 / definition.coreAction.cost.amount);
      for (let count = 0; count < uses; count++) {
        expect((await h.solo(id, 'ability', definition.coreAction.id)).receipt.ok).toBe(true);
      }
      const empty = await h.load(id);
      expect(empty.availableClassActions[0]!.available).toBe(false);
      const invalid = await h.solo(id, 'ability', definition.coreAction.id);
      expect(invalid.receipt.ok).toBe(false);
      expect(await h.load(id)).toEqual(empty);
      // Ordinary Attack needs no class resource.
      while ((await h.load(id)).combat?.status === 'active') expect((await h.solo(id)).receipt.ok).toBe(true);
      const advanced = await h.load(id);
      const started = await h.dispatch('team.combat.start', id, { targetNpcId: 'training-target' });
      const encounterId = (started.events.find((event) => event.type === 'team.combat_started')!.payload.encounter as { encounterId: string }).encounterId;
      const beforeShared = await h.store.readStream(worldId, 'world-team-combat');
      expect((await h.dispatch('team.combat.action', id, {
        encounterId, action: 'ability', abilityId: definition.coreAction.id,
      })).receipt.ok).toBe(false);
      expect(await h.store.readStream(worldId, 'world-team-combat')).toEqual(beforeShared);
      const afterRejectedAction = await h.load(id);
      expect(afterRejectedAction.resources).toEqual(advanced.resources);
      expect(afterRejectedAction.combat).toEqual(advanced.combat);
      // End via ordinary attacks, avoiding flee's separate stamina requirement.
      for (let count = 0; count < 100; count++) {
        const result = await h.dispatch('team.combat.action', id, { encounterId, action: 'attack' });
        expect(result.receipt.ok).toBe(true);
        if (result.events.some((event) => event.type === 'team.combat_ended')) break;
      }
      await h.engine.processPendingEffects(100);
      const levelled = await h.load(id);
      expect(levelled.advancement?.level).toBe(2);
      expect(levelled.attributes).toEqual(definition.attributes);
      expect(levelled.health?.maximum).toBe(definition.id === 'orraveth.vanguard' ? 9 : 8);
      expect(levelled.resources).toEqual(empty.resources);
      const duel = await h.duel(id);
      const beforePvp = await h.store.readStream(worldId, interactionStreamId(worldId));
      expect((await h.dispatch('pvp.action', id, {
        encounterId: duel.encounterId, action: 'ability', abilityId: definition.coreAction.id,
      })).receipt.ok).toBe(false);
      expect(await h.store.readStream(worldId, interactionStreamId(worldId))).toEqual(beforePvp);
      await h.dispatch('pvp.action', id, { encounterId: duel.encounterId, action: 'flee' });
      await h.engine.processPendingEffects(100);
      const beforeRest = await h.load(id);
      expect(beforeRest.advancement).toEqual(levelled.advancement);
      const rested = await h.dispatch('inn.rest', id, { innId: 'training-inn' }, 'alice', beforeRest.revision);
      expect(rested.receipt.ok).toBe(true);
      const afterRest = await h.load(id);
      expect(afterRest.resources[definition.coreAction.cost.resource].current).toBe(100);
      expect(afterRest.wallet!.balance).toBe(beforeRest.wallet!.balance - 2);
      expect(afterRest.characterClass).toEqual(empty.characterClass);
      expect(afterRest.health!.current).toBe(afterRest.health!.maximum);
    });

    it(`${definition.label}: death/respawn retains class and paid resource cost`, async () => {
      const h = await harness({ damage: 100 });
      const id = await h.create(definition.id);
      // Starting Attack resolves death immediately, but respawn is part of the same character append.
      await h.solo(id);
      const respawned = await h.load(id);
      expect(respawned.characterClass?.id).toBe(definition.id);
      // Road-start event is not needed: use a fixture opponent with heavy windup to survive the first turn.
      const target = h.world.locations[0]!.npcs![0]!;
      target.combatProfile!.style = 'heavy';
      await h.solo(id);
      const result = await h.solo(id, 'ability', definition.coreAction.id);
      expect(result.receipt.ok).toBe(true);
      const after = await h.load(id);
      expect(after.characterClass).toEqual(respawned.characterClass);
      expect(after.resources[definition.coreAction.cost.resource].current).toBe(100 - definition.coreAction.cost.amount);
      expect(after.health).toEqual(respawned.health);
      expect(after.combat).toBeUndefined();
      expect(result.events.map((event) => event.type)).toContain('character.respawned');
    });
  }
});
