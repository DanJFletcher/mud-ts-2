import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CharacterResourcePoolSchema,
  CharacterStaminaRecoverySchema,
  DEFAULT_CHARACTER_EQUIPMENT,
  InventoryEquipmentSchema,
  InventoryItemProjectionSchema,
  characterHasEquippedItem,
  equipmentItemIdForSlot,
} from '../dist/src/index.js';

const inventoryItem = (overrides = {}) => ({
  id: 'item-1',
  label: 'Leather gloves',
  description: 'Soft leather gloves.',
  ...overrides,
});

test('equipment bonuses match the equipment slot', () => {
  assert.equal(InventoryEquipmentSchema.safeParse({ slot: 'weapon', attackBonus: 3 }).success, true);
  assert.equal(InventoryEquipmentSchema.safeParse({ slot: 'body', defenseBonus: 2 }).success, true);
  assert.equal(InventoryEquipmentSchema.safeParse({ slot: 'weapon', defenseBonus: 1 }).success, false);
  assert.equal(InventoryEquipmentSchema.safeParse({ slot: 'shield', attackBonus: 1 }).success, false);
});

test('inventory projections reject incompatible ownership and item metadata', () => {
  const valid = inventoryItem({ sharedItemId: 'item-1', quantity: 3, stackable: true });
  assert.equal(InventoryItemProjectionSchema.safeParse(valid).success, true);
  assert.equal(InventoryItemProjectionSchema.safeParse(inventoryItem({
    sharedItemId: 'different-item',
  })).success, false);
  assert.equal(InventoryItemProjectionSchema.safeParse(inventoryItem({
    consumable: { effect: 'heal', amount: 2 },
    equipment: { slot: 'gloves' },
  })).success, false);
  assert.equal(InventoryItemProjectionSchema.safeParse(inventoryItem({
    quantity: 2,
  })).success, false);
  assert.equal(InventoryItemProjectionSchema.safeParse(inventoryItem({
    stackable: true,
  })).success, false);
  assert.equal(InventoryItemProjectionSchema.safeParse(inventoryItem({
    stackable: true,
    quantity: 2,
    usesRemaining: 4,
  })).success, false);
});

test('equipment helpers resolve every slot and identify equipped items', () => {
  const equipment = { ...DEFAULT_CHARACTER_EQUIPMENT, weaponItemId: 'knife', shieldItemId: 'buckler' };
  assert.equal(equipmentItemIdForSlot(equipment, 'weapon'), 'knife');
  assert.equal(equipmentItemIdForSlot(equipment, 'armor'), null);
  assert.equal(characterHasEquippedItem(equipment, 'buckler'), true);
  assert.equal(characterHasEquippedItem(equipment, 'missing-item'), false);
});

test('resource pools and stamina recovery enforce bounds and normalize defaults', () => {
  assert.equal(CharacterResourcePoolSchema.safeParse({ current: 5, maximum: 5 }).success, true);
  assert.equal(CharacterResourcePoolSchema.safeParse({ current: 6, maximum: 5 }).success, false);
  assert.deepEqual(CharacterStaminaRecoverySchema.parse({}), {
    posture: 'standing',
    lastSettledAt: null,
    fractionalCarry: 0,
    healthFractionalCarry: 0,
    manaFractionalCarry: 0,
  });
  assert.equal(CharacterStaminaRecoverySchema.safeParse({ fractionalCarry: 100_000 }).success, false);
});
