import { READABLE_ACTIONS_VERSION, type LocationProjection } from '@mudd/contracts';

/** Legacy SDKs use strict object schemas. Never mutate a shared engine projection. */
export function locationForClient(location: LocationProjection, version: string | undefined): LocationProjection {
  if (version === READABLE_ACTIONS_VERSION) return location;
  return { ...location, objects: location.objects.map(({ readAction: _action, ...object }) => object) };
}
