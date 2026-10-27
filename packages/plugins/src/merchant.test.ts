import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema } from '@mudd/contracts';
import { merchantPlugin } from './merchant.js';

const CURRENCY = { id: 'moss-mark', name: 'moss mark', symbol: 'm', startingBalance: 12 };
const NEEDLE = {
  id: 'needle-item',
  typeId: 'crafting-needle',
  label: 'Crafting Needle',
  description: 'A fine steel needle for leatherwork.',
};
const THREAD = {
  id: 'thread-item',
  typeId: 'spool-of-thread',
  label: 'Spool of Thread',
  description: 'A spool with five uses.',
};
const LISTINGS = [
  { id: 'needle-listing', item: NEEDLE, price: 4, repeatable: false },
  { id: 'thread-listing', item: THREAD, price: 2, repeatable: true },
];

function world(overrides: Record<string, unknown> = {}) {
  return {
    currency: CURRENCY,
    locations: [{
      id: 'market',
      npcs: [{ id: 'marr', name: 'Marr', shop: { listings: LISTINGS } }],
    }],
    ...overrides,
  };
}

function character(overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    worldInstanceId: 'world-1',
    characterId: 'shopper-1',
    name: 'Shopper',
    locationId: 'market',
    revision: 3,
    health: { current: 10, maximum: 10 },
    wallet: { currencyId: CURRENCY.id, balance: 20 },
    purchasedMerchantListingIds: [],
    ...overrides,
  });
}

function harness(player: ReturnType<typeof character>) {
  const commands = new Map<string, (command: any, context: any) => Promise<unknown>>();
  const queries = new Map<string, (query: any, context: any) => Promise<unknown>>();
  merchantPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
      commands.set(name, handler);
    },
    registerQuery: (name: string, _schema: unknown, handler: (query: any, context: any) => Promise<unknown>) => {
      queries.set(name, handler);
    },
    requireCapability: () => ({ load: vi.fn(async () => player) }),
  } as never);
  return {
    commands,
    queries,
    context: { world: world(), makeId: () => 'generated-item-id' },
  };
}

function command(player: ReturnType<typeof character>, payload: Record<string, unknown>) {
  return { characterId: player.characterId, expectedVersion: player.revision, payload };
}

describe('merchant wallet initialization', () => {
  it('initializes a wallet using the world currency and starting balance', async () => {
    const player = character({ wallet: undefined });
    const { commands, context } = harness(player);
    const result = await commands.get('character.wallet.initialize')!(
      command(player, {}),
      context,
    );
    expect(result).toMatchObject({
      streamId: player.characterId,
      events: [{
        type: 'character.wallet_initialized',
        version: 1,
        payload: {
          characterId: player.characterId,
          wallet: { currencyId: CURRENCY.id, balance: CURRENCY.startingBalance },
        },
      }],
    });
  });

  it('rejects unavailable characters, duplicate wallets, and worlds without currency', async () => {
    const player = character();
    const { commands, context } = harness(player);
    await expect(commands.get('character.wallet.initialize')!(command(player, {}), context))
      .rejects.toThrow('This character already has a wallet.');
    const walletless = character({ wallet: undefined });
    await expect(harness(walletless).commands.get('character.wallet.initialize')!(
      command(walletless, {}),
      { ...context, world: world({ currency: undefined }) },
    )).rejects.toThrow('This world has no configured currency.');

    const unavailable = new Map<string, (command: any, context: any) => Promise<unknown>>();
    merchantPlugin.register({
      registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
        unavailable.set(name, handler);
      },
      registerQuery: () => undefined,
      requireCapability: () => ({ load: vi.fn(async () => undefined) }),
    } as never);
    await expect(unavailable.get('character.wallet.initialize')!(command(player, {}), context))
      .rejects.toThrow('That character is no longer available.');
  });
});

describe('merchant catalog query', () => {
  it('shows listings, wallet balance, and whether one-time listings were purchased', async () => {
    const player = character({ purchasedMerchantListingIds: ['needle-listing'] });
    const { queries, context } = harness(player);
    const result = await queries.get('merchant.catalog')!(
      { characterId: player.characterId, payload: { merchantNpcId: 'marr' } },
      context,
    );
    expect(result).toMatchObject({
      merchantNpcId: 'marr',
      merchantName: 'Marr',
      currency: { id: CURRENCY.id, balance: 20 },
      listings: [
        { id: 'needle-listing', purchased: true, repeatable: false },
        { id: 'thread-listing', purchased: false, repeatable: true },
      ],
    });
  });

  it('rejects unavailable merchants, missing currency, and an uninitialized or mismatched wallet', async () => {
    const player = character();
    const { queries, context } = harness(player);
    const query = { characterId: player.characterId, payload: { merchantNpcId: 'marr' } };
    await expect(queries.get('merchant.catalog')!(query, {
      ...context, world: { ...context.world, locations: [{ id: 'market', npcs: [] }] },
    })).rejects.toThrow('That merchant is not selling anything here.');
    await expect(queries.get('merchant.catalog')!(query, {
      ...context, world: world({ currency: undefined }),
    })).rejects.toThrow('This world has no configured currency.');
    const noWallet = character({ wallet: undefined });
    await expect(harness(noWallet).queries.get('merchant.catalog')!(query, context))
      .rejects.toThrow('This character’s wallet is not ready yet.');
    const wrongCurrency = character({ wallet: { currencyId: 'other-currency', balance: 20 } });
    await expect(harness(wrongCurrency).queries.get('merchant.catalog')!(query, context))
      .rejects.toThrow('This character’s wallet is not ready yet.');
  });
});

describe('merchant.purchase', () => {
  it('purchases repeatable goods with a unique item ID and one-time goods as authored', async () => {
    const player = character({ inventory: [] });
    const { commands, context } = harness(player);
    const purchase = commands.get('merchant.purchase')!;

    const repeatable = await purchase(command(player, { merchantNpcId: 'marr', listingId: 'thread-listing' }), context);
    expect(repeatable).toMatchObject({
      events: [{
        type: 'character.merchant_item_purchased',
        payload: {
          listingId: 'thread-listing',
          repeatable: true,
          item: { id: 'merchant-generated-item-id', typeId: THREAD.typeId },
        },
      }],
    });

    const oneTime = await purchase(command(player, { merchantNpcId: 'marr', listingId: 'needle-listing' }), context);
    expect(oneTime).toMatchObject({
      events: [{
        payload: { listingId: 'needle-listing', repeatable: false, item: { id: NEEDLE.id } },
      }],
    });
  });

  it('rejects invalid merchants, listings, repeat purchases, duplicate items, and insufficient balance', async () => {
    const player = character();
    const { commands, context } = harness(player);
    const purchase = commands.get('merchant.purchase')!;
    await expect(purchase(command(player, { merchantNpcId: 'missing', listingId: 'needle-listing' }), context))
      .rejects.toThrow('That merchant is not selling anything here.');
    await expect(purchase(command(player, { merchantNpcId: 'marr', listingId: 'missing' }), context))
      .rejects.toThrow('That item is not for sale here.');

    const alreadyBought = character({ purchasedMerchantListingIds: ['needle-listing'] });
    await expect(harness(alreadyBought).commands.get('merchant.purchase')!(
      command(alreadyBought, { merchantNpcId: 'marr', listingId: 'needle-listing' }),
      context,
    )).rejects.toThrow('You have already bought that item from this merchant.');

    const duplicateItem = character({ inventory: [NEEDLE] });
    await expect(harness(duplicateItem).commands.get('merchant.purchase')!(
      command(duplicateItem, { merchantNpcId: 'marr', listingId: 'needle-listing' }),
      context,
    )).rejects.toThrow('You already carry that item.');

    const poor = character({ wallet: { currencyId: CURRENCY.id, balance: 1 } });
    await expect(harness(poor).commands.get('merchant.purchase')!(
      command(poor, { merchantNpcId: 'marr', listingId: 'needle-listing' }),
      context,
    )).rejects.toThrow('You need 4 moss mark to buy that.');
  });

  it('rejects wallets from another world and worlds without currency', async () => {
    const player = character({ wallet: { currencyId: 'other-currency', balance: 20 } });
    const { commands, context } = harness(player);
    const purchase = commands.get('merchant.purchase')!;
    await expect(purchase(command(player, { merchantNpcId: 'marr', listingId: 'needle-listing' }), context))
      .rejects.toThrow('This character’s wallet is not ready yet.');

    const ready = character();
    await expect(harness(ready).commands.get('merchant.purchase')!(
      command(ready, { merchantNpcId: 'marr', listingId: 'needle-listing' }),
      { ...context, world: world({ currency: undefined }) },
    )).rejects.toThrow('This world has no configured currency.');
  });
});
