import { describe, expect, it } from 'vitest';
import { demoWorld } from '@mudd/world-demo';
import { exitsForLocationState, resolveLocationState } from './location-state.js';

function locationWithStates() {
  const location = structuredClone(
    demoWorld.locations.find((candidate) => candidate.id === 'mossgate-clearing')!,
  );
  location.defaultStateId = 'day';
  location.states = [
    { id: 'day', name: 'Day', description: 'Sunlight rests on the stones.' },
    { id: 'night', name: 'Night', description: 'The stones are cold beneath the dark.' },
  ];
  location.exits[0]!.fromStateId = 'day';
  location.exits[1]!.fromStateId = 'night';
  return location;
}

describe('location state helpers', () => {
  it('allows locations without states unless a state is explicitly requested', () => {
    const location = structuredClone(
      demoWorld.locations.find((candidate) => candidate.id === 'mossgate-clearing')!,
    );
    location.states = undefined;
    location.defaultStateId = undefined;

    expect(resolveLocationState(location)).toBeUndefined();
    expect(() => resolveLocationState(location, 'day'))
      .toThrow('Character state day is invalid for location mossgate-clearing.');
  });

  it('resolves the default or explicitly requested state', () => {
    const location = locationWithStates();
    expect(resolveLocationState(location)?.id).toBe('day');
    expect(resolveLocationState(location, 'night')?.id).toBe('night');
  });

  it('rejects a missing default or an unknown state', () => {
    const location = locationWithStates();
    location.defaultStateId = undefined;
    expect(() => resolveLocationState(location))
      .toThrow('Location mossgate-clearing has no valid default state.');
    expect(() => resolveLocationState(location, 'dusk'))
      .toThrow('Location mossgate-clearing has no valid default state.');
  });

  it('keeps global exits and only exits matching the active state', () => {
    const location = locationWithStates();
    const exits = exitsForLocationState(location, 'day');

    expect(exits.some((exit) => !exit.fromStateId)).toBe(true);
    expect(exits.some((exit) => exit.fromStateId === 'day')).toBe(true);
    expect(exits.some((exit) => exit.fromStateId === 'night')).toBe(false);
  });
});
