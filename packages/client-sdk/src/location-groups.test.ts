import { describe, expect, it } from 'vitest';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import { MuddHttpClient } from './index.js';

describe('MuddHttpClient location-group query', () => {
  it('requests and validates the structured group projection', async () => {
    let requestBody: unknown;
    const client = new MuddHttpClient({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      fetcher: async (input, init) => {
        expect(String(input)).toBe('/api/queries');
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          ok: true,
          value: {
            worldInstanceId: DEMO_WORLD_INSTANCE_ID,
            currentLocationId: 'glasswater-bridge',
            packId: demoWorld.packId,
            packVersion: demoWorld.packVersion,
            groups: [{
              id: 'clearwater',
              name: 'Clearwater',
              type: 'settlement',
              locationIds: ['glasswater-bridge'],
              primaryLocationIds: ['glasswater-bridge'],
            }],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const result = await client.getLocationGroups('character-1', 'query-1');
    expect(requestBody).toMatchObject({
      type: 'location.groups.list',
      queryId: 'query-1',
      characterId: 'character-1',
      payload: {},
    });
    expect(result.groups[0]).toMatchObject({
      id: 'clearwater',
      locationIds: ['glasswater-bridge'],
    });
  });
});
