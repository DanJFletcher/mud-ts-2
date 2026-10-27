import { describe, expect, it } from 'vitest';
import { WorldCorpseCreatedEventSchema } from '@mudd/contracts';
import type { StoredGameEvent } from '@mudd/engine-core';
import { createWorldCorpseEffect, projectWorldItems, worldItemsStreamId } from './world-items.js';

const worldInstanceId = 'corpse-lifecycle-test-world';
const corpseId = 'bandit-corpse-1';
const goldItemId = 'bandit-corpse-1-gold';
const createdAt = '2026-10-27T10:00:00.000Z';
const expiredAt = '2026-10-27T10:05:00.000Z';

function event(type: string, payload: Record<string, unknown>, revision: number): StoredGameEvent {
  return {
    eventId: `world-item-event-${revision}`,
    worldInstanceId,
    streamId: worldItemsStreamId(worldInstanceId),
    aggregateId: worldItemsStreamId(worldInstanceId),
    aggregateVersion: revision,
    type,
    version: 1,
    payload,
    causationCommandId: `command-${revision}`,
    actorId: 'system',
    occurredAt: createdAt,
    tick: revision,
  } as unknown as StoredGameEvent;
}

describe('corpse expiry projection', () => {
  const created = event('world.corpse_created', {
    corpse: {
      corpseId,
      encounterId: 'bandit-1',
      opponentId: 'bandit-1',
      opponentName: 'Bandit',
      label: 'Bandit corpse',
      description: 'A fallen bandit lies here.',
      locationId: 'southbound-track',
      corpseType: 'npc',
      createdAt,
      expiresAt: '2026-10-27T10:05:00.000Z',
      expirationPolicy: 'drop',
      currencyId: 'gold',
      currencyAmount: 7,
      goldItemId,
      goldClaimed: false,
    },
    items: [],
  }, 1);

  it('leaves unclaimed currency as a takeable room drop when policy is drop', () => {
    const expired = event('world.corpse_expired', {
      corpseId,
      corpseName: 'Bandit',
      locationId: 'southbound-track',
      policy: 'drop',
      expiredAt,
    }, 2);

    expect(projectWorldItems([created, expired])).toMatchObject({
      corpses: [],
      currencyDrops: [{
        dropId: goldItemId,
        corpseId,
        locationId: 'southbound-track',
        currencyId: 'gold',
        amount: 7,
      }],
    });
  });

  it('removes the dropped currency after its wallet claim is recorded', () => {
    const expired = event('world.corpse_expired', {
      corpseId,
      corpseName: 'Bandit',
      locationId: 'southbound-track',
      policy: 'drop',
      expiredAt,
    }, 2);
    const claimed = event('world.corpse_gold_claimed', {
      corpseId,
      characterId: 'character-1',
      locationId: 'southbound-track',
      currencyId: 'gold',
      amount: 7,
    }, 3);

    expect(projectWorldItems([created, expired, claimed]).currencyDrops).toEqual([]);
  });

  it('schedules an initially empty corpse for the shorter cleanup interval', () => {
    const effect = createWorldCorpseEffect(() => 'empty-corpse', {
      encounterId: 'quiet-road',
      opponentId: 'deer',
      opponentName: 'Deer',
      locationId: 'southbound-track',
      createdAt,
      lifecycleRules: {
        ordinaryNpcSeconds: 300,
        bossNpcSeconds: 900,
        playerSeconds: 1800,
        emptyCorpseSeconds: 60,
        npcExpirationPolicy: 'destroy',
        playerExpirationPolicy: 'recovery-storage',
        showDecayStages: true,
      },
    });
    const payload = WorldCorpseCreatedEventSchema.shape.payload.parse(effect.payload);

    expect(payload.corpse.expiresAt).toBe('2026-10-27T10:01:00.000Z');
  });
});
