import { describe, expect, it } from 'vitest';
import { orravethWorld } from './index.js';

const locations = new Map(orravethWorld.locations.map((location) => [location.id, location]));

describe('Bellwold Phase 3', () => {
  it('keeps Thornmere independent, its bridge descriptive, and the healer offstage', () => {
    const settlement = orravethWorld.locationGroups.find(({ id }) => id === 'thornmere');
    expect(settlement).toMatchObject({ type: 'settlement', metadata: { codexId: 'orraveth-thornmere', politicalStatus: 'independent' } });
    expect(settlement?.memberships).toHaveLength(5);
    expect(settlement?.memberships.every(({ isPrimary }) => isPrimary)).toBe(true);
    const route = orravethWorld.locationGroups.find(({ id }) => id === 'thornmere-path-route');
    expect(route).toMatchObject({ type: 'route' });
    expect(route?.memberships.map(({ locationId }) => locationId)).toEqual(orravethWorld.roads.find(({ id }) => id === 'thornmere-path')?.locationIds);
    expect(route?.memberships.every(({ isPrimary }) => !isPrimary)).toBe(true);
    const bridge = locations.get('thornmere-shared-bridge');
    expect(bridge?.interactables).toBeUndefined();
    expect(bridge?.itemUses).toBeUndefined();
    expect(bridge?.npcs).toBeUndefined();
    expect(locations.get('thornmere-healer-house')?.npcs).toBeUndefined();
    expect(locations.get('thornmere-lake')?.mapPosition?.terrain).toBe('river');
    expect(locations.get('thornmere-council-house')?.npcs?.[0]).toMatchObject({ id: 'nessa-valeen', name: 'Nessa Valeen' });
  });

  it('gives Mosswake one primary settlement and a non-primary causeway route', () => {
    const settlement = orravethWorld.locationGroups.find(({ id }) => id === 'mosswake');
    expect(settlement).toMatchObject({ type: 'settlement', metadata: { codexId: 'orraveth-mosswake', politicalStatus: 'independent' } });
    expect(settlement?.memberships.map(({ locationId }) => locationId)).toEqual([
      'mosswake-landing', 'mosswake-boat-sheds', 'mosswake-herb-platform', 'mosswake-territory-edge', 'mosswake-south-platforms',
    ]);
    expect(settlement?.memberships.every(({ isPrimary }) => isPrimary)).toBe(true);
    const route = orravethWorld.locationGroups.find(({ id }) => id === 'mosswake-causeway-route');
    expect(route?.type).toBe('route');
    expect(route?.memberships.map(({ locationId }) => locationId)).toEqual(
      orravethWorld.roads.find(({ id }) => id === 'mosswake-causeway')?.locationIds,
    );
    expect(route?.memberships.every(({ isPrimary }) => !isPrimary)).toBe(true);
  });

  it('extends the Lower Rill east with paired plain exits and primary waterway membership', () => {
    const reaches = ['bellwold-river-far-east-reach', 'lower-rill-sedge-reach', 'mosswake-channel', 'mosswake-open-water'];
    const group = orravethWorld.locationGroups.find(({ id }) => id === 'lower-rill');
    for (const [index, id] of reaches.entries()) {
      expect(locations.get(id)?.mapPosition).toMatchObject({ x: 3 + index, y: -7, terrain: 'river', visibleWhenUnvisited: true });
      expect(group?.memberships).toContainEqual({ locationId: id, isPrimary: true });
      if (index === 0) continue;
      expect(locations.get(reaches[index - 1]!)?.exits).toEqual(expect.arrayContaining([
        expect.objectContaining({ toLocationId: id, direction: 'east' }),
      ]));
      expect(locations.get(id)?.exits).toEqual(expect.arrayContaining([
        expect.objectContaining({ toLocationId: reaches[index - 1], direction: 'west' }),
      ]));
      expect(locations.get(id)?.exits.every(({ roadId }) => roadId === undefined)).toBe(true);
    }
    expect(locations.get('mosswake-channel')?.exits).toContainEqual(expect.objectContaining({ toLocationId: 'mosswake-landing', direction: 'south' }));
  });

  it('stops at the recognised territory edge and leaves later roads and the unfinished road alone', () => {
    expect(locations.get('mosswake-territory-edge')?.exits.map(({ toLocationId }) => toLocationId)).toEqual(['mosswake-herb-platform']);
    expect(locations.get('mosswake-south-platforms')?.exits.some(({ direction }) => direction === 'south')).toBe(false);
    expect(locations.get('bellwold-unfinished-road-end')?.exits.map(({ toLocationId }) => toLocationId)).toEqual(['bellwold-south-mile-marker']);
    expect(orravethWorld.roads.some(({ id }) => /elderhollow|vells|greywatch|old-ground/.test(id))).toBe(false);
    expect(locations.get('mosswake-landing')?.mapPosition).toMatchObject({ terrain: 'marsh', mapColor: '#74865a' });
  });

  it('keeps fishing sparse with existing timing and leaves dredging and decline unresolved', () => {
    expect(orravethWorld.fishingSpots.find(({ locationId }) => locationId === 'mosswake-landing')).toMatchObject({ tickSeconds: 5 });
    const notice = locations.get('mosswake-open-water')?.readables?.[0];
    expect(notice?.text).toContain('not permission to dredge');
    expect(notice?.text).toContain('No agreement or explanation');
    const tavin = locations.get('mosswake-boat-sheds')?.npcs?.[0];
    expect(tavin).toMatchObject({ id: 'tavin-reed', name: 'Tavin Reed' });
    expect(tavin?.dialogue?.choices.find(({ id }) => id === 'tavin-reed-fish')?.response).toContain('not proof of its cause');
    expect(locations.get('mosswake-herb-platform')?.npcs?.[0]).toMatchObject({ id: 'mosswake-herbalist', name: 'Herbalist' });
  });
});
