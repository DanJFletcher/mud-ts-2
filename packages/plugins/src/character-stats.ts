import {
  CharacterStatsProjectionSchema,
  type CharacterProjection,
} from '@mudd/contracts';

export const BASE_PLAYER_DAMAGE = 2;
export const BASE_PLAYER_HEALTH = 6;
export const PLAYER_HEALTH_PER_LEVEL = 2;

function clamp(value: number, maximum: number): number {
  return Math.min(maximum, Math.max(0, value));
}

export function maximumHealthForLevel(level: number, constitution = 10): number {
  const levelHealth = BASE_PLAYER_HEALTH + (Math.max(1, level) - 1) * PLAYER_HEALTH_PER_LEVEL;
  const constitutionBonus = Math.floor((constitution - 10) / 5);
  return Math.max(1, levelHealth + constitutionBonus);
}

/** Existing cumulative experience thresholds, shared by combat and quest awards. */
export function levelAfterExperience(currentLevel: number, totalExperience: number): number {
  let level = currentLevel;
  while (level < 10 && totalExperience >= level * 20) level++;
  return level;
}

export function characterAttackDamage(character: CharacterProjection): number {
  const weapon = character.inventory.find((item) => item.id === character.equipment.weaponItemId);
  const primary = character.characterClass?.primaryAttribute;
  // Intelligence applies only to directed abilities, never to basic physical Attack.
  const attribute = primary === 'dexterity' ? character.attributes.dexterity : character.attributes.strength;
  const strengthBonus = Math.floor((attribute - 10) / 5);
  return Math.max(1, BASE_PLAYER_DAMAGE + strengthBonus + (weapon?.equipment?.attackBonus ?? 0));
}

export function calculateCharacterStats(character: CharacterProjection) {
  const { strength, intelligence, constitution, dexterity } = character.attributes;
  const weapon = character.inventory.find((item) => item.id === character.equipment.weaponItemId);
  const armor = character.inventory.find((item) => item.id === character.equipment.armorItemId);
  const weaponBonus = weapon?.equipment?.attackBonus ?? 0;
  const armorBonus = armor?.equipment?.defenseBonus ?? 0;

  return CharacterStatsProjectionSchema.parse({
    attributes: character.attributes,
    attackPower: strength * 3 + weaponBonus * 10,
    spellPower: intelligence * 3,
    damage: characterAttackDamage(character),
    critChancePercent: Number(clamp(5 + (dexterity - 10) * 0.5, 50).toFixed(1)),
    healthRegen: Math.max(0, Math.floor((constitution - 1) / 10)),
    manaRegen: Math.max(0, Math.floor((intelligence - 1) / 10)),
    staminaRegen: Math.max(0, Math.floor((dexterity - 1) / 10)),
    armorPercent: Number(clamp(armorBonus * 5, 75).toFixed(1)),
    resiliencePercent: Number(clamp((constitution - 10) * 0.3, 75).toFixed(1)),
    dodgePercent: Number(clamp((dexterity - 10) * 0.5, 50).toFixed(1)),
  });
}
