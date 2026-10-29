import {
  LocationProjectionSchema,
  type LocationProjection,
} from '@mudd/contracts';
import type { WoodcuttingTreePresence } from '@mudd/core-plugins';

export function projectWoodcuttingRoom(
  location: LocationProjection,
  treePresence: readonly WoodcuttingTreePresence[],
) {
  const localTrees = treePresence.filter((tree) => tree.locationId === location.locationId);
  return {
    location: LocationProjectionSchema.parse({
      ...location,
      description: [
        location.description,
        ...localTrees.map((tree) => tree.description),
      ].filter(Boolean).join('\n\n'),
    }),
    availableTrees: localTrees
      .filter((tree) => tree.available)
      .map(({ id, label }) => ({ id, label })),
  };
}
