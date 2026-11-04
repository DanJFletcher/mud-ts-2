import {
  ArchiveCharacterCommandSchema,
  CharacterArchivedEventSchema,
  CharacterCreatedEventV2Schema,
  CharacterCreatedEventV3Schema,
  CharacterRenamedEventSchema,
  CharacterRestoredEventSchema,
  CreateCharacterCommandSchema,
  DEFAULT_CHARACTER_ATTRIBUTES,
  DEFAULT_CHARACTER_HONORS,
  DEFAULT_CHARACTER_RESOURCES,
  RenameCharacterCommandSchema,
  RestoreCharacterCommandSchema,
} from '@mudd/contracts';
import { RuleViolationError, type PluginContext } from '@mudd/engine-core';
import { classCombatPolicyCapability, type ClassCombatPolicy } from '../classes.js';
import { maximumHealthForLevel } from '../character-stats.js';
import type { CharacterStateCapability } from './state.js';

type CharacterCreationRegistrations = Pick<PluginContext, 'registerCommand' | 'optionalCapability'>;
type CharacterManagementRegistrations = Pick<PluginContext, 'registerCommand'>;

export function registerCharacterCreation(
  { registerCommand, optionalCapability }: CharacterCreationRegistrations,
): void {
  registerCommand('character.create', CreateCharacterCommandSchema, async (command, context) => {
    const name = command.payload.name.trim();
    if (!name || name.length > 48) {
      throw new RuleViolationError('Choose a character name between 1 and 48 characters.');
    }
    const startingLocation = context.world.locations[0];
    if (!startingLocation) throw new Error('This world has no starting location.');
    const characterId = context.makeId();
    const classes = optionalCapability<ClassCombatPolicy>(classCombatPolicyCapability);
    if (!classes && command.payload.classId) {
      throw new RuleViolationError('CLASS_UNSUPPORTED: This world does not use classes.');
    }
    const snapshot = classes?.select(command.payload.classId);
    const maximum = snapshot ? maximumHealthForLevel(1, snapshot.attributes.constitution) : undefined;
    const payload = {
      characterId,
      playerId: context.session.playerId,
      name,
      startingLocationId: startingLocation.id,
      ...(startingLocation.defaultStateId ? { startingStateId: startingLocation.defaultStateId } : {}),
      attributes: snapshot?.attributes ?? DEFAULT_CHARACTER_ATTRIBUTES,
      ...(snapshot ? { characterClass: snapshot, health: { current: maximum!, maximum: maximum! } } : {}),
      honors: DEFAULT_CHARACTER_HONORS,
      resources: DEFAULT_CHARACTER_RESOURCES,
      ...(context.world.currency
        ? {
          wallet: {
            currencyId: context.world.currency.id,
            balance: context.world.currency.startingBalance,
          },
        }
        : {}),
    };
    (snapshot ? CharacterCreatedEventV3Schema : CharacterCreatedEventV2Schema).shape.payload.parse(payload);
    return {
      streamId: characterId,
      streamKind: 'character',
      expectedVersion: 0,
      events: [{ type: 'character.created', version: snapshot ? 3 : 2, payload }],
    };
  });
}

export function registerCharacterManagement(
  { registerCommand }: CharacterManagementRegistrations,
  state: CharacterStateCapability,
): void {
  registerCommand('character.rename', RenameCharacterCommandSchema, async (command, context) => {
    const character = await state.load(context, command.characterId);
    if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
    const name = command.payload.name.trim();
    if (!name || name.length > 48) {
      throw new RuleViolationError('Choose a character name between 1 and 48 characters.');
    }
    CharacterRenamedEventSchema.shape.payload.parse({ characterId: character.characterId, name });
    return {
      streamId: command.characterId,
      streamKind: 'character',
      expectedVersion: command.expectedVersion,
      events: [{ type: 'character.renamed', version: 1, payload: { characterId: command.characterId, name } }],
    };
  });

  registerCommand('character.archive', ArchiveCharacterCommandSchema, async (command, context) => {
    const character = await state.load(context, command.characterId);
    if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
    CharacterArchivedEventSchema.shape.payload.parse({ characterId: character.characterId });
    return {
      streamId: command.characterId,
      streamKind: 'character',
      expectedVersion: command.expectedVersion,
      events: [{ type: 'character.archived', version: 1, payload: { characterId: character.characterId } }],
    };
  });

  registerCommand('character.restore', RestoreCharacterCommandSchema, async (command, context) => {
    const character = await state.load(context, command.characterId);
    if (!character || !character.archived) {
      throw new RuleViolationError('That archived character is no longer available.');
    }
    CharacterRestoredEventSchema.shape.payload.parse({ characterId: character.characterId });
    return {
      streamId: command.characterId,
      streamKind: 'character',
      expectedVersion: command.expectedVersion,
      events: [{ type: 'character.restored', version: 1, payload: { characterId: character.characterId } }],
    };
  });
}
