import {
  CharacterCreatedEventSchema,
  CharacterRenamedEventSchema,
  CharacterArchivedEventSchema,
  CharacterRestoredEventSchema,
  RenameCharacterCommandSchema,
  ArchiveCharacterCommandSchema,
  RestoreCharacterCommandSchema,
  CreateCharacterCommandSchema,
  LocationDescribeQuerySchema,
  ObjectReadQuerySchema,
  LocationProjectionSchema,
  ReadableObjectProjectionSchema,
} from '@mudd/contracts';
import type { EngineCommandContext, EnginePlugin, QueryContext } from '@mudd/engine-core';
import { replayCharacter } from '@mudd/engine-core';
import type { CharacterProjection } from '@mudd/contracts';

interface CharacterStateCapability {
  load(context: EngineCommandContext | QueryContext, characterId: string): Promise<CharacterProjection | undefined>;
}

export const characterPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.character',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    provides: ['mudd.character.state.v1'],
  },
  register({ registerCommand, registerQuery, provideCapability }) {
    const state: CharacterStateCapability = {
      async load(context, characterId) {
        return replayCharacter(await context.store.readStream(context.worldInstanceId, characterId));
      },
    };
    provideCapability<CharacterStateCapability>('mudd.character.state.v1', state);

    registerCommand('character.create', CreateCharacterCommandSchema, async (command, context) => {
      const name = command.payload.name.trim();
      if (!name || name.length > 48) throw new Error('Choose a character name between 1 and 48 characters.');
      const startingLocationId = context.world.locations[0]?.id;
      if (!startingLocationId) throw new Error('This world has no starting location.');
      const characterId = context.makeId();
      const payload = {
        characterId,
        playerId: context.session.playerId,
        name,
        startingLocationId,
      };
      CharacterCreatedEventSchema.shape.payload.parse(payload);
      return {
        streamId: characterId,
        expectedVersion: 0,
        events: [{ type: 'character.created', version: 1, payload }],
      };
    });

    registerCommand('character.rename', RenameCharacterCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || character.archived) throw new Error('That character is no longer available.');
      const name = command.payload.name.trim();
      if (!name || name.length > 48) throw new Error('Choose a character name between 1 and 48 characters.');
      CharacterRenamedEventSchema.shape.payload.parse({ characterId: character.characterId, name });
      return {
        streamId: command.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.renamed', version: 1, payload: { characterId: command.characterId, name } }],
      };
    });

    registerCommand('character.archive', ArchiveCharacterCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || character.archived) throw new Error('That character is no longer available.');
      CharacterArchivedEventSchema.shape.payload.parse({ characterId: character.characterId });
      return {
        streamId: command.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.archived', version: 1, payload: { characterId: command.characterId } }],
      };
    });

    registerCommand('character.restore', RestoreCharacterCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || !character.archived) throw new Error('That archived character is no longer available.');
      CharacterRestoredEventSchema.shape.payload.parse({ characterId: character.characterId });
      return {
        streamId: command.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.restored', version: 1, payload: { characterId: command.characterId } }],
      };
    });

    registerQuery('location.describe', LocationDescribeQuerySchema, async (query, context) => {
      const character = await state.load(context, query.characterId);
      if (!character || character.archived) throw new Error('That character is no longer available.');
      const requestedLocationId = query.payload.locationId;
      if (requestedLocationId && requestedLocationId !== character.locationId) {
        throw new Error('You can only inspect your current location.');
      }
      const location = context.world.locations.find((item) => item.id === character.locationId);
      if (!location) throw new Error('The character location is not present in this world version.');
      return LocationProjectionSchema.parse({
        worldInstanceId: context.worldInstanceId,
        locationId: location.id,
        revision: character.revision,
        title: location.name,
        description: location.description,
        exits: location.exits.map((exit) => ({
          id: exit.id,
          label: exit.label,
          direction: exit.direction,
          available: true,
        })),
        objects: (location.readables ?? []).map(({ id, label, description }) => ({ id, label, description })),
        occupants: [],
      });
    });

    registerQuery('object.read', ObjectReadQuerySchema, async (query, context) => {
      const character = await state.load(context, query.characterId);
      if (!character || character.archived) throw new Error('That character is no longer available.');
      const location = context.world.locations.find((item) => item.id === character.locationId);
      if (!location) throw new Error('The character location is not present in this world version.');
      const readable = (location.readables ?? []).find((item) => item.id === query.payload.objectId);
      if (!readable) throw new Error('That object is not readable from here.');
      return ReadableObjectProjectionSchema.parse({
        id: readable.id,
        label: readable.label,
        text: readable.text,
      });
    });
  },
};
