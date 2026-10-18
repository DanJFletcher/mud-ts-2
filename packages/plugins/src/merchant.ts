import {
  CharacterWalletInitializedEventSchema,
  InitializeCharacterWalletCommandSchema,
  MerchantCatalogProjectionSchema,
  MerchantCatalogQuerySchema,
  MerchantItemPurchasedEventSchema,
  MerchantPurchaseCommandSchema,
} from '@mudd/contracts';
import type { EnginePlugin } from '@mudd/engine-core';
import { RuleViolationError } from '@mudd/engine-core';
import type { WorldPackDraft } from '@mudd/contracts';
import { characterStateCapability, type CharacterStateCapability } from './character.js';

export const merchantPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.merchant',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
    requires: [characterStateCapability.id],
    requiredPlugins: { 'mudd.character': '^1.0.0' },
  },
  register({ registerCommand, registerQuery, requireCapability }) {
    const characterState = requireCapability<CharacterStateCapability>(characterStateCapability);

    registerCommand('character.wallet.initialize', InitializeCharacterWalletCommandSchema, async (command, context) => {
      const character = await characterState.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      if (character.wallet) throw new RuleViolationError('This character already has a wallet.');
      const currency = context.world.currency;
      if (!currency) throw new RuleViolationError('This world has no configured currency.');
      const payload = {
        characterId: character.characterId,
        wallet: { currencyId: currency.id, balance: currency.startingBalance },
      };
      CharacterWalletInitializedEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.wallet_initialized', version: 1, payload }],
      };
    });

    registerQuery('merchant.catalog', MerchantCatalogQuerySchema, async (query, context) => {
      const character = await characterState.load(context, query.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const merchant = currentMerchant(context.world, character.locationId, query.payload.merchantNpcId);
      const currency = context.world.currency;
      if (!currency) throw new RuleViolationError('This world has no configured currency.');
      if (!character.wallet || character.wallet.currencyId !== currency.id) {
        throw new RuleViolationError('This character’s wallet is not ready yet. Refresh the world and try again.');
      }
      return MerchantCatalogProjectionSchema.parse({
        merchantNpcId: merchant.id,
        merchantName: merchant.name,
        currency: {
          id: currency.id,
          name: currency.name,
          symbol: currency.symbol,
          balance: character.wallet.balance,
        },
        listings: (merchant.shop?.listings ?? []).map((listing) => ({
          ...listing,
          purchased: character.purchasedMerchantListingIds.includes(listing.id),
        })),
      });
    });

    registerCommand('merchant.purchase', MerchantPurchaseCommandSchema, async (command, context) => {
      const character = await characterState.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const merchant = currentMerchant(context.world, character.locationId, command.payload.merchantNpcId);
      const currency = context.world.currency;
      if (!currency) throw new RuleViolationError('This world has no configured currency.');
      if (!character.wallet || character.wallet.currencyId !== currency.id) {
        throw new RuleViolationError('This character’s wallet is not ready yet. Refresh the world and try again.');
      }
      const listing = merchant.shop?.listings.find((candidate) => candidate.id === command.payload.listingId);
      if (!listing) throw new RuleViolationError('That item is not for sale here.');
      if (character.purchasedMerchantListingIds.includes(listing.id)) {
        throw new RuleViolationError('You have already bought that item from this merchant.');
      }
      if (character.inventory.some((item) => item.id === listing.item.id)) {
        throw new RuleViolationError('You already carry that item.');
      }
      if (character.wallet.balance < listing.price) {
        throw new RuleViolationError(`You need ${listing.price} ${currency.name} to buy that.`);
      }
      const payload = {
        characterId: character.characterId,
        locationId: character.locationId,
        merchantNpcId: merchant.id,
        listingId: listing.id,
        currencyId: currency.id,
        price: listing.price,
        item: listing.item,
      };
      MerchantItemPurchasedEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.merchant_item_purchased', version: 1, payload }],
      };
    });
  },
};

function currentMerchant(
  world: WorldPackDraft,
  locationId: string,
  merchantNpcId: string,
) {
  const location = world.locations.find((candidate) => candidate.id === locationId);
  const merchant = location?.npcs?.find((candidate) => candidate.id === merchantNpcId);
  if (!merchant?.shop) throw new RuleViolationError('That merchant is not selling anything here.');
  return merchant;
}
