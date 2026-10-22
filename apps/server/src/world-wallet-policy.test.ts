import { describe, expect, it } from 'vitest';
import type { CharacterProjection } from '@mudd/contracts';
import { demoWorld } from '@mudd/world-demo';
import { orravethWorld } from '@mudd/world-orraveth';
import { shouldInitializeCharacterWallet } from './world-wallet-policy.js';

describe('world wallet initialization policy', () => {
  const livingCharacterWithoutWallet = {
    wallet: undefined,
    combat: undefined,
    health: { current: 6, maximum: 6 },
  } as const;

  it('does not require a wallet for a world without a configured currency', () => {
    expect(orravethWorld.currency).toBeUndefined();
    expect(shouldInitializeCharacterWallet(orravethWorld, livingCharacterWithoutWallet)).toBe(false);
  });

  it('initializes a wallet when a currency is configured', () => {
    expect(demoWorld.currency).toBeDefined();
    expect(shouldInitializeCharacterWallet(demoWorld, livingCharacterWithoutWallet)).toBe(true);
  });

  it('does not initialize wallets that already exist or belong to defeated characters', () => {
    expect(shouldInitializeCharacterWallet(demoWorld, {
      ...livingCharacterWithoutWallet,
      wallet: { currencyId: demoWorld.currency!.id, balance: 0 },
    })).toBe(false);
    expect(shouldInitializeCharacterWallet(demoWorld, {
      ...livingCharacterWithoutWallet,
      combat: { status: 'defeat' } as CharacterProjection['combat'],
    })).toBe(false);
  });
});
