import type { WorldPackContent } from '@mudd/contracts';

type Encounter = WorldPackContent['roadRules'][string]['encounters'][number];

export function houndEncounter(id: string, loot?: Encounter['loot']): Encounter {
  return { id, name: 'Stray Hound', combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
    ...(loot ? { loot: structuredClone(loot) } : {}),
  };
}

export function boarEncounter(id: string, loot?: Encounter['loot']): Encounter {
  return { id, name: 'Reedback Boar', combatProfile: { maxHealth: 7, attackDamage: 2, style: 'steady' },
    ...(loot ? { loot: structuredClone(loot) } : {}),
  };
}

export function badgerEncounter(id: string, loot?: Encounter['loot']): Encounter {
  return { id, name: 'Bank Badger', combatProfile: { maxHealth: 6, attackDamage: 2, style: 'steady' },
    ...(loot ? { loot: structuredClone(loot) } : {}),
  };
}

export function deerEncounter(id: string, loot?: Encounter['loot']): Encounter {
  return { id, name: 'Roadside Deer', combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
    ...(loot ? { loot: structuredClone(loot) } : {}),
  };
}

export function foxEncounter(id: string, loot?: Encounter['loot']): Encounter {
  return { id, name: 'Ditch Fox', combatProfile: { maxHealth: 3, attackDamage: 1, style: 'steady' },
    ...(loot ? { loot: structuredClone(loot) } : {}),
  };
}

export function banditEncounter(id: string): WorldPackContent['roadRules'][string]['encounters'][number] {
  return {
    id,
    name: 'Bandit',
    combatProfile: { maxHealth: 6, attackDamage: 1, style: 'steady' },
    loot: {
      items: [],
      chanceItems: [{
          item: {
            id: 'bandit-knife-template',
            typeId: 'bandit-knife',
            label: 'Bandit knife',
            description: 'A narrow knife with a worn wooden grip and a nicked steel edge.',
            equipment: { slot: 'weapon', attackBonus: 1 },
          },
          chancePercent: 5,
        }],
      currencyAmount: 3,
      currencyChancePercent: 50,
    },
  };
}
export const roadRules = {
  'ashcombe-timber-road': {
    encounterChancePercent: 10,
    encounters: [
      badgerEncounter('ashcombe-timber-road-bank-badger'),
      houndEncounter('ashcombe-timber-road-stray-hound'),
      deerEncounter('ashcombe-timber-road-roadside-deer'),
    ],
  },
  'thornmere-path': {
    encounterChancePercent: 5,
    encounters: [
      badgerEncounter('thornmere-path-bank-badger'),
      deerEncounter('thornmere-path-roadside-deer'),
    ],
  },
  'mosswake-causeway': {
    encounterChancePercent: 6,
    encounters: [
      boarEncounter('mosswake-causeway-reedback-boar'),
      houndEncounter('mosswake-causeway-stray-hound'),
    ],
  },
  'bellwold-mile-west-road': {
    encounterChancePercent: 10,
    encounters: [
      houndEncounter('bellwold-mile-west-road-stray-hound'),
      banditEncounter('bellwold-mile-west-road-bandit'),
    ],
  },
  'bellwold-south-road': {
    encounterChancePercent: 10,
    encounters: [
      houndEncounter('bellwold-south-road-stray-hound'),
      deerEncounter('bellwold-road-deer', { items: [{ id: 'deer-hide-template', typeId: 'deer-hide', label: 'Deer hide',
              description: 'A brown deer hide with a pale underside.' }] }),
      banditEncounter('bellwold-south-road-bandit'),
    ],
  },
  'bellwold-east-mill-road': {
    encounterChancePercent: 10,
    encounters: [
      houndEncounter('bellwold-east-road-stray-hound'),
      banditEncounter('bellwold-east-mill-road-bandit'),
    ],
  },
  'bellwold-north-church-road': {
    encounterChancePercent: 10,
    encounters: [
      houndEncounter('bellwold-north-church-road-stray-hound'),
      banditEncounter('bellwold-north-church-road-bandit'),
    ],
  },
  'bellwold-west-road': {
    encounterChancePercent: 10,
    encounters: [
      houndEncounter('bellwold-west-road-stray-hound'),
      banditEncounter('bellwold-west-road-bandit'),
    ],
  },
  'harrowfen-road': {
    encounterChancePercent: 10,
    encounters: [
      foxEncounter('harrowfen-road-ditch-fox'),
      boarEncounter('harrowfen-road-reedback-boar'),
      houndEncounter('harrowfen-road-stray-hound'),
    ],
  },
  'rill-towpath': {
    encounterChancePercent: 10,
    encounters: [
      boarEncounter('rill-towpath-reedback-boar'),
      foxEncounter('rill-towpath-ditch-fox'),
      houndEncounter('rill-towpath-stray-hound'),
    ],
  },
  'rillford-south-lane-road': {
    encounterChancePercent: 10,
    encounters: [
      houndEncounter('rillford-south-lane-road-stray-hound'),
      foxEncounter('rillford-south-lane-road-ditch-fox'),
    ],
  },
} satisfies WorldPackContent['roadRules'];
