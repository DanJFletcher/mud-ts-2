# World feature ownership

The world entry in `App.tsx` owns an immutable SDK client. A world or explicit
character prop change replaces that entry. The lobby supplies the active
character ID. If a loaded snapshot reveals a different character, the entry
replaces the feature composition as well. Each mounted entry owns its history;
feature state and subscriptions are disposed with the composition.

`useGameSession` remains the only shared snapshot owner. Its setters, loads,
command reconciliation, and refresh gate capture a lifecycle owner. Replacing
the client or character, or unmounting, invalidates that owner: saved callbacks
cannot write into the current session. Feature-specific location and request
ordering guards belong to their feature controllers.

## Foreground execution

`session/ForegroundExecution` acquires an execution token synchronously with
`begin`, before an SDK call. A competing acquisition returns undefined. Only
the current token can `finish` execution or `clearFeedback`. The App adapters
`beginForeground` and `finishForeground` separately update the pending label
and start paint timing. Timing and rendered pending state do not acquire or
release the refresh gate.

Travel is the deliberate exception to a single request/feedback lifetime.
`finish(token, true)` ends the request and releases the refresh gate, while
retaining the incompatible-action lock for optimistic confirmation.
A retry of that movement can acquire a replacement token; the SDK pending action
retains its command ID. Confirmation calls `clearFeedback(token)`. If that
happens before the request finishes, execution remains locked until `finish`.

## Travel

`travel/useTravelController` owns the optimistic preview, pending travel token,
request orchestration, rollback, and snapshot-driven confirmation. It checks
disposal after network awaits before invoking feature callbacks. It returns
only `move` and the rendered `optimisticTravel` view.

Its `TravelControllerOptions` are explicit ports to shared session
reconciliation, foreground execution, history mutations, NPC announcement
deduplication, and room-feature dismissal. It neither exposes its internal refs
nor accesses another controller's state. The history port adapts the session-owned ActivityHistory store. NPC
announcement bookkeeping remains composition-owned, behind the explicit
narration port.

App composes these controllers through explicit callbacks. Combat execution,
challenge/response handling, class adoption, and resting commands belong to
[useCombatController](./combat/use-combat-controller.ts). It uses the same
session reconciliation and foreground execution ports as the other controllers;
it does not own a second snapshot or social subscription.

## Gathering

Fishing and woodcutting have separate controllers and narration adapters. Each
uses `useGatheringRun` to own a single `GatheringRun` and `ActionScheduler` per
authoritative action ID, character, client, and location. Cancel/start invalidates
the previous run synchronously. Cleanup disposes it, including queued retries.
Continue only reschedules the current action; coincident triggers cannot overlap
an advance. Recovery uses authoritative action identity and due times. Conflicts
use command codes (or a legacy HTTP 409 for the one cancellation retry), never
message wording. A minimum 250ms delay avoids immediate loops with clock skew.

Each background advance captures the shared foreground refresh epoch. Reads,
command responses, recovery, and narration are discarded if that epoch changed,
or the action was disposed. `useGameSession.reconcileCommand` accepts an optional
acceptance predicate and checks it after any fallback read, before applying the
snapshot. This keeps the shared snapshot boundary authoritative. If recovery
fails, or a foreground action makes a response obsolete, no automatic retry is
armed: a later valid snapshot must schedule the current action again. Local
cancellation cannot undo a command already accepted by the server.

## Feature reads and room controllers

Social state belongs to `social/useSocialController`. Party, team-combat, and
interaction subscriptions call the same refresh methods as direct command
follow-ups. Each channel has its own `RequestScope`: only its most recently
started request may apply, and its foreground epoch and session must still
match. Foreground reads may finish during their own execution's busy epoch;
background reads wait for the gate. Obsolete failures return null rather than
producing current-session narration.

Dialogue owns conversation state and close/reply/restart requests. Commerce owns
merchant catalogs, purchase follow-ups, crafting catalogs and quantity prompts.
Their request scopes include client, world, character, and room. Closing or
dismissing invalidates unresolved reads. They check acceptance after each network
await, including command projection fallback reads, before writing state or
narration. The composition calls public dismissal methods on travel and never
accesses their internal state setters.

Daily activities own bulletin requests, context checks, reset scheduling,
mutations, pending posting feedback, and board presentation. Board reads and
mutations use separate scopes so a mutation's follow-up board refresh does not
invalidate its own action. Existing board-ID/context checks remain in addition
to lifecycle and foreground-epoch checks. Closing or changing room invalidates
the bulletin. Inventory owns inspection and item actions, with the same room
scope and centralized snapshot reconciliation. Its inspection view is displayed
only while the exact inspected item remains carried.

NPC room-event refreshes remain in the composition alongside announcement
deduplication. Their tracked timer is cleared on cleanup; reads capture the
shared epoch, refuse to start during foreground execution, and check that epoch
and the originating character/room before applying a location update.

Controllers consume explicit shared ports; common command ports are described
by `ControllerOptions`. No controller
reads another controller's internal state. The SDK's canonical character,
class-catalog, and daily-job types also drive presentation directly, without
transport-widening class or daily-job assertions.

## Commands and shortcuts

`commands/metadata.ts` colocates canonical command names, accepted aliases, usage,
topic help, and general-help summaries. `parseCommandHeader` normalizes the verb
and target without executing work; the entered text is retained for narration.
Command-specific grammar lives in useWorldCommands, and selected controls
use ID-bearing ActionIntents. The pure resolution helpers in commands/targets.ts
are shared by text parsing, catalog resolution, and inventory inspection.

`keyboard/useMovementShortcuts` owns document movement keys. Its explicit modal
flag, open-dialog DOM check, and target/focus checks suppress movement inside
dialogs and editable controls, including Shift-arrow vertical movement.
The composition supplies combat, posture, pending-action, route, and modal
eligibility. Closing a modal restores ordinary eligibility; no shortcut bypasses
a gameplay restriction. Automated focus/keyboard regressions exist; native
browser and assistive-technology verification remain separate tracked tasks.

## Entity intents

`commands/intents.ts` defines discriminated ID-bearing actions and their
world/character/room context. `parseWorldCommand` is pure: it resolves entity
grammar against the supplied projection and keeps feature-specific query or
validation work as a typed text intent. `useWorldCommands` owns that text adapter,
including party syntax, topics, and validation feedback; none of it lives in
the screen composition. Catalog-backed resolution happens after its owning
feature reads the catalog. Shared target helpers prefer exact IDs, then all
exact labels, then all partial labels. Duplicate exact names are ambiguous.

`useActionDispatch` validates an intent's context and exact entity IDs against
the current projection before calling the same public feature actions used by
text commands. Unequip also verifies the slot still contains the selected item.
Selected controls never turn labels into command strings for resolution.
Labels in an intent's optional `display` field are narration only.

Terminal dialog selections retain their opening context, entity kind, and ID.
Inventory, NPC, object, tree/tool, listing, exit, and equipment controls dispatch
IDs directly. A missing selection reports that it is stale; it cannot fall back
to a same-named replacement. Selected inspection rechecks the exact ID after
the authoritative room description query. Room and non-entity quick actions
(such as help, rest, and take all) retain their normal text-command entry points.

## Bounded activity ownership

history/ActivityHistory owns append, replacement, removal, optimistic pin groups,
settlement, rollback, and retention. useActivityHistory creates one store per
mounted world/character feature composition and subscribes to its stable
snapshot. The default settled budget is 1,000. Travel opens a pin group before
appending its preview, ends collection synchronously, and settles or removes
those same IDs during confirmation or rejection. A stale command cannot settle
another command's group.

The shared UI ActivityHistoryWindow mounts at most 200 rows, preserves retained
entry anchors, and provides Older/Newer/Latest navigation. Terminal scrolling
also records the actual visible row and offset. Field notes reverses a window of
the same entries; its document-scroll anchor prevents incoming activity from
moving older notes. History rows are non-live. The stable session announcement
region changes only for actual appended activity, not for window navigation or
historical replacement. Retention and accessibility details are documented in
packages/ui/docs/design-system/activity-history.md; manual screen-reader and
native-browser checks remain tracked separately.

## Screen composition and navigation

[WorldClient](../../App.tsx) creates the session boundary. Its feature composition
connects feature APIs, execution feedback, history, and UI selection state. It
contains no text-command grammar, gathering scheduler, or feature polling loop.
Pending-action confirmation and quest/NPC announcement coordination remain
explicit composition concerns.

The app-specific views live in [screens](../../screens):

- [PlayScreen](../../screens/PlayScreen.tsx) composes the existing terminal, room
  presence, projected vitals, gathering feedback, daily bulletin, chat, map, and
  command entry. Merchant, combat, quick-command, and modal views enter through
  slots rather than requiring the layout to execute feature logic.
- [CombatPanel](../../screens/CombatPanel.tsx),
  [MerchantPanel](../../screens/MerchantPanel.tsx), and
  [QuickCommands](../../screens/QuickCommands.tsx) render typed data and call
  action callbacks. They neither fetch data nor own gameplay authority.
- [WorldDialogs](../../screens/WorldDialogs.tsx) adapts feature dialog state to
  the existing UI-library dialogs, preserving selected IDs and context.
- [VitalsScreen](../../screens/VitalsScreen.tsx),
  [InventoryScreen](../../screens/InventoryScreen.tsx), and
  [StatsScreen](../../screens/StatsScreen.tsx) render canonical projections.
  [FieldNotesScreen](../../screens/FieldNotesScreen.tsx) consumes the shared
  chronological history; [CodexPage](../../screens/CodexPage.tsx) retains the
  lazy-loaded Codex boundary.
- [WorldNavigation](../../screens/WorldNavigation.tsx) and
  [InfoTabs](../../screens/InfoTabs.tsx) render navigation.
  [useWorldNavigation](./navigation/world-navigation.ts) owns hash changes,
  content focus, menu dismissal/focus restoration, and persisted theme state.

These are application compositions, not new generic UI primitives. They reuse
the existing shared controls and their stories; new reusable controls must
still be developed in the UI library before screen integration.
