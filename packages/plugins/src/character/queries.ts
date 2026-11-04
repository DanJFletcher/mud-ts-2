import {
  CharacterObjectReadEventSchema,
  ReadCharacterObjectCommandSchema,
  LocationDescribeQuerySchema,
  ObjectReadQuerySchema,
  ObjectInspectQuerySchema,
  LocationProjectionSchema,
  ReadableObjectProjectionSchema,
  ObjectInspectionProjectionSchema,
  locationGroupMembershipsForLocation,
  resolveLocationDisplayName,
  type NpcDefinition,
  type WorldPackDraft,
} from '@mudd/contracts';
import { RuleViolationError, type PluginContext } from '@mudd/engine-core';
import type { WorldItemsStateCapability } from '../world-items.js';
import { exitsForLocationState, resolveLocationState } from '../location-state.js';
import type { AutonomousNpcStateCapability } from '../autonomous-npcs.js';
import type { TemporaryCampfiresCapability } from '../temporary-campfires.js';
import {
  assertCharacterAlive,
  type CharacterStateCapability,
} from './state.js';

type CharacterReadRegistration = Pick<PluginContext, 'registerCommand'>;
type CharacterQueryRegistration = Pick<PluginContext, 'registerQuery'>;
type ProjectedWorldCorpse =
  Awaited<ReturnType<WorldItemsStateCapability['load']>>['corpses'][number];

interface CharacterQueryDependencies {
  state: CharacterStateCapability;
  worldItems: WorldItemsStateCapability;
  autonomousNpcs?: AutonomousNpcStateCapability;
  temporaryCampfires?: TemporaryCampfiresCapability;
}

function corpseDecayDescription(
  corpse: ProjectedWorldCorpse,
  now: Date,
  showStages: boolean,
): string {
  if (!showStages || !corpse.createdAt || !corpse.expiresAt) return corpse.description;
  const created = Date.parse(corpse.createdAt);
  const expires = Date.parse(corpse.expiresAt);
  const remaining = expires - now.getTime();
  if (expires <= created || remaining <= 0) return corpse.description;
  const fraction = remaining / (expires - created);
  if (fraction <= 0.25) return `${corpse.description} The remains are fading quickly.`;
  if (fraction <= 0.5) return `${corpse.description} The body is breaking down, its outline softening.`;
  if (fraction <= 0.75) return `${corpse.description} The body has begun to weather and darken.`;
  return corpse.description;
}

export function registerCharacterReadCommand(
  { registerCommand }: CharacterReadRegistration,
  state: CharacterStateCapability,
): void {
  registerCommand('character.read', ReadCharacterObjectCommandSchema, async (command, context) => {
    const character = await state.load(context, command.characterId);
    if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
    assertCharacterAlive(character);
    const location = context.world.locations.find((item) => item.id === character.locationId);
    if (!location) throw new Error('The character location is not present in this world version.');
    const readable = (location.readables ?? []).find((item) => item.id === command.payload.objectId);
    if (!readable) throw new RuleViolationError('That object is not readable from here.');
    const payload = {
      characterId: character.characterId,
      locationId: character.locationId,
      objectId: readable.id,
      label: readable.label,
      text: readable.text,
    };
    CharacterObjectReadEventSchema.shape.payload.parse(payload);
    return {
      streamId: command.characterId,
      streamKind: 'character',
      expectedVersion: command.expectedVersion,
      events: [{ type: 'character.object_read', version: 1, payload }],
    };
  });
}

export function registerCharacterQueries(
  { registerQuery }: CharacterQueryRegistration,
  { state, worldItems, autonomousNpcs, temporaryCampfires }: CharacterQueryDependencies,
): void {
  registerQuery('location.describe', LocationDescribeQuerySchema, async (query, context) => {
    const measureQuery = <T>(stage: string, run: () => Promise<T>) =>
      context.measureStage
        ? context.measureStage(`location.describe.${stage}`, run)
        : run();
    const character = await measureQuery('characterState', () => state.load(context, query.characterId));
    if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
    const requestedLocationId = query.payload.locationId;
    if (requestedLocationId && requestedLocationId !== character.locationId) {
      throw new RuleViolationError('You can only inspect your current location.');
    }
    const location = context.world.locations.find((item) => item.id === character.locationId);
    if (!location) throw new Error('The character location is not present in this world version.');
    const locationState = resolveLocationState(location, character.locationStateId);
    const availableExits = exitsForLocationState(location, locationState?.id);
    const projectedLocationIds = [
      location.id,
      ...availableExits.map((exit) => exit.toLocationId),
    ];
    const [roomNpcsByLocation, sharedState, campfiresByLocation] = await Promise.all([
      measureQuery('npcPositions', async () => {
        if (autonomousNpcs) return autonomousNpcs.atLocations(context, projectedLocationIds);
        return new Map(projectedLocationIds.map((locationId) => [
          locationId,
          context.world.locations.find((candidate) => candidate.id === locationId)?.npcs ?? [],
        ]));
      }),
      measureQuery('sharedItems', () => worldItems.load(context)),
      temporaryCampfires
        ? measureQuery('temporaryObjects', () =>
            temporaryCampfires.atLocations(context, projectedLocationIds))
        : Promise.resolve(new Map<string, readonly {
            id: string;
            label: string;
            description: string;
            readable: boolean;
            takeable: boolean;
          }[]>()),
    ]);
    const roomNpcsFor = (room: WorldPackDraft['locations'][number]): readonly NpcDefinition[] =>
      roomNpcsByLocation.get(room.id) ?? room.npcs ?? [];
    const roomNpcs = roomNpcsFor(location);
    const sharedItemsByLocation = new Map<string, Array<(typeof sharedState.items)[number]>>();
    for (const item of sharedState.items) {
      if (!item.locationId) continue;
      const items = sharedItemsByLocation.get(item.locationId) ?? [];
      items.push(item);
      sharedItemsByLocation.set(item.locationId, items);
    }
    const corpsesByLocation = new Map<string, Array<(typeof sharedState.corpses)[number]>>();
    for (const corpse of sharedState.corpses) {
      const corpses = corpsesByLocation.get(corpse.locationId) ?? [];
      corpses.push(corpse);
      corpsesByLocation.set(corpse.locationId, corpses);
    }
    const currencyDropsByLocation = new Map<string, Array<(typeof sharedState.currencyDrops)[number]>>();
    for (const drop of sharedState.currencyDrops) {
      const drops = currencyDropsByLocation.get(drop.locationId) ?? [];
      drops.push(drop);
      currencyDropsByLocation.set(drop.locationId, drops);
    }
    const trackedItemIds = new Set(character.itemLocations.map((entry) => entry.item.id));
    const claimedContainerItemIds = new Set(character.claimedContainerItemIds);
    const characterItemsByLocation = new Map<string, Array<(typeof character.itemLocations)[number]>>();
    for (const entry of character.itemLocations) {
      if (!entry.locationId) continue;
      const items = characterItemsByLocation.get(entry.locationId) ?? [];
      items.push(entry);
      characterItemsByLocation.set(entry.locationId, items);
    }
    const roomDescriptionByItemId = new Map(
      context.world.locations.flatMap((worldLocation) =>
        (worldLocation.takeables ?? []).map(({ id, roomDescription }) => [id, roomDescription] as const),
      ),
    );
    const includeNpcDescriptions = query.payload.includeNpcDescriptions === true;
    const projectRoomContents = (
      room: WorldPackDraft['locations'][number],
      npcs: readonly NpcDefinition[],
      includeLongNpcDescriptions: boolean,
      includeObjects = true,
    ) => {
      const itemsInRoom = sharedItemsByLocation.get(room.id) ?? [];
      const campfiresInRoom = campfiresByLocation.get(room.id) ?? [];
      const now = context.now();
      const corpsesInRoom = (corpsesByLocation.get(room.id) ?? [])
        .filter((corpse) => !corpse.expiresAt || Date.parse(corpse.expiresAt) > now.getTime())
        .map((corpse) => {
          const contents = itemsInRoom
            .filter((item) => item.containerId === corpse.corpseId)
            .map(({ worldItemId, item }) => ({
              id: worldItemId,
              label: item.label,
              description: item.description,
            }));
          if (!corpse.goldClaimed && corpse.goldItemId && corpse.currencyAmount > 0) {
            const currencyName = context.world.currency?.name ?? 'coins';
            contents.push({
              id: corpse.goldItemId,
              label: `${corpse.currencyAmount} ${currencyName}`,
              description: `${corpse.currencyAmount} ${currencyName} left by ${corpse.opponentName}.`,
            });
          }
          contents.push(...(characterItemsByLocation.get(room.id) ?? [])
            .filter((entry) => entry.containerId === corpse.corpseId)
            .map(({ item }) => ({
              id: item.id,
              label: item.label,
              description: item.description,
            })));
          return {
            corpse: {
              ...corpse,
              description: corpseDecayDescription(
                corpse,
                now,
                context.world.corpseLifecycle.showDecayStages,
              ),
            },
            contents,
          };
        });
      const visibleContainers = (room.containers ?? []).map((container) => ({
        ...container,
        contents: [
          ...container.contents.filter((item) =>
            !claimedContainerItemIds.has(item.id) && !trackedItemIds.has(item.id),
          ),
          ...(characterItemsByLocation.get(room.id) ?? [])
            .filter((entry) => entry.containerId === container.id)
            .map(({ item }) => item),
        ],
      }));
      const roomTakeables = [
        ...(room.takeables ?? []).filter((item) => !trackedItemIds.has(item.id)),
        ...(characterItemsByLocation.get(room.id) ?? [])
          .filter((entry) => !entry.containerId)
          .map(({ item }) => item),
      ];
      const roomItemDescriptions = roomTakeables.flatMap((item) => {
        const roomDescription = roomDescriptionByItemId.get(item.id);
        return roomDescription ? [roomDescription] : [];
      });
      const sharedItemDescriptions = itemsInRoom
        .filter((item) => !item.containerId)
        .map(({ item }) => `${item.label} lies here.`);
      const currencyDropObjects = (currencyDropsByLocation.get(room.id) ?? []).map((drop) => {
        const currencyName = context.world.currency?.name ?? 'coins';
        return {
          id: drop.dropId,
          label: `${drop.amount} ${currencyName}`,
          description: `${drop.amount} ${currencyName} lies here.`,
          readable: false,
          takeable: true,
        };
      });
      const containerDescriptions = visibleContainers.map((container) => {
        const roomDescription = container.roomDescription ?? `${container.label} is here.`;
        const contents = container.contents.length
          ? ` It contains ${container.contents.map((item) => item.label).join(', ')}.`
          : ' It is empty.';
        return `${roomDescription}${contents}`;
      });
      const corpseDescriptions = corpsesInRoom.map(({ corpse, contents }) =>
        `${corpse.description}${contents.length
          ? ` It contains ${contents.map((item) => item.label).join(', ')}.`
          : ' It is empty.'}`,
      );
      const npcDescriptions = npcs.map(({ name, description, activityDescription }) =>
        includeLongNpcDescriptions
          ? `${name} is here. ${description}`
          : `${name} is here${activityDescription ? `, ${activityDescription}` : ''}.`,
      );
      const interactableRoomDescriptions = (room.interactables ?? []).flatMap(({ roomDescription }) =>
        roomDescription ? [roomDescription] : [],
      );
      const objects = includeObjects ? [
        ...(room.readables ?? []).map(({ id, label, description, readAction }) => ({
          id, label, description, readable: true, takeable: false,
          ...(readAction ? { readAction } : {}),
        })),
        ...roomTakeables.map(({ id, label, description }) => ({
          id, label, description, readable: false, takeable: true,
        })),
        ...campfiresInRoom,
        ...visibleContainers.flatMap((container) => [
          {
            id: container.id,
            label: container.label,
            description: container.description,
            readable: false,
            takeable: false,
            containerKind: container.kind,
            contents: container.contents.map(({ id, label, description }) => ({ id, label, description })),
          },
          ...container.contents.map(({ id, label, description }) => ({
            id,
            label,
            description,
            readable: false,
            takeable: true,
            containerId: container.id,
          })),
        ]),
        ...itemsInRoom.filter((item) => !item.containerId).map(({ worldItemId, item }) => ({
          id: worldItemId,
          label: item.label,
          description: item.description,
          readable: false,
          takeable: true,
        })),
        ...currencyDropObjects,
        ...corpsesInRoom.flatMap(({ corpse, contents }) => [
          {
            id: corpse.corpseId,
            label: corpse.label,
            description: corpse.description,
            readable: false,
            takeable: false,
            containerKind: 'corpse' as const,
            contents,
          },
          ...contents.map((content) => ({
            ...content,
            readable: false,
            takeable: true,
            containerId: corpse.corpseId,
          })),
        ]),
        ...(room.interactables ?? []).map(({ id, label, description }) => ({
          id, label, description, readable: false, takeable: false,
        })),
      ] : [];
      const npcProjections = npcs.map((npc) => ({
        id: npc.id,
        name: npc.name,
        ...(npc.activityDescription ? { activityDescription: npc.activityDescription } : {}),
        ...(includeLongNpcDescriptions ? { description: npc.description } : {}),
        canChallenge: Boolean(npc.combatProfile),
        combatDisposition: npc.combatDisposition ?? 'passive',
        canShop: Boolean(npc.shop),
      }));
      return {
        roomDetails: [
          ...roomItemDescriptions,
          ...sharedItemDescriptions,
          ...currencyDropObjects.map(({ description }) => description),
          ...containerDescriptions,
          ...corpseDescriptions,
          ...interactableRoomDescriptions,
          ...npcDescriptions,
          ...campfiresInRoom.map(({ description }) => description),
        ].join('\n\n'),
        objects,
        npcs: npcProjections,
      };
    };
    const roomContents = projectRoomContents(location, roomNpcs, includeNpcDescriptions);
    const innCurrency = location.inn ? context.world.currency : undefined;
    if (location.inn && !innCurrency) {
      throw new Error('An authored inn requires configured world currency.');
    }
    const shortName = locationState?.name ?? location.name;
    const locationGroups = locationGroupMembershipsForLocation(
      context.world.locationGroups,
      location.id,
    );
    const displayName = resolveLocationDisplayName(shortName, locationGroups);
    return measureQuery('assembleProjection', async () => LocationProjectionSchema.parse({
      worldInstanceId: context.worldInstanceId,
      locationId: location.id,
      ...(locationState ? { locationStateId: locationState.id } : {}),
      revision: character.revision,
      safeResting: location.safeResting ?? false,
      title: displayName.qualifiedName,
      shortName: displayName.shortName,
      qualifiedName: displayName.qualifiedName,
      locationGroups,
      description: [
        locationState?.description ?? location.description,
        roomContents.roomDetails,
      ].filter(Boolean).join('\n\n'),
      exits: availableExits.map((exit) => {
        const destination = context.world.locations.find((candidate) =>
          candidate.id === exit.toLocationId,
        );
        const interactionAvailable = !exit.requiredInteractionId ||
          character.itemUseObservations.some((observation) =>
            observation.interactionId === exit.requiredInteractionId &&
            observation.locationId === location.id,
          );
        const destinationAvailable = Boolean(destination) &&
          (!destination?.requiredVisitedLocationId ||
            character.visitedLocationIds.includes(destination.requiredVisitedLocationId));
        const isAvailable = interactionAvailable && destinationAvailable;
        const destinationState = destination
          ? resolveLocationState(destination, exit.toStateId)
          : undefined;
        const destinationShortName = destinationState?.name ?? destination?.name;
        const destinationGroups = destination
          ? locationGroupMembershipsForLocation(context.world.locationGroups, destination.id)
          : [];
        const destinationDisplayName = destinationShortName
          ? resolveLocationDisplayName(destinationShortName, destinationGroups)
          : undefined;
        const destinationNpcs = destination ? roomNpcsFor(destination) : [];
        const destinationContents = isAvailable && destination
          ? projectRoomContents(destination, destinationNpcs, false, false)
          : undefined;
        const previewRoomDetails = destinationContents?.roomDetails;
        const cappedPreviewRoomDetails = previewRoomDetails && previewRoomDetails.length > 20_000
          ? `${previewRoomDetails.slice(0, 19_999)}…`
          : previewRoomDetails;

        return {
          id: exit.id,
          label: exit.label,
          direction: exit.direction,
          available: isAvailable,
          roadId: exit.roadId,
          ...(isAvailable && destination && destinationDisplayName ? {
            destinationPreview: {
              locationId: destination.id,
              ...(destinationState ? { locationStateId: destinationState.id } : {}),
              title: destinationDisplayName.qualifiedName,
              shortName: destinationDisplayName.shortName,
              qualifiedName: destinationDisplayName.qualifiedName,
              description: destinationState?.description ?? destination.description,
              ...(cappedPreviewRoomDetails ? { roomDetails: cappedPreviewRoomDetails } : {}),
              npcs: destinationNpcs.slice(0, 200).map((npc) => ({
                id: npc.id,
                name: npc.name,
                mobile: Boolean(npc.movement),
              })),
            },
          } : {}),
        };
      }),
      objects: roomContents.objects,
      occupants: [],
      ...(location.inn && innCurrency ? {
        inn: {
          ...location.inn,
          currency: {
            id: innCurrency.id,
            name: innCurrency.name,
            symbol: innCurrency.symbol,
          },
        },
      } : {}),
      ...(roomContents.npcs.length ? { npcs: roomContents.npcs } : {}),
    }));
  });

  registerQuery('object.read', ObjectReadQuerySchema, async (query, context) => {
    const character = await state.load(context, query.characterId);
    if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
    const location = context.world.locations.find((item) => item.id === character.locationId);
    if (!location) throw new Error('The character location is not present in this world version.');
    const readable = (location.readables ?? []).find((item) => item.id === query.payload.objectId);
    if (!readable) throw new RuleViolationError('That object is not readable from here.');
    return ReadableObjectProjectionSchema.parse({
      id: readable.id,
      label: readable.label,
      text: readable.text,
    });
  });

  registerQuery('object.inspect', ObjectInspectQuerySchema, async (query, context) => {
    const character = await state.load(context, query.characterId);
    if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
    const location = context.world.locations.find((item) => item.id === character.locationId);
    if (!location) throw new Error('The character location is not present in this world version.');
    const trackedItemIds = new Set(character.itemLocations.map((entry) => entry.item.id));
    const characterItemsAtLocation = character.itemLocations.filter((entry) =>
      entry.locationId === location.id,
    );
    const visibleContainers = (location.containers ?? []).map((container) => ({
      ...container,
      contents: [
        ...container.contents.filter((item) =>
          !character.claimedContainerItemIds.includes(item.id) && !trackedItemIds.has(item.id),
        ),
        ...characterItemsAtLocation
          .filter((entry) => entry.containerId === container.id)
          .map(({ item }) => item),
      ],
    }));
    const roomContainers = visibleContainers.map((container) => ({
      id: container.id,
      label: container.label,
      description: [
        container.description,
        container.contents.length
          ? `It contains ${container.contents.map((item) => item.label).join(', ')}.`
          : 'It is empty.',
      ].join(' '),
    }));
    const sharedState = await worldItems.load(context);
    const sharedItems = sharedState.items
      .filter((item) => item.locationId === character.locationId);
    const roomCorpses = sharedState.corpses
      .filter((corpse) => corpse.locationId === character.locationId &&
        (!corpse.expiresAt || Date.parse(corpse.expiresAt) > context.now().getTime()))
      .map((corpse) => {
        const {
          corpseId,
          label,
          opponentName,
          currencyAmount,
          currencyId,
          goldItemId,
          goldClaimed,
        } = corpse;
        const description = corpseDecayDescription(
          corpse,
          context.now(),
          context.world.corpseLifecycle.showDecayStages,
        );
        const contents = sharedItems
          .filter((item) => item.containerId === corpseId)
          .map(({ worldItemId, item }) => ({
            id: worldItemId,
            label: item.label,
            description: item.description,
          }));
        if (!goldClaimed && goldItemId && currencyAmount > 0) {
          const currencyName = context.world.currency?.name ?? 'coins';
          contents.push({
            id: goldItemId,
            label: `${currencyAmount} ${currencyName}`,
            description: `${currencyAmount} ${currencyName} left by ${opponentName}.`,
          });
        }
        contents.push(...characterItemsAtLocation
          .filter((entry) => entry.containerId === corpseId)
          .map(({ item }) => ({
            id: item.id,
            label: item.label,
            description: item.description,
          })));
        return {
          id: corpseId,
          label,
          description: [
            description,
            contents.length
              ? `It contains ${contents.map((item) => item.label).join(', ')}.`
              : 'It is empty.',
          ].join(' '),
          contents,
          currencyId,
        };
      });
    const roomCurrencyDrops = sharedState.currencyDrops
      .filter((drop) => drop.locationId === character.locationId)
      .map((drop) => {
        const currencyName = context.world.currency?.name ?? 'coins';
        return {
          id: drop.dropId,
          label: `${drop.amount} ${currencyName}`,
          description: `${drop.amount} ${currencyName} lies here.`,
        };
      });
    const roomCorpseObjects = roomCorpses.map(({ id, label, description }) => ({ id, label, description }));
    const objectInRoom = [
      ...(location.readables ?? []),
      ...(location.takeables ?? []).filter((item) => !trackedItemIds.has(item.id)),
      ...(location.interactables ?? []),
      ...roomContainers,
      ...roomCorpseObjects,
      ...roomCurrencyDrops,
      ...visibleContainers.flatMap((container) => container.contents),
      ...roomCorpses.flatMap((corpse) => corpse.contents),
      ...characterItemsAtLocation
        .filter((entry) => !entry.containerId)
        .map(({ item }) => item),
      ...sharedItems.map(({ worldItemId, item }) => ({
        ...item,
        id: worldItemId,
      })),
    ].find((item) => item.id === query.payload.objectId);
    const objectInPack = character.inventory.find((item) => item.id === query.payload.objectId);
    const object = objectInRoom ?? objectInPack;
    if (!object) throw new RuleViolationError('That object is not here or in your pack.');
    return ObjectInspectionProjectionSchema.parse({
      id: object.id,
      label: object.label,
      description: object.description,
    });
  });
}
