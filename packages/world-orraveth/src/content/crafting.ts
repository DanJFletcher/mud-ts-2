import type { WorldPackContent } from '@mudd/contracts';

export const craftingWorkbenchLocationIds = ['bellwold-milepost-workshop'] satisfies WorldPackContent['craftingWorkbenchLocationIds'];

export const craftingRecipes = [
  {
    id: 'leather-gloves',
    outputTypeId: 'leather-gloves',
    outputLabel: 'Leather gloves',
    outputDescription: 'A small pair of soft, hand-stitched leather gloves. They grant +1 defense when equipped.',
    equipment: {
      slot: 'gloves',
      defenseBonus: 1,
    },
    requiredLevel: 1,
    experience: 13.8,
    toolTypeIds: ['crafting-needle'],
    ingredients: [
      {
        typeId: 'tanned-deer-hide',
        label: 'tanned deer hide',
        quantityPerCraft: 1,
      },
      {
        typeId: 'spool-of-thread',
        label: 'Spool of Thread',
        quantityPerCraft: 1,
        consumeUses: true,
      },
    ],
  },
  {
    id: 'leather-boots',
    outputTypeId: 'leather-boots',
    outputLabel: 'Leather boots',
    outputDescription: 'A pair of sturdy leather boots, cut and stitched by hand. They grant +1 defense when equipped.',
    equipment: {
      slot: 'boots',
      defenseBonus: 1,
    },
    requiredLevel: 1,
    experience: 16.25,
    toolTypeIds: ['crafting-needle'],
    ingredients: [
      {
        typeId: 'tanned-deer-hide',
        label: 'tanned deer hide',
        quantityPerCraft: 1,
      },
      {
        typeId: 'spool-of-thread',
        label: 'Spool of Thread',
        quantityPerCraft: 1,
        consumeUses: true,
      },
    ],
  },
  {
    id: 'leather-cowl',
    outputTypeId: 'leather-cowl',
    outputLabel: 'Leather cowl',
    outputDescription: 'A close-fitting leather cowl with a simple stitched edge. It grants +1 defense when equipped.',
    equipment: {
      slot: 'cowl',
      defenseBonus: 1,
    },
    requiredLevel: 1,
    experience: 18.5,
    toolTypeIds: ['crafting-needle'],
    ingredients: [
      {
        typeId: 'tanned-deer-hide',
        label: 'tanned deer hide',
        quantityPerCraft: 1,
      },
      {
        typeId: 'spool-of-thread',
        label: 'Spool of Thread',
        quantityPerCraft: 1,
        consumeUses: true,
      },
    ],
  },
  {
    id: 'leather-body',
    outputTypeId: 'leather-body',
    outputLabel: 'Leather body',
    outputDescription: 'A plain leather vest, pieced together with close, even stitches. It grants +2 defense when equipped.',
    equipment: {
      slot: 'body',
      defenseBonus: 2,
    },
    requiredLevel: 1,
    experience: 25,
    toolTypeIds: ['crafting-needle'],
    ingredients: [
      {
        typeId: 'tanned-deer-hide',
        label: 'tanned deer hide',
        quantityPerCraft: 1,
      },
      {
        typeId: 'spool-of-thread',
        label: 'Spool of Thread',
        quantityPerCraft: 1,
        consumeUses: true,
      },
    ],
  },
  {
    id: 'leather-chaps',
    outputTypeId: 'leather-chaps',
    outputLabel: 'Leather chaps',
    outputDescription: 'A pair of leather leg guards with a narrow stitched seam. They grant +1 defense when equipped.',
    equipment: {
      slot: 'chaps',
      defenseBonus: 1,
    },
    requiredLevel: 1,
    experience: 27,
    toolTypeIds: ['crafting-needle'],
    ingredients: [
      {
        typeId: 'tanned-deer-hide',
        label: 'tanned deer hide',
        quantityPerCraft: 1,
      },
      {
        typeId: 'spool-of-thread',
        label: 'Spool of Thread',
        quantityPerCraft: 1,
        consumeUses: true,
      },
    ],
  },
  {
    id: 'leather-vambraces',
    outputTypeId: 'leather-vambraces',
    outputLabel: 'Leather vambraces',
    outputDescription: 'A pair of leather forearm guards, neatly secured at the wrist. They grant +1 defense when equipped.',
    equipment: {
      slot: 'vambraces',
      defenseBonus: 1,
    },
    requiredLevel: 11,
    experience: 22,
    toolTypeIds: ['crafting-needle'],
    ingredients: [
      {
        typeId: 'tanned-deer-hide',
        label: 'tanned deer hide',
        quantityPerCraft: 1,
      },
      {
        typeId: 'spool-of-thread',
        label: 'Spool of Thread',
        quantityPerCraft: 1,
        consumeUses: true,
      },
    ],
  },
  {
    id: 'leather-shield',
    outputTypeId: 'leather-shield',
    outputLabel: 'Leather shield',
    outputDescription: 'A small leather-covered shield with a reinforced rim. It grants +2 defense when equipped.',
    equipment: {
      slot: 'shield',
      defenseBonus: 2,
    },
    requiredLevel: 19,
    experience: 30,
    toolTypeIds: ['crafting-needle'],
    ingredients: [
      {
        typeId: 'tanned-deer-hide',
        label: 'tanned deer hide',
        quantityPerCraft: 1,
      },
      {
        typeId: 'spool-of-thread',
        label: 'Spool of Thread',
        quantityPerCraft: 1,
        consumeUses: true,
      },
    ],
  },
] satisfies WorldPackContent['craftingRecipes'];
