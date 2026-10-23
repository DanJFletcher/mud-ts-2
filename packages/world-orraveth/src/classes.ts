import { CharacterClassCatalogSchema } from '@mudd/contracts';

/** Provisional original gameplay design, not a taxonomy from established lore. */
export const orravethClassCatalog = CharacterClassCatalogSchema.parse({
  id: 'orraveth.starter-classes', revision: 1,
  classes: [
    {
      id: 'orraveth.vanguard', revision: 1, label: 'Vanguard',
      description: 'A durable martial combatant led by Strength, with greater Constitution. Heavy Strike spends stamina for a stronger single blow. All classes retain physical Attack.',
      primaryAttribute: 'strength',
      attributes: { strength: 15, intelligence: 10, constitution: 15, dexterity: 10 },
      coreAction: { id: 'orraveth.heavy-strike', revision: 1, label: 'Heavy Strike',
        description: 'Commit stamina to one forceful physical strike against your combat opponent.',
        cost: { resource: 'stamina', amount: 20 }, baseDamage: 3, scalingAttribute: 'strength', weaponBonus: true },
    },
    {
      id: 'orraveth.scout', revision: 1, label: 'Scout',
      description: 'A Dexterity-led martial combatant. Precise Strike spends stamina for a measured single blow. This starting kit grants no stealth, dual wielding, critical hits, or stances.',
      primaryAttribute: 'dexterity',
      attributes: { strength: 15, intelligence: 10, constitution: 10, dexterity: 15 },
      coreAction: { id: 'orraveth.precise-strike', revision: 1, label: 'Precise Strike',
        description: 'Spend stamina on a carefully directed physical strike. Armor still applies normally.',
        cost: { resource: 'stamina', amount: 15 }, baseDamage: 3, scalingAttribute: 'dexterity', weaponBonus: true },
    },
    {
      id: 'orraveth.kindler', revision: 1, label: 'Kindler',
      description: 'An Intelligence-led Resonance practitioner. Directed Heat spends mana to concentrate existing heat through a practiced pattern, with finite reach and cost. Physical Attack remains available.',
      primaryAttribute: 'intelligence',
      attributes: { strength: 10, intelligence: 15, constitution: 10, dexterity: 15 },
      coreAction: { id: 'orraveth.directed-heat', revision: 1, label: 'Directed Heat',
        description: 'Guide existing thermal energy along a practiced pattern toward one combat opponent. This costly, bounded working does not create energy from nothing or identify Resonance’s source.',
        cost: { resource: 'mana', amount: 20 }, baseDamage: 3, scalingAttribute: 'intelligence', weaponBonus: false },
    },
  ],
});
