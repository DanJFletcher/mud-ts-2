import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema } from '@mudd/contracts';
import { craftingPlugin, validateCraftingWorld } from './crafting.js';

const RECIPE = {
  id: 'leather-gloves',
  outputTypeId: 'leather-gloves',
  outputLabel: 'Leather gloves',
  outputDescription: 'Gloves cut from soft tanned hide.',
  requiredLevel: 1,
  experience: 13.8,
  toolTypeIds: ['crafting-needle'],
  ingredients: [
    { typeId: 'tanned-hide', label: 'Tanned hide', quantityPerCraft: 1 },
    { typeId: 'spool-of-thread', label: 'Spool of Thread', quantityPerCraft: 1, consumeUses: true },
  ],
};
const WORLD = {
  locations: [{ id: 'workshop' }, { id: 'market' }],
  craftingWorkbenchLocationIds: ['workshop'],
  craftingRecipes: [RECIPE],
};

function item(
  id: string,
  typeId: string,
  options: Record<string, unknown> = {},
) {
  return { id, typeId, label: id, description: `A ${id}.`, ...options };
}

function materials(quantity = 5, uses = 5) {
  return [
    item('needle', 'crafting-needle'),
    item('hide-stack', 'tanned-hide', { stackable: true, quantity }),
    item('thread-spool', 'spool-of-thread', { usesRemaining: uses }),
  ];
}

function character(overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    worldInstanceId: 'world-1',
    characterId: 'crafter-1',
    name: 'Crafter',
    locationId: 'workshop',
    revision: 5,
    health: { current: 10, maximum: 10 },
    crafting: { experienceHundredths: 0, level: 1 },
    inventory: materials(),
    ...overrides,
  });
}

function harness(
  player: ReturnType<typeof character>,
  options: { world?: Record<string, unknown>; characterExists?: boolean; sharedCombat?: boolean } = {},
) {
  const commands = new Map<string, (command: any, context: any) => Promise<unknown>>();
  const queries = new Map<string, (query: any, context: any) => Promise<unknown>>();
  let itemId = 0;
  craftingPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
      commands.set(name, handler);
    },
    registerQuery: (name: string, _schema: unknown, handler: (query: any, context: any) => Promise<unknown>) => {
      queries.set(name, handler);
    },
    requireCapability: () => ({
      load: vi.fn(async () => options.characterExists === false ? undefined : player),
    }),
  } as never);
  const context = {
    world: { ...WORLD, ...options.world },
    worldInstanceId: 'world-1',
    makeId: () => `crafted-${++itemId}`,
    store: {
      readStream: vi.fn(async (_worldId: string, streamId: string): Promise<Array<{ type: string; payload: unknown }>> =>
        streamId === 'world-team-combat' && options.sharedCombat
          ? [{
              type: 'team.combat_started',
              payload: {
                encounter: {
                  encounterId: 'team-1',
                  status: 'active',
                  participants: [{ characterId: player.characterId, status: 'active' }],
                },
              },
            }]
          : []),
    },
  };
  return { commands, queries, context };
}

function command(player: ReturnType<typeof character>, quantity = 1, recipeId = RECIPE.id) {
  return {
    characterId: player.characterId,
    expectedVersion: player.revision,
    payload: { recipeId, quantity },
  };
}

describe('crafting world validation', () => {
  it('accepts workbenches and recipes that reference unique world content', () => {
    expect(() => validateCraftingWorld(WORLD as never)).not.toThrow();
  });

  it('rejects duplicate or missing workbench locations and duplicate recipe IDs', () => {
    expect(() => validateCraftingWorld({
      ...WORLD, craftingWorkbenchLocationIds: ['workshop', 'workshop'],
    } as never)).toThrow('Crafting workbenches must reference unique locations in this world.');
    expect(() => validateCraftingWorld({
      ...WORLD, craftingWorkbenchLocationIds: ['missing'],
    } as never)).toThrow('Crafting workbenches must reference unique locations in this world.');
    expect(() => validateCraftingWorld({
      ...WORLD, craftingRecipes: [RECIPE, RECIPE],
    } as never)).toThrow('Crafting recipe IDs must be unique.');
  });
});

describe('crafting catalog query', () => {
  it('shows recipes craftable from carried tools and materials and reports workbench status', async () => {
    const player = character({ locationId: 'market' });
    const { queries, context } = harness(player);
    const result = await queries.get('crafting.catalog')!({
      characterId: player.characterId,
      payload: {},
    }, context);
    expect(result).toMatchObject({
      skill: { level: 1, experienceHundredths: 0 },
      atWorkbench: false,
      recipes: [{
        recipeId: RECIPE.id,
        maxCraftable: 5,
        outputLabel: RECIPE.outputLabel,
      }],
    });
  });

  it('omits recipes above the current skill or without tools and materials', async () => {
    const advancedRecipe = { ...RECIPE, id: 'leather-shield', requiredLevel: 19 };
    const player = character({
      inventory: materials().filter((entry) => entry.typeId !== 'crafting-needle'),
    });
    const { queries, context } = harness(player, {
      world: { craftingRecipes: [RECIPE, advancedRecipe] },
    });
    const result = await queries.get('crafting.catalog')!({
      characterId: player.characterId,
      payload: {},
    }, context);
    expect(result).toMatchObject({ recipes: [] });
  });

  it('uses the default level-one skill and rejects unavailable characters', async () => {
    const player = character({ crafting: undefined });
    const query = { characterId: player.characterId, payload: {} };
    expect(await harness(player).queries.get('crafting.catalog')!(query, harness(player).context))
      .toMatchObject({ skill: { level: 1, experienceHundredths: 0 } });
    await expect(harness(player, { characterExists: false }).queries.get('crafting.catalog')!(
      query,
      harness(player).context,
    )).rejects.toThrow('That character is no longer available.');
  });
});

describe('crafting command', () => {
  it('creates a batch, consumes the correct material quantities and spool uses, and awards XP', async () => {
    const player = character();
    const { commands, context } = harness(player);
    const result = await commands.get('crafting.craft')!(command(player, 5), context);
    expect(result).toMatchObject({
      streamId: player.characterId,
      expectedVersion: player.revision,
      events: [{
        type: 'character.crafting_completed',
        payload: {
          locationId: 'workshop',
          recipe: RECIPE,
          quantity: 5,
          outputItems: Array.from({ length: 5 }, (_, index) => ({
            id: `crafted-${index + 1}`,
            typeId: RECIPE.outputTypeId,
            label: RECIPE.outputLabel,
          })),
          materialConsumptions: [
            { itemId: 'hide-stack', kind: 'quantity', amount: 5 },
            { itemId: 'thread-spool', kind: 'uses', amount: 5 },
          ],
          experienceAwardedHundredths: 6900,
          totalExperienceHundredths: 6900,
          level: 2,
        },
      }],
    });
  });

  it('splits material consumption across stacks and ignores unrelated or exhausted items', async () => {
    const player = character({
      inventory: [
        item('needle', 'crafting-needle'),
        item('hide-a', 'tanned-hide', { stackable: true, quantity: 1 }),
        item('unrelated', 'river-fish'),
        item('hide-b', 'tanned-hide', { stackable: true, quantity: 4 }),
        item('empty-spool', 'spool-of-thread'),
        item('spool-a', 'spool-of-thread', { usesRemaining: 1 }),
        item('spool-b', 'spool-of-thread', { usesRemaining: 4 }),
        item('extra-spool', 'spool-of-thread', { usesRemaining: 3 }),
      ],
    });
    const { commands, context } = harness(player);
    const result = await commands.get('crafting.craft')!(command(player, 5), context);
    expect(result).toMatchObject({
      events: [{
        payload: {
          materialConsumptions: [
            { itemId: 'hide-a', amount: 1 },
            { itemId: 'hide-b', amount: 4 },
            { itemId: 'spool-a', amount: 1 },
            { itemId: 'spool-b', amount: 4 },
          ],
        },
      }],
    });
  });

  it('levels crafting from accumulated experience and caps at level 99', async () => {
    const player = character({
      crafting: { experienceHundredths: 24_502_500, level: 99 },
      inventory: materials(1, 1),
    });
    const { commands, context } = harness(player);
    const result = await commands.get('crafting.craft')!(command(player), context);
    expect(result).toMatchObject({
      events: [{
        payload: {
          totalExperienceHundredths: 24_503_880,
          level: 99,
        },
      }],
    });
  });

  it('rejects unavailable, defeated, resting, or combat-locked characters', async () => {
    const player = character();
    const request = command(player);
    await expect(harness(player, { characterExists: false }).commands.get('crafting.craft')!(
      request, harness(player).context,
    )).rejects.toThrow('That character is no longer available.');
    const defeated = character({ health: { current: 0, maximum: 10 } });
    await expect(harness(defeated).commands.get('crafting.craft')!(
      command(defeated), harness(defeated).context,
    )).rejects.toThrow();
    const resting = character({
      staminaRecovery: { posture: 'resting', lastSettledAt: null, fractionalCarry: 0 },
    });
    await expect(harness(resting).commands.get('crafting.craft')!(
      command(resting), harness(resting).context,
    )).rejects.toThrow();
    const activeCombat = {
      ...character(),
      combat: { status: 'active' },
    } as ReturnType<typeof character>;
    await expect(harness(activeCombat).commands.get('crafting.craft')!(
      command(activeCombat), harness(activeCombat).context,
    )).rejects.toThrow('You cannot craft during combat.');
    const sharedCombat = harness(player, { sharedCombat: true });
    await expect(sharedCombat.commands.get('crafting.craft')!(request, sharedCombat.context))
      .rejects.toThrow('You cannot craft during combat.');
  });

  it('rejects timed activities, non-workbench rooms, unknown recipes, and insufficient level', async () => {
    const player = {
      ...character(),
      activeFishing: { castId: 'cast-1' },
    } as ReturnType<typeof character>;
    await expect(harness(player).commands.get('crafting.craft')!(
      command(player), harness(player).context,
    )).rejects.toThrow('Finish your current timed activity before crafting.');
    const woodcutting = {
      ...character(),
      activeWoodcutting: { actionId: 'chop-1' },
    } as ReturnType<typeof character>;
    await expect(harness(woodcutting).commands.get('crafting.craft')!(
      command(woodcutting), harness(woodcutting).context,
    )).rejects.toThrow('Finish your current timed activity before crafting.');
    const away = character({ locationId: 'market' });
    await expect(harness(away).commands.get('crafting.craft')!(
      command(away), harness(away).context,
    )).rejects.toThrow('You need to be at a workbench to craft.');
    await expect(harness(character()).commands.get('crafting.craft')!(
      command(character(), 1, 'missing-recipe'), harness(character()).context,
    )).rejects.toThrow('That recipe is not available in this world.');
    const levelLocked = character({
      crafting: { experienceHundredths: 0, level: 1 },
    });
    const advanced = harness(levelLocked, {
      world: { craftingRecipes: [{ ...RECIPE, id: 'advanced', requiredLevel: 11 }] },
    });
    await expect(advanced.commands.get('crafting.craft')!(
      command(levelLocked, 1, 'advanced'),
      advanced.context,
    )).rejects.toThrow('Crafting level 11 is required for Leather gloves.');
  });

  it('requires tools, sufficient materials, and available crafting experience capacity', async () => {
    const noTool = character({ inventory: [item('hide', 'tanned-hide', { stackable: true, quantity: 5 })] });
    await expect(harness(noTool).commands.get('crafting.craft')!(
      command(noTool), harness(noTool).context,
    )).rejects.toThrow('You do not have the tools required for that recipe.');
    const insufficient = character({ inventory: materials(1, 1) });
    await expect(harness(insufficient).commands.get('crafting.craft')!(
      command(insufficient, 5), harness(insufficient).context,
    )).rejects.toThrow('You have enough materials to craft at most 1.');
    const capped = {
      ...character({ inventory: materials(1, 1) }),
      crafting: { experienceHundredths: 2_147_483_640, level: 99 },
    } as ReturnType<typeof character>;
    await expect(harness(capped).commands.get('crafting.craft')!(
      command(capped), harness(capped).context,
    )).rejects.toThrow('Your crafting experience cannot increase any further.');
  });

  it('fails closed if an ingredient count changes between availability and consumption planning', async () => {
    const unstableHide = item('unstable-hide-stack', 'tanned-hide', { stackable: true });
    let quantityRead = 0;
    Object.defineProperty(unstableHide, 'quantity', {
      get: () => (quantityRead++ === 0 ? 5 : 0),
    });
    const player = {
      ...character(),
      inventory: [
        item('needle', 'crafting-needle'),
        unstableHide,
        item('thread-spool', 'spool-of-thread', { usesRemaining: 5 }),
      ],
    } as ReturnType<typeof character>;
    const { commands, context } = harness(player);
    await expect(commands.get('crafting.craft')!(command(player, 5), context))
      .rejects.toThrow('You need more Tanned hide to make that quantity.');
  });
});
