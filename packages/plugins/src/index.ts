export { dailyJobsPlugin } from './daily-jobs.js';
export { fishingPlugin } from './fishing.js';
export {
  woodcuttingPlugin,
  WOODCUTTING_TREES_STREAM_ID,
  validateWoodcuttingTrees,
  projectWoodcuttingTreePresence,
} from './woodcutting.js';
export type { WoodcuttingTreePresence } from './woodcutting.js';
export { craftingPlugin, validateCraftingWorld } from './crafting.js';
export { projectGroupActivity } from './groups.js';
export * from './classes.js';
export {
  activeSharedCombatCharacterIds,
  characterPlugin,
  isCharacterInActiveCombat,
  isInSharedCombat,
  staminaRecoveryEvent,
  staminaRecoveryEventForCommand,
  vitalRecoveryPausedEvent,
} from './character.js';
export { movementPlugin } from './movement.js';
export { autonomousNpcsPlugin, autonomousNpcStateCapability } from './autonomous-npcs.js';
export {
  effectiveAutonomousNpcMovementIntervalMs,
  autonomousNpcStreamId,
  mobileNpcDefinitions,
  MIN_AUTONOMOUS_NPC_MOVEMENT_INTERVAL_MS,
  projectAutonomousNpcPosition,
  projectAutonomousNpcPositionFromHead,
} from './autonomous-npcs.js';
export type { AutonomousNpcStateCapability, AutonomousNpcPosition } from './autonomous-npcs.js';
export { movementPolicyCapability } from './movement.js';
export type { MovementPolicyCapability } from './movement.js';
export { roadTravelPlugin } from './road-travel.js';
export { npcDialoguePlugin } from './npc-dialogue.js';
export {
  planQuestChoice,
  projectQuestWorldOutcomes,
  questBranchesPlugin,
  questWorldOutcomesCapability,
  QUEST_WORLD_OUTCOMES_STREAM_ID,
} from './quest-branches.js';
export type { QuestWorldOutcomesCapability, QuestWorldOutcomesState } from './quest-branches.js';
export { merchantPlugin } from './merchant.js';
export { combatPlugin } from './combat.js';
export { interactionPlugin, projectCharacterInteractions } from './interactions.js';
export { groupsPlugin, groupsStateCapability, projectGroups, GROUPS_STREAM_ID } from './groups.js';
export { partyPlugin, partyStateCapability } from './parties.js';
export { partyQuestPlugin, partyQuestStreamId } from './party-quests.js';
export { combatRoomPresenceCapability } from './combat-presence.js';
export type { ActiveRoomCharacter, CombatRoomPresenceCapability } from './combat-presence.js';
export { teamCombatRosterPolicyCapability } from './team-combat-policy.js';
export {
  teamRoadEncounterCapability,
} from './team-combat-policy.js';
export type {
  TeamCombatRoster,
  TeamCombatRosterPolicy,
  TeamRoadEncounterCapability,
} from './team-combat-policy.js';
export { partyCombatPolicyPlugin } from './party-combat-policy.js';
export { teamCombatPlugin } from './team-combat.js';
export {
  createLocationGroupsPlugin,
  locationGroupCatalogCapability,
  LocationGroupCatalogError,
  LocationGroupCatalogService,
} from './location-groups.js';
export {
  projectWorldItems,
  worldItemsPlugin,
  worldItemsStateCapability,
  worldItemsStreamId,
} from './world-items.js';
export {
  objectLifecyclePlugin,
  objectLifecycleStateCapability,
  objectLifecycleStreamId,
  objectLifecycleScheduledEvent,
  objectLifecycleRescheduledEvent,
  objectLifecycleCancelledEvent,
  objectLifecycleExpiredEvent,
  projectObjectLifecycle,
} from './object-lifecycle.js';
export type { ObjectLifecycleStateCapability } from './object-lifecycle.js';
export { corpseLifecyclePlugin } from './corpse-lifecycle.js';
export {
  CAMPFIRE_LIFETIME_MS,
  TEMPORARY_CAMPFIRES_STREAM_ID,
  projectTemporaryCampfires,
  temporaryCampfiresCapability,
  temporaryCampfiresPlugin,
} from './temporary-campfires.js';
export type { TemporaryCampfiresCapability } from './temporary-campfires.js';
export {
  ROOM_ANNOUNCEMENT_EFFECT,
  ROOM_ANNOUNCEMENT_SOURCE_PREFIX,
  RoomAnnouncementEffectSchema,
  roomAnnouncementEffect,
} from './room-announcements.js';
export {
  interactionStreamId,
  projectInteractionEvents,
  updateInteractionRequestStatus,
} from './interactions.js';
