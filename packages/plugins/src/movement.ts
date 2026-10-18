import {
  CharacterMovedEventSchema,
  MoveCharacterCommandSchema,
} from '@mudd/contracts';
import type { EnginePlugin } from '@mudd/engine-core';
import type { CharacterProjection } from '@mudd/contracts';
import type { EngineCommandContext } from '@mudd/engine-core';

interface CharacterStateCapability {
  load(context: EngineCommandContext, characterId: string): Promise<CharacterProjection | undefined>;
}

export const movementPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.movement',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    requiredPlugins: { 'mudd.character': '^1.0.0' },
    requires: ['mudd.character.state.v1'],
    provides: ['mudd.movement.v1'],
  },
  register({ registerCommand, requireCapability }) {
    const characterState = requireCapability<CharacterStateCapability>('mudd.character.state.v1');
    registerCommand('character.move', MoveCharacterCommandSchema, async (command, context) => {
      const character = await characterState.load(context, command.characterId);
      if (!character || character.archived) throw new Error('That character is no longer available.');
      const exit = context.world.locations
        .find((location) => location.id === character.locationId)
        ?.exits.find((candidate) => candidate.id === command.payload.exitId);
      if (!exit) throw new Error('That exit is not available from your current location.');
      if (
        exit.requiredInteractionId &&
        !character.itemUseObservations.some((observation) =>
          observation.interactionId === exit.requiredInteractionId && observation.locationId === character.locationId,
        )
      ) {
        throw new Error('That passage is still sealed.');
      }
      CharacterMovedEventSchema.shape.payload.parse({
        characterId: command.characterId,
        fromLocationId: character.locationId,
        toLocationId: exit.toLocationId,
        exitId: exit.id,
      });
      return {
        streamId: command.characterId,
        expectedVersion: command.expectedVersion,
        events: [{
          type: 'character.moved',
          version: 1,
          payload: {
            characterId: command.characterId,
            fromLocationId: character.locationId,
            toLocationId: exit.toLocationId,
            exitId: exit.id,
          },
        }],
      };
    });
  },
};
