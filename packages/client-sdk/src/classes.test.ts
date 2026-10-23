import { describe, expect, it } from 'vitest';
import { MuddHttpClient } from './index.js';

describe('typed class command transport', () => {
  it('preserves classless creation, and carries explicit class selection/adoption and abilities in each mode', async () => {
    const commands: Record<string, unknown>[] = [];
    const fetcher: typeof fetch = async (_path, init) => {
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      commands.push(command);
      return new Response(JSON.stringify({ receipt: { ok: true, commandId: command.commandId,
        eventIds: [], newAggregateVersion: 1 }, events: [] }), { status: 200 });
    };
    const client = new MuddHttpClient({ worldInstanceId: 'orraveth', fetcher });
    await client.createCharacter('Legacy', 'name-only');
    await client.createCharacter('New', 'with-class', 'orraveth.scout');
    await client.chooseCharacterClass('legacy', 4, 'orraveth.vanguard', 'adoption');
    await client.performCombatAction('solo', 'ability', 8, { encounterId: 'encounter',
      abilityId: 'orraveth.heavy-strike' }, 'solo-ability');
    await client.performTeamCombatAction('team', 'encounter', 'ability', { abilityId: 'orraveth.precise-strike' });
    await client.performPvpAction('pvp', 'encounter', 'ability', undefined, 'orraveth.directed-heat');
    expect(commands[0]!.payload).toEqual({ name: 'Legacy' });
    expect(commands[1]!.payload).toEqual({ name: 'New', classId: 'orraveth.scout' });
    expect(commands[2]).toMatchObject({ type: 'character.class.choose', characterId: 'legacy',
      expectedVersion: 4, payload: { classId: 'orraveth.vanguard' } });
    expect(commands.slice(3).map((command) => command.type)).toEqual(['combat.action', 'team.combat.action', 'pvp.action']);
    for (const command of commands.slice(3)) {
      expect(command.payload).toMatchObject({ action: 'ability', encounterId: 'encounter' });
      expect(command.payload).toHaveProperty('abilityId');
    }
  });
});
