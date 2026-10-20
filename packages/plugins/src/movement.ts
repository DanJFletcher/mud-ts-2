import {
  CharacterMovedEventSchema,
  MoveCharacterCommandSchema,
} from '@mudd/contracts';
import type { CapabilityToken, WorldPackDraft } from '@mudd/contracts';
import type { EnginePlugin } from '@mudd/engine-core';
import type { CharacterProjection } from '@mudd/contracts';
import type { EngineCommandContext, ProposedEventEffect } from '@mudd/engine-core';
import { RuleViolationError } from '@mudd/engine-core';
import { assertCharacterAlive, characterStateCapability } from './character.js';

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
): MovementPlan {
  assertCharacterAlive(character);
  if (character.combat?.status === 'active') {
    throw new RuleViolationError('You cannot leave while combat is active. Flee first.');
  }
  const location = world.locations.find((candidate) => candidate.id === character.locationId);
  const exit = location?.exits.find((candidate) => candidate.id === exitId);
  if (!exit) throw new RuleViolationError('That exit is not available from your current location.');
  if (exit.roadId && !allowRoad) {
    throw new RuleViolationError('That exit is part of a road. Travel one road segment at a time.');
  }
  const destination = world.locations.find((candidate) => candidate.id === exit.toLocationId);
  if (
    destination?.requiredVisitedLocationId &&
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
  const payload = {
    characterId: character.characterId,
    fromLocationId: character.locationId,
    toLocationId: exit.toLocationId,
    exitId: exit.id,
  };
  CharacterMovedEventSchema.shape.payload.parse(payload);
  return {
    exit,
    events: [{ type: 'character.moved', version: 1, payload }],
    effects: [{
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
      const plan = createMovementPlan(context.world, character, command.payload.exitId);
      return {
        streamId: command.characterId,
        expectedVersion: command.expectedVersion,
        events: plan.events,
        effects: plan.effects,
      };
    });
  },
};
