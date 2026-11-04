import { describe, expect, it } from 'vitest';
import { orravethWorld } from './index.js';

const locations = new Map(orravethWorld.locations.map((location) => [location.id, location]));

describe('Bellwold Phase 3', () => {
  describe('settlement membership and political metadata', () => {
    it.each([
      { settlementId: 'ashcombe', codexId: 'orraveth-ashcombe', politicalStatus: 'crown-of-heskar' },
      { settlementId: 'thornmere', codexId: 'orraveth-thornmere', politicalStatus: 'independent' },
    ])('$settlementId has five primary locations and its authored political status', ({ settlementId, codexId, politicalStatus }) => {
      const settlement = orravethWorld.locationGroups.find(({ id }) => id === settlementId);
      expect(settlement).toMatchObject({ type: 'settlement', metadata: { codexId, politicalStatus } });
      expect(settlement?.memberships).toHaveLength(5);
      expect(settlement?.memberships.every(({ isPrimary }) => isPrimary)).toBe(true);
    });

    it('Mosswake preserves its ordered primary locations and independence', () => {
      const settlement = orravethWorld.locationGroups.find(({ id }) => id === 'mosswake');
      expect(settlement).toMatchObject({ type: 'settlement', metadata: { codexId: 'orraveth-mosswake', politicalStatus: 'independent' } });
      expect(settlement?.memberships.map(({ locationId }) => locationId)).toEqual([
        'mosswake-landing', 'mosswake-boat-sheds', 'mosswake-herb-platform', 'mosswake-territory-edge', 'mosswake-south-platforms',
      ]);
      expect(settlement?.memberships.every(({ isPrimary }) => isPrimary)).toBe(true);
    });
  });

  describe('non-primary road routes', () => {
    it.each([
      { routeId: 'ashcombe-timber-road-route', roadId: 'ashcombe-timber-road' },
      { routeId: 'thornmere-path-route', roadId: 'thornmere-path' },
      { routeId: 'mosswake-causeway-route', roadId: 'mosswake-causeway' },
    ])('$routeId follows the ordered road locations without primary membership', ({ routeId, roadId }) => {
      const route = orravethWorld.locationGroups.find(({ id }) => id === routeId);
      const road = orravethWorld.roads.find(({ id }) => id === roadId);
      expect(road, roadId).toBeDefined();
      expect(route, routeId).toMatchObject({ type: 'route' });
      expect(route?.memberships.map(({ locationId }) => locationId)).toEqual(road?.locationIds);
      expect(route?.memberships.every(({ isPrimary }) => !isPrimary)).toBe(true);
    });
  });

  describe('NPC identities', () => {
    it('Oren Kest works at Kest workshop', () => {
      expect(locations.get('ashcombe-kest-workshop')?.npcs?.[0]).toMatchObject({ id: 'oren-kest', name: 'Oren Kest' });
    });

    it('Cartwright remains an unnamed role at the cart yard', () => {
      expect(locations.get('ashcombe-cart-yard')?.npcs?.[0]).toMatchObject({ id: 'ashcombe-cartwright', name: 'Cartwright' });
    });

    it('Nessa Valeen is at the council house', () => {
      expect(locations.get('thornmere-council-house')?.npcs?.[0]).toMatchObject({ id: 'nessa-valeen', name: 'Nessa Valeen' });
    });

    it('Herbalist remains an unnamed role at the herb platform', () => {
      expect(locations.get('mosswake-herb-platform')?.npcs?.[0]).toMatchObject({ id: 'mosswake-herbalist', name: 'Herbalist' });
    });

    it('Tavin Reed is at the boat sheds', () => {
      const tavin = locations.get('mosswake-boat-sheds')?.npcs?.[0];
      expect(tavin).toMatchObject({ id: 'tavin-reed', name: 'Tavin Reed' });
    });

    it('preserves the ordered roster of three named people and two unnamed roles', () => {
      const npcs = orravethWorld.locations.filter(({ id }) => /^(mosswake-|thornmere-|ashcombe-)/.test(id))
        .flatMap((location) => location.npcs ?? []);
      expect(npcs.map(({ name }) => name)).toEqual(['Tavin Reed', 'Herbalist', 'Nessa Valeen', 'Oren Kest', 'Cartwright']);
    });
  });

  describe('authored restrictions', () => {
    it('Ashcombe grants no disputed harvesting rights and leaves the oak unexplained', () => {
      expect(orravethWorld.woodcuttingTrees.map(({ id }) => id)).toEqual(['bellwold-southbound-pine']);
      const oak = locations.get('ashcombe-felled-oak-clearing');
      expect(oak, 'ashcombe-felled-oak-clearing').toBeDefined();
      expect(oak?.takeables).toBeUndefined();
      expect(oak?.interactables).toBeUndefined();
      expect(oak?.itemUses).toBeUndefined();
      expect(oak?.npcs).toBeUndefined();
    });

    it('Thornmere bridge remains descriptive', () => {
      const bridge = locations.get('thornmere-shared-bridge');
      expect(bridge, 'thornmere-shared-bridge').toBeDefined();
      expect(bridge?.interactables).toBeUndefined();
      expect(bridge?.itemUses).toBeUndefined();
      expect(bridge?.npcs).toBeUndefined();
    });

    it('Thornmere healer stays offstage', () => {
      const healerHouse = locations.get('thornmere-healer-house');
      expect(healerHouse, 'thornmere-healer-house').toBeDefined();
      expect(healerHouse?.npcs).toBeUndefined();
    });

    it('Mosswake stops at the recognised territory edge', () => {
      expect(locations.get('mosswake-territory-edge')?.exits.map(({ toLocationId }) => toLocationId)).toEqual(['mosswake-herb-platform']);
    });

    it('Mosswake south platforms have no southward extension', () => {
      expect(locations.get('mosswake-south-platforms')?.exits.some(({ direction }) => direction === 'south')).toBe(false);
    });

    it('unfinished road retains its single return endpoint', () => {
      expect(locations.get('bellwold-unfinished-road-end')?.exits.map(({ toLocationId }) => toLocationId)).toEqual(['bellwold-south-mile-marker']);
    });

    it('later roads remain unauthored', () => {
      expect(orravethWorld.roads.some(({ id }) => /elderhollow|vells|greywatch|old-ground/.test(id))).toBe(false);
    });

    it('Mosswake fishing retains existing timing', () => {
      expect(orravethWorld.fishingSpots.find(({ locationId }) => locationId === 'mosswake-landing')).toMatchObject({ tickSeconds: 5 });
    });

    it('open-water notice grants no dredging permission or explanation', () => {
      const notice = locations.get('mosswake-open-water')?.readables?.[0];
      expect(notice?.text).toContain('not permission to dredge');
      expect(notice?.text).toContain('No agreement or explanation');
    });

    it('Tavin leaves the cause of declining fish unresolved', () => {
      const tavin = locations.get('mosswake-boat-sheds')?.npcs?.[0];
      expect(tavin?.dialogue?.choices.find(({ id }) => id === 'tavin-reed-fish')?.response).toContain('not proof of its cause');
    });
  });

  describe('Lower Rill topology and presentation', () => {
    it.each([
      { reachId: 'bellwold-river-far-east-reach', x: 3 },
      { reachId: 'lower-rill-sedge-reach', x: 4 },
      { reachId: 'mosswake-channel', x: 5 },
      { reachId: 'mosswake-open-water', x: 6 },
    ])('$reachId has its river map position and primary waterway membership', ({ reachId, x }) => {
      const group = orravethWorld.locationGroups.find(({ id }) => id === 'lower-rill');
      expect(locations.get(reachId)?.mapPosition).toMatchObject({ x, y: -7, terrain: 'river', visibleWhenUnvisited: true });
      expect(group?.memberships).toContainEqual({ locationId: reachId, isPrimary: true });
    });

    it.each([
      { westReachId: 'bellwold-river-far-east-reach', eastReachId: 'lower-rill-sedge-reach' },
      { westReachId: 'lower-rill-sedge-reach', eastReachId: 'mosswake-channel' },
      { westReachId: 'mosswake-channel', eastReachId: 'mosswake-open-water' },
    ])('$westReachId and $eastReachId have reciprocal east/west exits', ({ westReachId, eastReachId }) => {
      expect(locations.get(westReachId)?.exits).toEqual(expect.arrayContaining([
        expect.objectContaining({ toLocationId: eastReachId, direction: 'east' }),
      ]));
      expect(locations.get(eastReachId)?.exits).toEqual(expect.arrayContaining([
        expect.objectContaining({ toLocationId: westReachId, direction: 'west' }),
      ]));
    });

    it.each([
      { reachId: 'lower-rill-sedge-reach' },
      { reachId: 'mosswake-channel' },
      { reachId: 'mosswake-open-water' },
    ])('$reachId has only exits without road IDs', ({ reachId }) => {
      expect(locations.get(reachId)?.exits.every(({ roadId }) => roadId === undefined)).toBe(true);
    });

    it('Mosswake channel connects south to the landing', () => {
      expect(locations.get('mosswake-channel')?.exits).toContainEqual(expect.objectContaining({ toLocationId: 'mosswake-landing', direction: 'south' }));
    });
  });

  describe('settlement map presentation', () => {
    it('Thornmere lake uses river terrain', () => {
      expect(locations.get('thornmere-lake')?.mapPosition?.terrain).toBe('river');
    });

    it('Mosswake landing uses its marsh terrain and color', () => {
      expect(locations.get('mosswake-landing')?.mapPosition).toMatchObject({ terrain: 'marsh', mapColor: '#74865a' });
    });
  });

  describe('pack metadata and starting location', () => {
    it('preserves pack version 1.21.1', () => {
      expect(orravethWorld.packVersion).toBe('1.21.1');
    });

    it('starts at Bellwold market square', () => {
      expect(orravethWorld.locations[0]?.id).toBe('bellwold-market-square');
    });
  });
});
