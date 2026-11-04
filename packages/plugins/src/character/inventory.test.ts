import { describe, expect, it } from 'vitest';
import { registerCharacterInventory } from './inventory.js';

describe('character inventory registration', () => {
  it('keeps carrying, storage, equipment, and item-use commands together', () => {
    const commands: string[] = [];

    registerCharacterInventory({
      registerCommand: (name: string) => commands.push(name),
    } as never, {} as never, {} as never);

    expect(commands.sort()).toEqual([
      'character.drop',
      'character.equip',
      'character.put',
      'character.take',
      'character.unequip',
      'character.use',
    ]);
  });
});
