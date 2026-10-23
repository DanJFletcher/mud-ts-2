export type ClassResource = 'stamina' | 'mana';

export interface CharacterClassDefinition {
  id: string;
  revision: number;
  label: string;
  description: string;
  primaryAttribute: 'strength' | 'dexterity' | 'intelligence';
  attributes: {
    strength: number;
    intelligence: number;
    constitution: number;
    dexterity: number;
  };
  coreAction: {
    id: string;
    revision: number;
    label: string;
    description: string;
    cost: { resource: ClassResource; amount: number };
    baseDamage: number;
    scalingAttribute: 'strength' | 'dexterity' | 'intelligence';
    weaponBonus: boolean;
  };
}

export interface AvailableClassAction {
  id: string;
  label: string;
  description: string;
  cost: { resource: ClassResource; amount: number };
  available: boolean;
  unavailableReason?: string;
}
