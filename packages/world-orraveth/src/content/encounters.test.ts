import { describe, expect, it } from 'vitest';
import { badgerEncounter, banditEncounter, boarEncounter, deerEncounter, foxEncounter, houndEncounter } from './encounters.js';
import baseline from '../__fixtures__/pre-refactor-world.json' with { type: 'json' };

describe('encounter factories', () => {
  it.each([badgerEncounter, banditEncounter, boarEncounter, deerEncounter, foxEncounter, houndEncounter])(
    '%s returns independently mutable profiles with unchanged authored balance', (factory) => {
      const first = factory('first');
      const second = factory('second');
      const authored = baseline.roads.flatMap((road) => road.encounters).find(({ name }) => name === first.name)!;
      expect(first.combatProfile).toMatchObject(authored.combatProfile);
      first.combatProfile.maxHealth = 999;
      expect(second.combatProfile.maxHealth).toBe(authored.combatProfile.maxHealth);
    },
  );

  it('constructs independent nested bandit loot', () => {
    const first = banditEncounter('one');
    const second = banditEncounter('two');
    first.loot!.chanceItems![0]!.item.equipment!.attackBonus = 99;
    expect(second.loot!.chanceItems![0]!.item.equipment!.attackBonus).toBe(1);
  });

  it('clones explicit regional loot and does not add it to other deer', () => {
    const loot = { items: [{ id: 'hide', label: 'Hide', description: 'A deer hide.' }] };
    const first = deerEncounter('south', loot);
    const second = deerEncounter('another', loot);
    first.loot!.items![0]!.label = 'Changed';
    expect(second.loot!.items![0]!.label).toBe('Hide');
    expect(loot.items[0]!.label).toBe('Hide');
    expect(deerEncounter('north').loot).toBeUndefined();
  });
});
