import { z } from 'zod';
import { ClientCommandBaseSchema, ClientQueryBaseSchema, DomainEventBaseSchema } from './protocol.js';
import { IdSchema, NonNegativeIntSchema, PositiveIntSchema } from './ids.js';
import { CharacterWalletSchema, InventoryItemProjectionSchema } from './character.js';
import { CharacterHealthSchema } from './health.js';
import { CharacterResourcesSchema } from './character.js';

const MAX_CURRENCY_AMOUNT = 2_147_483_647;

export const WorldCurrencyDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(40),
  symbol: z.string().trim().min(1).max(8),
  startingBalance: NonNegativeIntSchema.max(MAX_CURRENCY_AMOUNT),
}).strict();

export const InnDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(120),
  restPrice: PositiveIntSchema.max(MAX_CURRENCY_AMOUNT),
}).strict();

export const InnProjectionSchema = InnDefinitionSchema.extend({
  currency: z.object({
    id: IdSchema,
    name: z.string().min(1).max(40),
    symbol: z.string().min(1).max(8),
  }).strict(),
}).strict();

export const MerchantListingDefinitionSchema = z.object({
  id: IdSchema,
  item: InventoryItemProjectionSchema,
  price: PositiveIntSchema.max(MAX_CURRENCY_AMOUNT),
}).strict();

export const MerchantCatalogDefinitionSchema = z.object({
  listings: z.array(MerchantListingDefinitionSchema).min(1).max(24),
}).strict().superRefine((catalog, context) => {
  const listingIds = new Set<string>();
  for (const [index, listing] of catalog.listings.entries()) {
    if (listingIds.has(listing.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['listings', index, 'id'],
        message: 'Merchant listing IDs must be unique within the catalog.',
      });
    }
    listingIds.add(listing.id);
  }
});

export const MerchantCatalogQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('merchant.catalog'),
  payload: z.object({ merchantNpcId: IdSchema }).strict(),
}).strict();

export const MerchantCatalogProjectionSchema = z.object({
  merchantNpcId: IdSchema,
  merchantName: z.string().min(1).max(120),
  currency: z.object({
    id: IdSchema,
    name: z.string().min(1).max(40),
    symbol: z.string().min(1).max(8),
    balance: CharacterWalletSchema.shape.balance,
  }).strict(),
  listings: z.array(z.object({
    id: IdSchema,
    item: InventoryItemProjectionSchema,
    price: PositiveIntSchema.max(MAX_CURRENCY_AMOUNT),
    purchased: z.boolean(),
  }).strict()).max(24),
}).strict();

export const MerchantPurchaseCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('merchant.purchase'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({
    merchantNpcId: IdSchema,
    listingId: IdSchema,
  }).strict(),
}).strict();

export const MerchantItemPurchasedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.merchant_item_purchased'),
  payload: z.object({
    characterId: IdSchema,
    locationId: IdSchema,
    merchantNpcId: IdSchema,
    listingId: IdSchema,
    currencyId: IdSchema,
    price: PositiveIntSchema.max(MAX_CURRENCY_AMOUNT),
    item: InventoryItemProjectionSchema,
  }).strict(),
}).strict();

export const InnRestCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('inn.rest'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ innId: IdSchema }).strict(),
}).strict();

const InnRestCompletedPayloadV1Schema = z.object({
  characterId: IdSchema,
  locationId: IdSchema,
  innId: IdSchema,
  currencyId: IdSchema,
  price: PositiveIntSchema.max(MAX_CURRENCY_AMOUNT),
  healthRestored: PositiveIntSchema.max(1000),
  health: CharacterHealthSchema,
}).strict();

export const CharacterInnRestCompletedEventV1Schema = DomainEventBaseSchema.extend({
  type: z.literal('character.inn_rest_completed'),
  version: z.literal(1),
  payload: InnRestCompletedPayloadV1Schema,
}).strict();

export const CharacterInnRestCompletedEventV2Schema = DomainEventBaseSchema.extend({
  type: z.literal('character.inn_rest_completed'),
  version: z.literal(2),
  payload: z.object({
    characterId: IdSchema,
    locationId: IdSchema,
    innId: IdSchema,
    currencyId: IdSchema,
    price: PositiveIntSchema.max(MAX_CURRENCY_AMOUNT),
    healthRestored: NonNegativeIntSchema.max(1000),
    staminaRestored: NonNegativeIntSchema.max(1000),
    manaRestored: NonNegativeIntSchema.max(1000),
    health: CharacterHealthSchema,
    resources: CharacterResourcesSchema,
  }).strict(),
}).strict();

export const CharacterInnRestCompletedEventSchema = z.discriminatedUnion('version', [
  CharacterInnRestCompletedEventV1Schema,
  CharacterInnRestCompletedEventV2Schema,
]);

export type WorldCurrencyDefinition = z.infer<typeof WorldCurrencyDefinitionSchema>;
export type InnDefinition = z.infer<typeof InnDefinitionSchema>;
export type InnProjection = z.infer<typeof InnProjectionSchema>;
export type MerchantListingDefinition = z.infer<typeof MerchantListingDefinitionSchema>;
export type MerchantCatalogDefinition = z.infer<typeof MerchantCatalogDefinitionSchema>;
export type MerchantCatalogQuery = z.infer<typeof MerchantCatalogQuerySchema>;
export type MerchantCatalogProjection = z.infer<typeof MerchantCatalogProjectionSchema>;
export type MerchantPurchaseCommand = z.infer<typeof MerchantPurchaseCommandSchema>;
export type InnRestCommand = z.infer<typeof InnRestCommandSchema>;
