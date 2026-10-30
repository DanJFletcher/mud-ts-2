import { describe, expect, it } from 'vitest';
import type { CommandResponse } from '@mudd/client-sdk';
import { commandResultProjection } from './command-projection.js';

type Projection = NonNullable<CommandResponse['gameProjection']>;

function projectionAt(revision: number) {
  return { character: { revision } } as Projection;
}

function response(projections: Pick<CommandResponse, 'gameProjection' | 'movementProjection'>): CommandResponse {
  return {
    receipt: { ok: true, commandId: 'command-1', eventIds: [], newAggregateVersion: 4 },
    ...projections,
  };
}

describe('command response projections', () => {
  it('uses the returned projection unless the socket reports a newer character revision', () => {
    const game = projectionAt(4);

    expect(commandResultProjection(response({ gameProjection: game }))).toBe(game);
    expect(commandResultProjection(response({ gameProjection: game }), 3)).toBe(game);
    expect(commandResultProjection(response({ gameProjection: game }), 4)).toBe(game);
    expect(commandResultProjection(response({ gameProjection: game }), 5)).toBeUndefined();
  });

  it('accepts a movement projection from servers that only return it for moves', () => {
    const movement = projectionAt(7);
    const game = projectionAt(8);

    expect(commandResultProjection(response({ movementProjection: movement }), 7)).toBe(movement);
    expect(commandResultProjection(response({ movementProjection: movement, gameProjection: game }))).toBe(game);
    expect(commandResultProjection(response({}), 1)).toBeUndefined();
  });
});
