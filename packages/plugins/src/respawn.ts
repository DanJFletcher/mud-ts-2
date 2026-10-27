import {
  CharacterRespawnedEventSchema,
  InventoryItemProjectionSchema,
  characterHasEquippedItem,
  type CharacterProjection,
  type InventoryItemProjection,
} from '@mudd/contracts';
import type { EngineCommandContext, ProposedDomainEvent, ProposedEventEffect } from '@mudd/engine-core';
import { createWorldCorpseEffect } from './world-items.js';

export interface PreparedRespawn {
  event: ProposedDomainEvent;
  effects: ProposedEventEffect[];
}

export function prepareCharacterRespawn(
  character: CharacterProjection,
  context: Pick<EngineCommandContext, 'world' | 'makeId' | 'rng' | 'now'>,
  cause: 'pve' | 'pvp' | 'team-pve',
  encounterId: string,
  deathLocationId: string,
  excludedItemIds: readonly string[] = [],
  maximumHealth = character.health?.maximum ?? 6,
): PreparedRespawn | undefined {
  const respawnLocationId = context.world.respawn?.locationId;
  if (!respawnLocationId) return undefined;
  if (!context.world.locations.some((location) => location.id === respawnLocationId)) {
    throw new Error('The configured respawn location is missing from this world.');
  }

  const excluded = new Set(excludedItemIds);
  const eligible = character.inventory.filter((item) =>
    !excluded.has(item.id) &&
    item.questBound !== true &&
    !context.world.locations.some((location) =>
      location.takeables?.some((takeable) => takeable.id === item.id && takeable.questBound === true)) &&
    !characterHasEquippedItem(character.equipment, item.id));
  const selected = eligible.length ? eligible[context.rng.roll(eligible.length) - 1] : undefined;
  if (eligible.length && !selected) {
    throw new Error('The authoritative RNG returned an out-of-range item selection.');
  }

  let droppedItem: { sourceItemId: string; item: InventoryItemProjection } | undefined;
  const effects: ProposedEventEffect[] = [];
  if (selected) {
    const worldItemId = selected.sharedItemId ?? context.makeId();
    const item = InventoryItemProjectionSchema.parse({
      ...selected,
      id: worldItemId,
      sharedItemId: worldItemId,
    });
    droppedItem = { sourceItemId: selected.id, item };
    effects.push(createWorldCorpseEffect(context.makeId, {
      encounterId,
      opponentId: character.characterId,
      opponentName: character.name,
      locationId: deathLocationId,
      corpseType: 'player',
      ownerCharacterId: character.characterId,
      preservedItems: [item],
      createdAt: context.now().toISOString(),
      lifecycleRules: context.world.corpseLifecycle,
    }));
  }
  const payload = {
    characterId: character.characterId,
    cause,
    encounterId,
    deathLocationId,
    respawnLocationId,
    health: { current: maximumHealth, maximum: maximumHealth },
    ...(droppedItem ? { droppedItem } : {}),
  };
  CharacterRespawnedEventSchema.shape.payload.parse(payload);
  return {
    event: { type: 'character.respawned', version: 1, payload },
    effects,
  };
}
