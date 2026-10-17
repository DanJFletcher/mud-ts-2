import { describe, expect, it } from 'vitest';
import { characters, commandReceipts, gameEvents, players, sessions } from './schema.js';

describe('PostgreSQL schema definitions', () => {
  it('declares durable identity, character, event and idempotency tables', () => {
    expect(players).toBeDefined();
    expect(sessions).toBeDefined();
    expect(characters).toBeDefined();
    expect(gameEvents).toBeDefined();
    expect(commandReceipts).toBeDefined();
  });
});
