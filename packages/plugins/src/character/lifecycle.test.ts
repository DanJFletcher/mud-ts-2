import { describe, expect, it } from 'vitest';
import {
  registerCharacterCreation,
  registerCharacterManagement,
} from './lifecycle.js';

describe('character lifecycle registration', () => {
  it('registers character creation, rename, archive, and restore from the lifecycle module', () => {
    const commands: string[] = [];
    const registrations = {
      registerCommand: (name: string) => commands.push(name),
      optionalCapability: () => undefined,
    };

    registerCharacterCreation(registrations as never);
    registerCharacterManagement(registrations as never, {} as never);

    expect(commands.sort()).toEqual([
      'character.archive',
      'character.create',
      'character.rename',
      'character.restore',
    ]);
  });
});
