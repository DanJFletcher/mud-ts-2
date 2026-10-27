import { describe, expect, it } from 'vitest';
import { combatRoomPresenceCapability } from './combat-presence.js';

describe('combat room presence capability contract', () => {
  it('has a stable capability identity and version', () => {
    expect(combatRoomPresenceCapability).toEqual({
      id: 'mudd.combat.room-presence.v1',
      version: '1',
    });
  });
});
