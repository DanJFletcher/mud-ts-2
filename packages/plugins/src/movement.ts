import {
  CharacterMovedEventSchema,
  MoveCharacterCommandSchema,
} from '@mudd/contracts';
import type { CapabilityToken, WorldPackDraft } from '@mudd/contracts';
import type { EnginePlugin } from '@mudd/engine-core';
import type { CharacterProjection } from '@mudd/contracts';
import type { EngineCommandContext, ProposedEventEffect } from '@mudd/engine-core';
import { RuleViolationError } from '@mudd/engine-core';
import { MOVEMENT_STAMINA_COST } from '@mudd/contracts';
import {
  assertCharacterAlive, characterStateCapability, staminaRecoveryEvent,
} from './character.js';
import { exitsForLocationState, resolveLocationState } from './location-state.js';

interface CharacterStateCapability {
  load(context: EngineCommandContext, characterId: string): Promise<CharacterProjection | undefined>;
}

export interface MovementPlan {
  readonly exit: WorldPackDraft['locations'][number]['exits'][number];
  readonly events: readonly { readonly type: string; readonly version: number; readonly payload: Readonly<Record<string, unknown>> }[];
  readonly effects: readonly ProposedEventEffect[];
}

export interface MovementPolicyCapability {
  plan(
    world: WorldPackDraft,
    character: CharacterProjection,
    exitId: string,
    allowRoad?: boolean,
    now?: Date,
  ): MovementPlan;
}

export const movementPolicyCapability = Object.freeze({
  id: 'mudd.movement.policy.v1',
  version: '1',
}) satisfies CapabilityToken<MovementPolicyCapability>;

export function createMovementPlan(
  world: WorldPackDraft,
  character: CharacterProjection,
  exitId: string,
  allowRoad = false,
  now = new Date(),
): MovementPlan {
  assertCharacterAlive(character);
  if (character.staminaRecovery.posture === 'resting') {
    throw new RuleViolationError('You are resting. Stand before you move.');
  }
  if (character.combat?.status === 'active') {
    throw new RuleViolationError('You cannot leave while combat is active. Flee first.');
  }
  const location = world.locations.find((candidate) => candidate.id === character.locationId);
  if (!location) throw new RuleViolationError('Your current location is not available.');
  const currentState = resolveLocationState(location, character.locationStateId);
  const exit = exitsForLocationState(location, currentState?.id)
    .find((candidate) => candidate.id === exitId);
  if (!exit) throw new RuleViolationError('That exit is not available from your current location.');
  if (exit.roadId && !allowRoad) {
    throw new RuleViolationError('That exit is part of a road. Travel one road segment at a time.');
  }
  const destination = world.locations.find((candidate) => candidate.id === exit.toLocationId);
  if (!destination) throw new RuleViolationError('That destination is not available.');
  const destinationState = resolveLocationState(destination, exit.toStateId);
  if (
    destination.requiredVisitedLocationId &&
    !character.visitedLocationIds.includes(destination.requiredVisitedLocationId)
  ) {
    const requiredLocation = world.locations.find((candidate) =>
      candidate.id === destination.requiredVisitedLocationId,
    );
    throw new RuleViolationError(
      `You must first visit ${requiredLocation?.name ?? 'the required place'} before entering ${destination.name}.`,
    );
  }
  if (
    exit.requiredInteractionId &&
    !character.itemUseObservations.some((observation) =>
      observation.interactionId === exit.requiredInteractionId && observation.locationId === character.locationId,
    )
  ) {
    throw new RuleViolationError('That passage is still sealed.');
  }
  const recoveryEvent = staminaRecoveryEvent(character, now);
  const recoveredResources = recoveryEvent.payload.resources as CharacterProjection['resources'];
  if (recoveredResources.stamina.current < MOVEMENT_STAMINA_COST) {
    throw new RuleViolationError(
      `You need ${MOVEMENT_STAMINA_COST} stamina to travel; you have ${recoveredResources.stamina.current}.`,
    );
  }
  const payload = {
    characterId: character.characterId,
    fromLocationId: character.locationId,
    toLocationId: exit.toLocationId,
    fromStateId: currentState?.id ?? null,
    toStateId: destinationState?.id ?? null,
    exitId: exit.id,
    movementCost: MOVEMENT_STAMINA_COST,
  };
  CharacterMovedEventSchema.shape.payload.parse(payload);
  return {
    exit,
    events: [
      recoveryEvent,
      { type: 'character.moved', version: 1, payload },
    ],
    effects: exit.toLocationId === character.locationId ? [] : [{
      type: 'world.location.entered',
      version: 1,
      payload: {
        characterId: character.characterId,
        fromLocationId: character.locationId,
        toLocationId: exit.toLocationId,
      },
    }],
  };
}

export const movementPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.movement',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    requiredPlugins: { 'mudd.character': '^1.0.0' },
    requires: ['mudd.character.state.v1'],
    provides: ['mudd.movement.v1', movementPolicyCapability.id],
  },
  register({ registerCommand, requireCapability, provideCapability }) {
    const characterState = requireCapability<CharacterStateCapability>(characterStateCapability);
    provideCapability(movementPolicyCapability, { plan: createMovementPlan });
    registerCommand('character.move', MoveCharacterCommandSchema, async (command, context) => {
      const character = await characterState.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const plan = createMovementPlan(context.world, character, command.payload.exitId, false, context.now());
      return {
        streamId: command.characterId,
        expectedVersion: command.expectedVersion,
        events: plan.events,
        effects: plan.effects,
      };
    });
  },
};
