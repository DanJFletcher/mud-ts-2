import { describe, expect, it } from 'vitest';
import { WorldQuerySchema } from './world-query-schema.js';

describe('WorldQuerySchema', () => {
  it('accepts daily bulletin queries used by the board client', () => {
    const result = WorldQuerySchema.safeParse({
      type: 'daily.board',
      version: 1,
      queryId: 'daily-board-test',
      worldInstanceId: 'bellwold-test',
      characterId: '00000000-0000-4000-8000-000000000001',
      payload: { boardId: 'bellwold-notice-board' },
    });

    expect(result.success).toBe(true);
  });
});
