import { describe, expect, it } from 'vitest';
import {
  registerCharacterQueries,
  registerCharacterReadCommand,
} from './queries.js';

describe('character room query registration', () => {
  it('keeps readable actions and room/object projections in the query module', () => {
    const commands: string[] = [];
    const queries: string[] = [];

    registerCharacterReadCommand({
      registerCommand: (name: string) => commands.push(name),
    } as never, {} as never);
    registerCharacterQueries({
      registerQuery: (name: string) => queries.push(name),
    } as never, {
      state: {} as never,
      worldItems: {} as never,
    });

    expect(commands).toEqual(['character.read']);
    expect(queries.sort()).toEqual([
      'location.describe',
      'object.inspect',
      'object.read',
    ]);
  });
});
