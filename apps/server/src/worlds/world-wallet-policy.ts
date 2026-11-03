import type { CharacterProjection, WorldPackDraft } from '@mudd/contracts';

export function shouldInitializeCharacterWallet(
  world: Pick<WorldPackDraft, 'currency'>,
  character: Pick<CharacterProjection, 'wallet' | 'combat' | 'health'>,
): boolean {
  return Boolean(
    world.currency &&
    !character.wallet &&
    character.combat?.status !== 'defeat' &&
    character.health?.current !== 0,
  );
}
