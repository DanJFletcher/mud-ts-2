import {
  CharacterArchivedEventSchema,
  CharacterCreatedEventSchema,
  CharacterCreatedEventV2Schema,
  CharacterCreatedEventV3Schema,
  CharacterProjectionSchema,
  CharacterRenamedEventSchema,
  CharacterRestoredEventSchema,
  DEFAULT_CHARACTER_RESOURCES,
} from '@mudd/contracts';
import type { StoredGameEvent } from '../types.js';

type ReplayState = ReturnType<typeof CharacterProjectionSchema.parse>;
type CreatedEvent =
  | ReturnType<typeof CharacterCreatedEventSchema.parse>
  | ReturnType<typeof CharacterCreatedEventV2Schema.parse>
  | ReturnType<typeof CharacterCreatedEventV3Schema.parse>;

function publicEvent(event: StoredGameEvent) {
  const { streamId: _streamId, ...value } = event;
  return value;
}

function parseCreatedEvent(event: StoredGameEvent): CreatedEvent {
  if (event.version === 3) return CharacterCreatedEventV3Schema.parse(publicEvent(event));
  if (event.version === 2) return CharacterCreatedEventV2Schema.parse(publicEvent(event));
  return CharacterCreatedEventSchema.parse(publicEvent(event));
}

function hasMismatchedCreationSnapshot(created: CreatedEvent): boolean {
  const { payload } = created;
  return 'characterClass' in payload &&
    JSON.stringify(payload.attributes) !== JSON.stringify(payload.characterClass.attributes);
}

function validateCreationSnapshot(created: CreatedEvent): void {
  if (hasMismatchedCreationSnapshot(created)) {
    throw new Error('Class creation attributes must match its recorded snapshot.');
  }
}

function creationIdentity(event: StoredGameEvent, created: CreatedEvent) {
  return { worldInstanceId: event.worldInstanceId, characterId: created.payload.characterId, name: created.payload.name };
}

function creationPosition(created: CreatedEvent) {
  return { locationId: created.payload.startingLocationId };
}

function creationLocationState(created: CreatedEvent) {
  return created.payload.startingStateId ? { locationStateId: created.payload.startingStateId } : {};
}

function creationVisit(event: StoredGameEvent, created: CreatedEvent) {
  return { visitedLocationIds: [created.payload.startingLocationId], revision: event.aggregateVersion };
}

function creationAttributes(created: CreatedEvent) {
  return { ...(created.payload.attributes ? { attributes: created.payload.attributes } : {}), ...(created.payload.honors ? { honors: created.payload.honors } : {}) };
}

function creationClass(created: CreatedEvent) {
  return 'characterClass' in created.payload
    ? { characterClass: created.payload.characterClass, health: created.payload.health }
    : {};
}

function creationResources(created: CreatedEvent) {
  return 'resources' in created.payload
    ? { resources: created.payload.resources }
    : { resources: DEFAULT_CHARACTER_RESOURCES };
}

function creationWallet(created: CreatedEvent) {
  return created.payload.wallet ? { wallet: created.payload.wallet } : {};
}

function creationProfile(created: CreatedEvent) {
  return { ...creationAttributes(created), ...creationClass(created), ...creationResources(created), ...creationWallet(created) };
}

function initialProjectionData(event: StoredGameEvent, created: CreatedEvent) {
  return { ...creationIdentity(event, created), ...creationPosition(created), ...creationLocationState(created), ...creationVisit(event, created), ...creationProfile(created) };
}

function initialProjection(event: StoredGameEvent, created: CreatedEvent) {
  return CharacterProjectionSchema.parse(initialProjectionData(event, created));
}

export function replayCharacterCreated(event: StoredGameEvent): ReplayState {
  const created = parseCreatedEvent(event);
  validateCreationSnapshot(created);
  return initialProjection(event, created);
}

function applyUpdate(state: ReplayState, event: StoredGameEvent, update: Partial<ReplayState>): ReplayState {
  return CharacterProjectionSchema.parse({ ...state, ...update, revision: event.aggregateVersion });
}

function validateRename(state: ReplayState, event: StoredGameEvent, characterId: string): void {
  if (characterId !== state.characterId || state.archived) {
    throw new Error(`Invalid rename event at revision ${event.aggregateVersion}.`);
  }
}

export function replayCharacterRenamed(state: ReplayState, event: StoredGameEvent): ReplayState {
  const renamed = CharacterRenamedEventSchema.parse(publicEvent(event));
  validateRename(state, event, renamed.payload.characterId);
  return applyUpdate(state, event, { name: renamed.payload.name });
}

function validateArchive(state: ReplayState, event: StoredGameEvent, characterId: string): void {
  if (characterId !== state.characterId || state.archived) {
    throw new Error(`Invalid archive event at revision ${event.aggregateVersion}.`);
  }
}

export function replayCharacterArchived(state: ReplayState, event: StoredGameEvent): ReplayState {
  const archived = CharacterArchivedEventSchema.parse(publicEvent(event));
  validateArchive(state, event, archived.payload.characterId);
  return applyUpdate(state, event, { archived: true });
}

function validateRestore(state: ReplayState, event: StoredGameEvent, characterId: string): void {
  if (characterId !== state.characterId || !state.archived) {
    throw new Error(`Invalid restore event at revision ${event.aggregateVersion}.`);
  }
}

export function replayCharacterRestored(state: ReplayState, event: StoredGameEvent): ReplayState {
  const restored = CharacterRestoredEventSchema.parse(publicEvent(event));
  validateRestore(state, event, restored.payload.characterId);
  return applyUpdate(state, event, { archived: false });
}
