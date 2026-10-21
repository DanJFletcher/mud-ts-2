import type { WorldPackDraft } from '@mudd/contracts';

export type WorldLocation = WorldPackDraft['locations'][number];

export function resolveLocationState(
  location: WorldLocation,
  requestedStateId?: string,
) {
  if (!location.states?.length) {
    if (requestedStateId) {
      throw new Error(`Character state ${requestedStateId} is invalid for location ${location.id}.`);
    }
    return undefined;
  }

  const stateId = requestedStateId ?? location.defaultStateId;
  const state = location.states.find((candidate) => candidate.id === stateId);
  if (!state) {
    throw new Error(`Location ${location.id} has no valid default state.`);
  }
  return state;
}

export function exitsForLocationState(
  location: WorldLocation,
  stateId?: string,
) {
  return location.exits.filter((exit) => !exit.fromStateId || exit.fromStateId === stateId);
}
