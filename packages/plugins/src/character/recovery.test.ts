import { describe, expect, it } from 'vitest';
import { registerCharacterRecovery, teamFleeStaminaEffect } from './recovery.js';

describe('character recovery registration', () => {
  it('registers recovery, posture, and team-flee handlers in one focused module', () => {
    const commands: string[] = [];
    const systemCommands: string[] = [];
    const effects: string[] = [];

    registerCharacterRecovery({
      registerCommand: (name: string) => commands.push(name),
      registerSystemCommand: (name: string, _schema: unknown, _handler: unknown, version = 1) => {
        systemCommands.push(`${name}@${version}`);
      },
      registerEffect: (name: string, version: number) => effects.push(`${name}@${version}`),
    } as never, {} as never);

    expect(commands.sort()).toEqual(['character.rest', 'character.stand']);
    expect(systemCommands.sort()).toEqual([
      'character.stamina.recover@1',
      'character.stamina.recover@2',
    ]);
    expect(effects).toEqual(['mudd.character.team-flee-stamina@1']);
  });

  it('keeps the team-flee effect payload stable', () => {
    expect(teamFleeStaminaEffect('character-one', 'encounter-one')).toEqual({
      type: 'mudd.character.team-flee-stamina',
      version: 1,
      payload: { characterId: 'character-one', encounterId: 'encounter-one' },
    });
  });
});
