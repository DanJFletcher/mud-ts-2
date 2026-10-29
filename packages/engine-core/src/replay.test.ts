import { describe, expect, it } from 'vitest';
import type { StoredGameEvent } from './types.js';
import { replayCharacter } from './replay.js';
import { resolveStaminaRecovery, resolveVitalRecovery } from '@mudd/contracts';

function event(
  type: string,
  aggregateVersion: number,
  payload: Record<string, unknown>,
  version = 1,
  occurredAt = '2026-10-18T12:00:00.000Z',
): StoredGameEvent {
  return {
    type,
    version,
    eventId: `event-${aggregateVersion}`,
    worldInstanceId: 'world-test',
    streamId: 'character-test',
    aggregateId: 'character-test',
    aggregateVersion,
    causationCommandId: `command-${aggregateVersion}`,
    actorId: 'player-test',
    occurredAt,
    tick: 0,
    payload,
  };
}

const created = event('character.created', 1, {
  characterId: 'character-test',
  playerId: 'player-test',
  name: 'Rowan',
  startingLocationId: 'mossgate-clearing',
});

describe('character event replay validation', () => {
  it('rejects a class creation event with attributes that differ from its recorded class snapshot', () => {
    const attributes = { strength: 10, intelligence: 10, constitution: 10, dexterity: 10 };
    const characterClass = {
      id: 'replay-scout',
      revision: 1,
      catalogId: 'replay-catalog',
      catalogRevision: 1,
      label: 'Scout',
      description: 'A replay fixture.',
      primaryAttribute: 'dexterity',
      attributes,
      coreAction: {
        id: 'replay-action',
        revision: 1,
        label: 'Quick strike',
        description: 'A test action.',
        cost: { resource: 'stamina', amount: 1 },
        baseDamage: 1,
        scalingAttribute: 'dexterity',
        weaponBonus: false,
      },
    };

    expect(() => replayCharacter([
      event('character.created', 1, {
        characterId: 'character-test',
        playerId: 'player-test',
        name: 'Rowan',
        startingLocationId: 'mossgate-clearing',
        attributes: { ...attributes, strength: 11 },
        characterClass,
        health: { current: 6, maximum: 6 },
        resources: {
          stamina: { current: 100, maximum: 100 },
          mana: { current: 100, maximum: 100 },
        },
      }, 3),
    ])).toThrow('Class creation attributes must match its recorded snapshot.');
  });

  it('replays legacy stamina defaults, exact recovery, posture transitions, and movement restrictions', () => {
    const start = new Date('2026-10-18T12:00:00.000Z');
    const createdV2 = event('character.created', 1, {
      characterId: 'character-test',
      playerId: 'player-test',
      name: 'Rowan',
      startingLocationId: 'mossgate-clearing',
      resources: {
        stamina: { current: 0, maximum: 100 },
        mana: { current: 100, maximum: 100 },
      },
    }, 2);
    const legacy = replayCharacter([created]);
    expect(legacy?.staminaRecovery).toEqual({
      posture: 'standing',
      lastSettledAt: null,
      fractionalCarry: 0,
      healthFractionalCarry: 0,
      manaFractionalCarry: 0,
    });

    const initial = replayCharacter([createdV2])!;
    const anchored = resolveStaminaRecovery(
      initial.resources.stamina,
      initial.staminaRecovery,
      start,
    );
    const initialAnchor = event('character.stamina_recovery_settled', 2, {
      characterId: initial.characterId,
      resources: { ...initial.resources, stamina: anchored.stamina },
      recovery: anchored.recovery,
    }, 1, start.toISOString());
    const anchoredProjection = replayCharacter([createdV2, initialAnchor])!;
    const standingRecoveryAt = new Date(start.getTime() + 1_000);
    const standing = resolveStaminaRecovery(
      anchoredProjection.resources.stamina,
      anchoredProjection.staminaRecovery,
      standingRecoveryAt,
    );
    const standingEvent = event('character.stamina_recovery_settled', 3, {
      characterId: initial.characterId,
      resources: { ...anchoredProjection.resources, stamina: standing.stamina },
      recovery: standing.recovery,
    }, 1, standingRecoveryAt.toISOString());
    const postureEvent = event('character.posture_changed', 4, {
      characterId: initial.characterId,
      posture: 'resting',
      locationId: initial.locationId,
    }, 1, standingRecoveryAt.toISOString());
    const afterRest = replayCharacter([createdV2, initialAnchor, standingEvent, postureEvent])!;
    expect(afterRest.resources.stamina.current).toBe(1);
    expect(afterRest.staminaRecovery.posture).toBe('resting');

    const restingRecoveryAt = new Date(start.getTime() + 2_000);
    const rested = resolveStaminaRecovery(
      afterRest.resources.stamina,
      afterRest.staminaRecovery,
      restingRecoveryAt,
    );
    const restingEvent = event('character.stamina_recovery_settled', 5, {
      characterId: initial.characterId,
      resources: { ...afterRest.resources, stamina: rested.stamina },
      recovery: rested.recovery,
    }, 1, restingRecoveryAt.toISOString());
    expect(replayCharacter([createdV2, initialAnchor, standingEvent, postureEvent, restingEvent])?.resources.stamina.current).toBe(4);
    expect(() => replayCharacter([
      createdV2,
      initialAnchor,
      standingEvent,
      postureEvent,
      restingEvent,
      event('character.moved', 6, {
        characterId: initial.characterId,
        fromLocationId: initial.locationId,
        toLocationId: 'glasswater-bridge',
        exitId: 'clearing-to-bridge',
        movementCost: 5,
      }),
    ])).toThrow(/invalid movement event/i);
  });

  it('replays new all-vital recovery without reinterpreting historical stamina-only events', () => {
    const start = new Date('2026-10-18T12:00:00.000Z');
    const attributes = { strength: 10, intelligence: 10, constitution: 10, dexterity: 10 };
    const characterClass = {
      id: 'replay-scout',
      revision: 1,
      catalogId: 'replay-catalog',
      catalogRevision: 1,
      label: 'Scout',
      description: 'A replay fixture.',
      primaryAttribute: 'dexterity',
      attributes,
      coreAction: {
        id: 'replay-action',
        revision: 1,
        label: 'Quick strike',
        description: 'A test action.',
        cost: { resource: 'stamina', amount: 1 },
        baseDamage: 1,
        scalingAttribute: 'dexterity',
        weaponBonus: false,
      },
    };
    const createdWithVitals = event('character.created', 1, {
      characterId: 'character-test',
      playerId: 'player-test',
      name: 'Rowan',
      startingLocationId: 'mossgate-clearing',
      attributes,
      characterClass,
      health: { current: 1, maximum: 6 },
      resources: {
        stamina: { current: 50, maximum: 100 },
        mana: { current: 40, maximum: 100 },
      },
    }, 3);
    const initial = replayCharacter([createdWithVitals])!;
    const oldStaminaOnly = resolveStaminaRecovery(
      initial.resources.stamina,
      initial.staminaRecovery,
      start,
    );
    const historicalEvent = event('character.stamina_recovery_settled', 2, {
      characterId: initial.characterId,
      resources: { ...initial.resources, stamina: oldStaminaOnly.stamina },
      recovery: oldStaminaOnly.recovery,
    }, 1, start.toISOString());
    const historicalProjection = replayCharacter([createdWithVitals, historicalEvent])!;
    expect(historicalProjection.health).toEqual({ current: 1, maximum: 6 });
    expect(historicalProjection.resources.mana).toEqual({ current: 40, maximum: 100 });

    const vitalRecovery = resolveVitalRecovery({
      health: historicalProjection.health!,
      stamina: historicalProjection.resources.stamina,
      mana: historicalProjection.resources.mana,
    }, historicalProjection.staminaRecovery, new Date(start.getTime() + 20_000));
    const vitalEvent = event('character.vital_recovery_settled', 3, {
      characterId: initial.characterId,
      health: vitalRecovery.health,
      resources: {
        stamina: vitalRecovery.stamina,
        mana: vitalRecovery.mana,
      },
      recovery: vitalRecovery.recovery,
    }, 1, new Date(start.getTime() + 20_000).toISOString());
    expect(replayCharacter([createdWithVitals, historicalEvent, vitalEvent])).toMatchObject({
      health: { current: 2, maximum: 6 },
      resources: {
        stamina: { current: 70, maximum: 100 },
        mana: { current: 60, maximum: 100 },
      },
    });
  });

  it('replays class selection, resource spending, and an exhausted class action', () => {
    const attributes = { strength: 10, intelligence: 10, constitution: 10, dexterity: 10 };
    const characterClass = {
      id: 'replay-scout',
      revision: 1,
      catalogId: 'replay-catalog',
      catalogRevision: 1,
      label: 'Scout',
      description: 'A replay fixture.',
      primaryAttribute: 'dexterity',
      attributes,
      coreAction: {
        id: 'replay-action',
        revision: 1,
        label: 'Quick strike',
        description: 'A test action.',
        cost: { resource: 'stamina', amount: 2 },
        baseDamage: 1,
        scalingAttribute: 'dexterity',
        weaponBonus: false,
      },
    };
    const createdWithResources = event('character.created', 1, {
      characterId: 'character-test',
      playerId: 'player-test',
      name: 'Rowan',
      startingLocationId: 'mossgate-clearing',
      attributes,
      characterClass,
      health: { current: 6, maximum: 6 },
      resources: {
        stamina: { current: 2, maximum: 100 },
        mana: { current: 100, maximum: 100 },
      },
    }, 3);
    const spent = event('character.ability_resource_spent', 2, {
      characterId: 'character-test',
      encounterId: 'encounter-one',
      actionId: 'action-one',
      abilityId: 'replay-action',
      abilityRevision: 1,
      cost: { resource: 'stamina', amount: 2 },
      remaining: 0,
    });
    const projection = replayCharacter([createdWithResources, spent]);

    expect(projection).toMatchObject({
      resources: { stamina: { current: 0, maximum: 100 } },
      availableClassActions: [{
        id: 'replay-action',
        available: false,
        unavailableReason: 'You need 2 stamina.',
      }],
    });
    expect(() => replayCharacter([
      createdWithResources,
      spent,
      event('character.ability_resource_spent', 3, {
        ...spent.payload,
        encounterId: 'encounter-two',
      }),
    ])).toThrow(/invalid ability resource spending/i);
  });

  it('keeps legacy character streams valid without progression and rejects duplicate victory rewards', () => {
    const legacyCharacter = replayCharacter([created]);
    expect(legacyCharacter?.advancement).toBeUndefined();
    expect(legacyCharacter?.attributes).toEqual({
      strength: 10,
      intelligence: 10,
      constitution: 10,
      dexterity: 10,
    });
    expect(legacyCharacter?.honors).toEqual({ glory: 0, medals: 0 });

    const victory = event('character.combat_action_resolved', 2, {
      characterId: 'character-test',
      damageDealt: 4,
      damageTaken: 0,
      encounter: {
        encounterId: 'encounter-test',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'sentinel',
        opponentName: 'Practice Sentinel',
        round: 1,
        playerHealth: 6,
        playerMaxHealth: 6,
        opponentHealth: 0,
        opponentMaxHealth: 4,
        status: 'victory',
        lastAction: 'attack',
        lastNarration: 'You defeat the sentinel.',
      },
    });
    const reward = event('character.advancement_awarded', 3, {
      characterId: 'character-test',
      encounterId: 'encounter-test',
      experienceAwarded: 10,
      totalExperience: 10,
      level: 1,
    });
    expect(replayCharacter([created, victory, reward])?.advancement).toEqual({
      experience: 10,
      level: 1,
      lastRewardedEncounterId: 'encounter-test',
    });
    expect(() => replayCharacter([
      created,
      victory,
      reward,
      event('character.advancement_awarded', 4, {
        characterId: 'character-test',
        encounterId: 'encounter-test',
        experienceAwarded: 10,
        totalExperience: 20,
        level: 2,
      }),
    ])).toThrow(/invalid character advancement event/i);
  });

  it('rejects unknown event types instead of silently skipping them', () => {
    expect(() => replayCharacter([
      created,
      event('character.renamed.v2', 2, { characterId: 'character-test', name: 'Rill' }),
    ])).toThrow(/unsupported event type/i);
  });

  it('rejects every non-creation event when the stream has no character yet', () => {
    const eventTypes = [
      'character.supply_gathered',
      'character.fishing_cast_started',
      'character.fishing_cast_advanced',
      'character.woodcutting_action_started',
      'character.woodcutting_action_advanced',
      'character.daily_job_changed',
      'character.class_selected',
      'character.ability_resource_spent',
      'character.wallet_initialized',
      'character.merchant_item_purchased',
      'character.crafting_completed',
      'character.inn_rest_completed',
      'character.stamina_spent',
      'character.stamina_recovery_settled',
      'character.vital_recovery_settled',
      'character.posture_changed',
      'character.combat_encounter_started',
      'character.combat_action_resolved',
      'character.advancement_awarded',
      'character.combat_item_used',
      'character.pvp_outcome_applied',
      'character.team_combat_outcome_applied',
      'character.respawned',
      'character.shared_item_received',
      'character.shared_item_relinquished',
      'character.moved',
      'character.item_taken',
      'character.item_granted',
      'character.item_dropped',
      'character.item_stored',
      'character.equipment_changed',
      'character.item_used',
      'character.object_read',
      'character.npc_dialogue_choice_made',
      'character.npc_dialogue_restarted',
      'quest.accepted',
      'quest.completed',
      'character.corpse_gold_received',
      'character.quest_rewarded',
      'character.renamed',
      'character.archived',
      'character.restored',
    ];

    for (const type of eventTypes) {
      expect(() => replayCharacter([event(type, 1, {})]), type)
        .toThrow(/before (character )?creation/i);
    }
  });

  it('validates rename payloads against the event contract', () => {
    expect(() => replayCharacter([
      created,
      event('character.renamed', 2, { characterId: 'character-test', name: 123 }),
    ])).toThrow();
  });

  it('rejects replaying a drop event for a quest-bound item', () => {
    const taken = event('character.item_taken', 2, {
      characterId: 'character-test',
      locationId: 'mossgate-clearing',
      item: {
        id: 'quest-stone',
        label: 'Quest stone',
        description: 'A marked stone.',
      },
    });
    const dropped = event('character.item_dropped', 3, {
      characterId: 'character-test',
      locationId: 'mossgate-clearing',
      item: {
        id: 'quest-stone',
        label: 'Quest stone',
        description: 'A marked stone.',
        questBound: true,
      },
    });

    expect(() => replayCharacter([created, taken, dropped])).toThrow(/invalid item dropped event/i);
  });

  it('replays movement costs and records each visited location only once', () => {
    const moved = event('character.moved', 2, {
      characterId: 'character-test',
      fromLocationId: 'mossgate-clearing',
      toLocationId: 'glasswater-bridge',
      exitId: 'clearing-to-bridge',
      movementCost: 5,
    });
    const returned = event('character.moved', 3, {
      characterId: 'character-test',
      fromLocationId: 'glasswater-bridge',
      toLocationId: 'mossgate-clearing',
      exitId: 'bridge-to-clearing',
    });

    expect(replayCharacter([created, moved, returned])).toMatchObject({
      locationId: 'mossgate-clearing',
      visitedLocationIds: ['mossgate-clearing', 'glasswater-bridge'],
      resources: {
        stamina: { current: 95, maximum: 100 },
      },
      revision: 3,
    });
  });

  it('deduplicates read observations and resets NPC dialogue progress selectively', () => {
    const readBoard = (revision: number, objectId: string) => event('character.object_read', revision, {
      characterId: 'character-test',
      locationId: 'mossgate-clearing',
      objectId,
      label: 'Town notice',
      text: 'A notice pinned to the board.',
    });
    const choose = (revision: number, npcId: string, choiceId: string, progressFlagId: string) =>
      event('character.npc_dialogue_choice_made', revision, {
        characterId: 'character-test',
        npcId,
        choiceId,
        progressFlagId,
      });

    const projection = replayCharacter([
      created,
      readBoard(2, 'bulletin'),
      readBoard(3, 'bulletin'),
      readBoard(4, 'marker'),
      choose(5, 'taren-voss', 'ask-about-town', 'heard-about-town'),
      choose(6, 'taren-voss', 'ask-about-road', 'heard-about-road'),
      choose(7, 'orin-vale', 'ask-about-fishing', 'heard-about-fishing'),
      event('character.npc_dialogue_restarted', 8, {
        characterId: 'character-test',
        npcId: 'taren-voss',
        preservedProgressFlagIds: ['heard-about-town'],
      }),
      event('character.npc_dialogue_restarted', 9, {
        characterId: 'character-test',
        npcId: 'orin-vale',
        preservedProgressFlagIds: [],
      }),
    ]);

    expect(projection?.readableObservations).toEqual([
      { objectId: 'bulletin', locationId: 'mossgate-clearing' },
      { objectId: 'marker', locationId: 'mossgate-clearing' },
    ]);
    expect(projection?.npcProgress).toEqual([
      { npcId: 'taren-voss', progressFlagIds: ['heard-about-town'] },
    ]);
  });

  it('rejects NPC dialogue resets that preserve progress the character has not earned', () => {
    expect(() => replayCharacter([
      created,
      event('character.npc_dialogue_restarted', 2, {
        characterId: 'character-test',
        npcId: 'taren-voss',
        preservedProgressFlagIds: ['unknown-flag'],
      }),
    ])).toThrow(/invalid preserved npc dialogue progress/i);
  });

  it('replays taking, storing, retrieving, and dropping an item without losing its location', () => {
    const item = {
      id: 'travel-mug',
      typeId: 'travel-mug',
      label: 'Travel mug',
      description: 'A sturdy tin mug.',
    };
    const projection = replayCharacter([
      created,
      event('character.item_taken', 2, {
        characterId: 'character-test',
        locationId: 'mossgate-clearing',
        item,
      }),
      event('character.item_stored', 3, {
        characterId: 'character-test',
        locationId: 'mossgate-clearing',
        containerId: 'supply-chest',
        item,
      }),
      event('character.item_taken', 4, {
        characterId: 'character-test',
        locationId: 'mossgate-clearing',
        containerId: 'supply-chest',
        item,
      }),
      event('character.item_dropped', 5, {
        characterId: 'character-test',
        locationId: 'mossgate-clearing',
        item,
      }),
    ]);

    expect(projection?.inventory).toEqual([]);
    expect(projection?.claimedContainerItemIds).toContain('travel-mug');
    expect(projection?.itemLocations).toEqual([
      { item, locationId: 'mossgate-clearing' },
    ]);
  });

  it('rejects gaps in aggregate revisions', () => {
    expect(() => replayCharacter([
      created,
      event('character.archived', 3, { characterId: 'character-test' }),
    ])).toThrow(/non-contiguous aggregate revision/i);
  });

  it('replays wallet initialization once and rejects duplicates or mismatched owners', () => {
    const wallet = event('character.wallet_initialized', 2, {
      characterId: 'character-test',
      wallet: { currencyId: 'gold', balance: 12 },
    });

    expect(replayCharacter([created, wallet])?.wallet).toEqual({
      currencyId: 'gold',
      balance: 12,
    });
    expect(() => replayCharacter([
      created,
      wallet,
      event('character.wallet_initialized', 3, {
        characterId: 'character-test',
        wallet: { currencyId: 'gold', balance: 12 },
      }),
    ])).toThrow(/invalid wallet initialization/i);
    expect(() => replayCharacter([
      created,
      event('character.wallet_initialized', 2, {
        characterId: 'different-character',
        wallet: { currencyId: 'gold', balance: 12 },
      }),
    ])).toThrow(/invalid wallet initialization/i);
  });

  it('replays quest acceptance, completion, rewards, and corpse currency receipts', () => {
    const progression = replayCharacter([
      created,
      event('character.wallet_initialized', 2, {
        characterId: 'character-test',
        wallet: { currencyId: 'gold', balance: 3 },
      }),
      event('quest.accepted', 3, {
        characterId: 'character-test',
        questId: 'lost-parcel',
        definitionVersion: '1',
      }),
      event('quest.completed', 4, {
        characterId: 'character-test',
        questId: 'lost-parcel',
        definitionVersion: '1',
      }),
      event('character.quest_rewarded', 5, {
        characterId: 'character-test',
        questId: 'lost-parcel',
        definitionVersion: '1',
        currencyId: 'gold',
        amount: 5,
      }),
      event('character.corpse_gold_received', 6, {
        characterId: 'character-test',
        corpseId: 'bandit-corpse',
        currencyId: 'gold',
        amount: 2,
      }),
    ]);

    expect(progression).toMatchObject({
      wallet: { currencyId: 'gold', balance: 10 },
      questProgress: [{
        questId: 'lost-parcel',
        definitionVersion: '1',
        status: 'completed',
      }],
      questRewardedIds: ['lost-parcel'],
      claimedCorpseGoldIds: ['bandit-corpse'],
    });
    expect(() => replayCharacter([
      created,
      event('character.wallet_initialized', 2, {
        characterId: 'character-test',
        wallet: { currencyId: 'gold', balance: 3 },
      }),
      event('quest.accepted', 3, {
        characterId: 'character-test',
        questId: 'lost-parcel',
        definitionVersion: '1',
      }),
      event('quest.accepted', 4, {
        characterId: 'character-test',
        questId: 'lost-parcel',
        definitionVersion: '1',
      }),
    ])).toThrow(/invalid quest acceptance/i);
  });

  it('tracks supply gathering by source and UTC cycle', () => {
    const gather = (revision: number, sourceId: string, cycle: string, id: string) =>
      event('character.supply_gathered', revision, {
        characterId: 'character-test',
        sourceId,
        cycle,
        item: {
          id,
          typeId: 'pine-logs',
          label: 'Pine Logs',
          description: 'A bundle of pine logs.',
        },
      });
    const history = [
      created,
      gather(2, 'pine-tree', '2026-10-18', 'logs-one'),
      gather(3, 'pine-tree', '2026-10-18', 'logs-two'),
      gather(4, 'willow-tree', '2026-10-18', 'logs-three'),
      gather(5, 'pine-tree', '2026-10-19', 'logs-four'),
    ];
    const sameCycle = replayCharacter(history.slice(0, 4));
    const projection = replayCharacter(history);

    expect(sameCycle?.supplyCollections).toEqual([
      { sourceId: 'pine-tree', cycle: '2026-10-18', count: 2 },
      { sourceId: 'willow-tree', cycle: '2026-10-18', count: 1 },
    ]);
    expect(projection?.supplyCollections).toEqual([
      { sourceId: 'pine-tree', cycle: '2026-10-19', count: 1 },
    ]);
    expect(projection?.inventory.map((item) => item.id)).toEqual([
      'logs-one', 'logs-two', 'logs-three', 'logs-four',
    ]);
  });

  it('accepts and completes daily jobs while consuming only the requested log quantity', () => {
    const logs = {
      id: 'pine-log-stack',
      typeId: 'pine-logs',
      label: 'Pine Logs',
      description: 'A stack of pine logs.',
      stackable: true,
      quantity: 5,
    };
    const jobDetails = {
      id: 'pine-delivery',
      poster: 'Tomas',
      title: 'Logs for the hearth',
      supplyTypeId: 'pine-logs',
      quantity: 3,
      gold: 5,
      experience: 8,
    };
    const job = {
      boardId: 'south-common',
      cycle: '2026-10-18',
      jobId: 'pine-delivery',
      title: 'Logs for the hearth',
      status: 'active',
      details: jobDetails,
    };
    const completedJob = { ...job, status: 'completed' as const };
    const projection = replayCharacter([
      created,
      event('character.wallet_initialized', 2, {
        characterId: 'character-test',
        wallet: { currencyId: 'gold', balance: 10 },
      }),
      event('character.item_granted', 3, {
        characterId: 'character-test',
        sourceId: 'woodcutting',
        item: logs,
      }),
      event('character.daily_job_changed', 4, {
        characterId: 'character-test',
        job,
        consumedItemIds: [],
        gold: 0,
        experience: 0,
        currencyId: 'gold',
        level: 1,
        maximumHealth: 6,
      }),
      event('character.daily_job_changed', 5, {
        characterId: 'character-test',
        job: completedJob,
        consumedItemIds: [],
        consumedItemQuantities: [{ itemId: 'pine-log-stack', quantity: 3 }],
        gold: 5,
        experience: 8,
        currencyId: 'gold',
        level: 1,
        maximumHealth: 6,
      }),
    ]);

    expect(projection).toMatchObject({
      wallet: { currencyId: 'gold', balance: 15 },
      advancement: { experience: 8, level: 1 },
      dailyJobs: [completedJob],
      inventory: [{ id: 'pine-log-stack', quantity: 2 }],
    });
  });

  it('replays character renaming, archiving, and restoration in order', () => {
    const projection = replayCharacter([
      created,
      event('character.renamed', 2, {
        characterId: 'character-test',
        name: 'Rill',
      }),
      event('character.archived', 3, { characterId: 'character-test' }),
      event('character.restored', 4, { characterId: 'character-test' }),
      event('character.renamed', 5, {
        characterId: 'character-test',
        name: 'Rowan Vale',
      }),
    ]);

    expect(projection).toMatchObject({
      name: 'Rowan Vale',
      archived: false,
      revision: 5,
    });
    expect(() => replayCharacter([
      created,
      event('character.archived', 2, { characterId: 'character-test' }),
      event('character.archived', 3, { characterId: 'character-test' }),
    ])).toThrow(/invalid archive event/i);
  });

  it('records item interactions once and relinquishes shared items from character inventory', () => {
    const sharedItem = {
      id: 'shared-river-stone',
      sharedItemId: 'shared-river-stone',
      label: 'River stone',
      description: 'A smooth gray stone.',
    };
    const projection = replayCharacter([
      created,
      event('character.shared_item_received', 2, {
        characterId: 'character-test',
        worldItemId: 'shared-river-stone',
        sourceLocationId: 'mossgate-clearing',
        item: sharedItem,
      }),
      event('character.item_used', 3, {
        characterId: 'character-test',
        locationId: 'mossgate-clearing',
        itemId: 'shared-river-stone',
        targetId: 'old-mill',
        interactionId: 'stone-on-mill',
        response: 'The stone leaves a faint mark.',
      }),
      event('character.item_used', 4, {
        characterId: 'character-test',
        locationId: 'mossgate-clearing',
        itemId: 'shared-river-stone',
        targetId: 'different-object',
        interactionId: 'stone-on-mill',
        response: 'The interaction was already recorded.',
      }),
      event('character.shared_item_relinquished', 5, {
        characterId: 'character-test',
        worldItemId: 'shared-river-stone',
        locationId: 'mossgate-clearing',
      }),
    ]);

    expect(projection?.inventory).toEqual([]);
    expect(projection?.itemLocations).toEqual([]);
    expect(projection?.itemUseObservations).toEqual([{
      interactionId: 'stone-on-mill',
      itemId: 'shared-river-stone',
      targetId: 'old-mill',
      locationId: 'mossgate-clearing',
    }]);
  });

  it('replays fishing casts, catches, and interruption of an active cast', () => {
    const rod = {
      id: 'old-rod',
      typeId: 'fishing-rod',
      label: 'Old rod',
      description: 'A well-used fishing rod.',
      fishingRod: { qualityId: 'old-rod', biteChancePercent: 10, waitSeconds: 10 },
    };
    const cast = {
      castId: 'cast-one',
      spotId: 'south-bridge',
      locationId: 'mossgate-clearing',
      rodItemId: 'old-rod',
      rodQualityId: 'old-rod',
      startedAt: '2026-10-18T12:00:00.000Z',
      tickIntervalSeconds: 1,
      ticksRequired: 2,
      ticksCompleted: 0,
    };
    const fish = {
      id: 'bass-catch',
      typeId: 'bass',
      label: 'Smallmouth bass',
      description: 'A freshly caught bass.',
      fishCatch: {
        speciesId: 'smallmouth-bass',
        rarity: 'common',
        lengthCm: 30,
        weightGrams: 500,
      },
    };
    const projection = replayCharacter([
      created,
      event('character.item_granted', 2, {
        characterId: 'character-test',
        sourceId: 'orin-vale',
        item: rod,
      }),
      event('character.fishing_cast_started', 3, {
        characterId: 'character-test',
        cast,
      }),
      event('character.fishing_cast_advanced', 4, {
        characterId: 'character-test',
        castId: 'cast-one',
        ticksCompleted: 1,
        status: 'waiting',
        tickRolls: [{ tick: 1, roll: 90, caught: false }],
      }),
      event('character.fishing_cast_advanced', 5, {
        characterId: 'character-test',
        castId: 'cast-one',
        ticksCompleted: 2,
        status: 'caught',
        tickRolls: [{ tick: 2, roll: 3, caught: true }],
        item: fish,
      }),
      event('character.fishing_cast_started', 6, {
        characterId: 'character-test',
        cast: { ...cast, castId: 'cast-two' },
      }),
      event('character.fishing_cast_advanced', 7, {
        characterId: 'character-test',
        castId: 'cast-two',
        ticksCompleted: 0,
        status: 'interrupted',
        tickRolls: [],
      }),
    ]);

    expect(projection?.activeFishing).toBeUndefined();
    expect(projection?.inventory).toEqual([rod, fish]);
    expect(() => replayCharacter([
      created,
      event('character.item_granted', 2, {
        characterId: 'character-test',
        sourceId: 'orin-vale',
        item: rod,
      }),
      event('character.fishing_cast_started', 3, {
        characterId: 'character-test',
        cast,
      }),
      event('character.fishing_cast_advanced', 4, {
        characterId: 'character-test',
        castId: 'cast-one',
        ticksCompleted: 2,
        status: 'waiting',
        tickRolls: [
          { tick: 1, roll: 90, caught: false },
          { tick: 2, roll: 90, caught: false },
        ],
      }),
    ])).toThrow(/invalid fishing progress/i);
  });

  it('replays successful woodcutting and increments an existing stack of logs', () => {
    const axe = {
      id: 'copper-axe',
      typeId: 'copper-axe',
      label: 'Copper axe',
      description: 'A simple copper axe.',
      woodcuttingAxe: { requiredLevel: 1, power: 5 },
    };
    const action = {
      actionId: 'chop-one',
      treeId: 'pine-one',
      treeLabel: 'Pine',
      axeItemId: 'copper-axe',
      locationId: 'mossgate-clearing',
      startedAt: '2026-10-18T12:00:00.000Z',
      ticksCompleted: 0,
      ticksRequired: 10,
    };
    const logItem = {
      id: 'pine-log-stack',
      typeId: 'pine-logs',
      label: 'Pine Logs',
      description: 'A bundle of pine logs.',
      stackable: true,
      quantity: 1,
    };
    const projection = replayCharacter([
      created,
      event('character.item_granted', 2, {
        characterId: 'character-test',
        sourceId: 'marr-goods',
        item: axe,
      }),
      event('character.woodcutting_action_started', 3, {
        characterId: 'character-test',
        action,
      }),
      event('character.woodcutting_action_advanced', 4, {
        characterId: 'character-test',
        actionId: 'chop-one',
        ticksCompleted: 2,
        status: 'logged',
        tickRolls: [
          { tick: 1, roll: 0.9, success: false },
          { tick: 2, roll: 0.01, success: true },
        ],
        skillExperienceAwarded: 10,
        totalExperience: 10,
        level: 1,
        logLabel: 'Pine Logs',
        logTypeId: 'pine-logs',
        item: logItem,
      }),
      event('character.woodcutting_action_started', 5, {
        characterId: 'character-test',
        action: { ...action, actionId: 'chop-two' },
      }),
      event('character.woodcutting_action_advanced', 6, {
        characterId: 'character-test',
        actionId: 'chop-two',
        ticksCompleted: 1,
        status: 'logged',
        tickRolls: [{ tick: 1, roll: 0.02, success: true }],
        skillExperienceAwarded: 10,
        totalExperience: 20,
        level: 1,
        logLabel: 'Pine Logs',
        logTypeId: 'pine-logs',
        stackItemId: 'pine-log-stack',
        stackQuantity: 2,
      }),
    ]);

    expect(projection).toMatchObject({
      woodcutting: { experience: 20, level: 1 },
      inventory: [
        axe,
        { id: 'pine-log-stack', typeId: 'pine-logs', quantity: 2, stackable: true },
      ],
    });
    expect(projection?.activeWoodcutting).toBeUndefined();
  });

  it('replays version-1 combat events as steady-style encounters', () => {
    const legacyCombat = event('character.combat_action_resolved', 2, {
      characterId: 'character-test',
      damageDealt: 2,
      damageTaken: 1,
      encounter: {
        encounterId: 'combat-legacy',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'mossgate-training-sentinel',
        opponentName: 'Practice Sentinel',
        round: 1,
        playerHealth: 5,
        playerMaxHealth: 6,
        opponentHealth: 2,
        opponentMaxHealth: 4,
        status: 'active',
        lastAction: 'attack',
        lastNarration: 'The practice begins.',
      },
    });

    expect(replayCharacter([created, legacyCombat])?.combat).toMatchObject({
      encounterId: 'combat-legacy',
      opponentStyle: 'steady',
    });
  });

  it('replays legacy encounters that restarted at full health before persistent health was introduced', () => {
    const firstRound = event('character.combat_action_resolved', 2, {
      characterId: 'character-test',
      damageDealt: 2,
      damageTaken: 1,
      encounter: {
        encounterId: 'combat-legacy-first',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'sentinel',
        opponentName: 'Practice Sentinel',
        round: 1,
        playerHealth: 5,
        playerMaxHealth: 6,
        opponentHealth: 2,
        opponentMaxHealth: 4,
        status: 'active',
        lastAction: 'attack',
        lastNarration: 'The practice begins.',
      },
    }, 2);
    const firstVictory = event('character.combat_action_resolved', 3, {
      characterId: 'character-test',
      damageDealt: 2,
      damageTaken: 0,
      encounter: {
        encounterId: 'combat-legacy-first',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'sentinel',
        opponentName: 'Practice Sentinel',
        round: 2,
        playerHealth: 5,
        playerMaxHealth: 6,
        opponentHealth: 0,
        opponentMaxHealth: 4,
        status: 'victory',
        lastAction: 'attack',
        lastNarration: 'You defeat the sentinel.',
      },
    }, 2);
    const secondEncounter = event('character.combat_action_resolved', 4, {
      characterId: 'character-test',
      damageDealt: 2,
      damageTaken: 1,
      encounter: {
        encounterId: 'combat-legacy-second',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'sentinel',
        opponentName: 'Practice Sentinel',
        round: 1,
        playerHealth: 5,
        playerMaxHealth: 6,
        opponentHealth: 2,
        opponentMaxHealth: 4,
        status: 'active',
        lastAction: 'attack',
        lastNarration: 'The practice begins again.',
      },
    }, 2);

    expect(replayCharacter([created, firstRound, firstVictory, secondEncounter])?.combat)
      .toMatchObject({ encounterId: 'combat-legacy-second', playerHealth: 5 });
  });
});
