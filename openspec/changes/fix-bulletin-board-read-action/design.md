# Design

## Context

See [proposal.md](./proposal.md) for motivation and [readable-actions requirements](./specs/readable-actions/spec.md) for the behavior contract. The user confirmed the failing sequence is room-description object link, object action chooser, then Read.

The investigation reproduced the current exact-ID dispatcher calling the generic reader for `bellwold-daily-notice`. Its authored text matches the screenshot. Typing `read Bulletin board` instead reaches a daily alias handler that opens `bellwold-notice-board`; the echoed transcript conceals this routing difference. The readable and board IDs are intentionally different and currently have no association.

Relevant implementation boundaries:

- [Readable definitions and room projections](../../../engine-contracts/src/world.ts) are strict schemas. Readables currently contain identity, description and text; projected objects expose capabilities but no semantic read action.
- [Orraveth content](../../../packages/world-orraveth/src/index.ts) authors the readable and daily board separately.
- [Location description](../../../packages/plugins/src/character.ts) explicitly selects readable fields when projecting room objects, so new metadata must be deliberately copied.
- The [intent parser](../../../apps/web/src/commands/intents.ts) and [text command handler](../../../apps/web/src/commands/use-world-commands.ts) recognize different bulletin aliases. The [action dispatcher](../../../apps/web/src/commands/use-action-dispatch.ts) sends exact-ID reads to inventory regardless of feature semantics.
- [Daily-board state](../../../apps/web/src/features/daily/use-daily-controller.ts) already provides guarded querying and dialog state; [quick-action selection](../../../apps/web/src/features/inventory/action-selectors.ts) currently identifies bulletin objects heuristically from labels.

The unarchived client refactor's identity and lifecycle guarantees remain constraints; this change does not redefine or edit its capabilities. Existing room objects are strict at SDK ingress, so adding a response field without negotiation would break older cached clients.

## Goals / Non-Goals

**Goals:** Correct the confirmed click flow, retain selected identity, make readable behavior extensible through bounded typed actions, preserve static reading, and support mixed old/new clients during rollout.

**Non-Goals:** A generic action registry, executable/query descriptors in content, additional action variants, new UI primitives, new persisted effects, new daily-job mechanics, changes to ordinary read command/result/event contracts, or new quest-progress semantics for browsing boards.

## Decisions

### 1. Add optional semantic read actions at the content/projection boundary

Introduce a shared exported action schema/type in the world contracts, initially containing only the strict variant below:

```ts
readAction?: {
  type: 'daily-board';
  boardId: string;
}
```

Use the existing ID validation for the target. Add the optional field to readable definitions and projected room objects. Keep current text required; omission means the existing static read behavior. An explicit text variant is unnecessary until there is a real authoring need. Do not put a standalone daily-board property on every readable or author browser-specific modal instructions.

The existing optional dialogue `questAction` union is a precedent for bounded typed authoring. Existing item-use interactions require a carried item and target, and are not reused for reading. Returning an action from the ordinary read result or persisting a modal-opening effect would expand command/result/event behavior unnecessarily; use the room affordance to choose the existing resource query instead.

### 2. Validate exact associations through the actual world authoring path

Extend `validateDraftWorldGraph` in the world contracts to index daily boards by ID and validate every location's action-bearing readables. Reject missing references, duplicate referenced board identities, and references to a board in another location. Diagnostics identify the readable and board. Exercise the same compose/parse/validate entry points used by real world packs so a check cannot exist only in an unused helper.

Readables belong to `location.readables`; the current model has no nested state-specific readable collections. Validate each location once, preserve metadata through map/content composition, and test that nondefault location-state projections retain the inherited action. Do not add a state-readable authoring feature.

Add the action to Orraveth's existing `bellwold-daily-notice`, referencing `bellwold-notice-board`. Preserve both IDs, labels, descriptions, and static text. The character plugin's readable projection copies the optional action; plain objects omit it. SDK location types continue to derive from the canonical location schema rather than duplicating it.

### 3. Negotiate the additive projection field for strict cached clients

Define a narrow shared protocol header and supported version in contracts: `x-mudd-readable-actions: 1`. This is a new opt-in capability, independent of the existing `x-mudd-command-projection: game` opt-in. Older clients already use command projections but cannot parse the new object field.

Add an optional SDK client setting `readableActions`, defaulting to disabled, and enable it in the owned PWA gameplay-client construction. The SDK common request method adds the header when enabled, preserving it when command-specific headers are merged. Cover game loads, Look queries, commands and fallback snapshot requests. Old servers can ignore the header; new clients still accept projections without action metadata.

Keep engine projections complete. At the HTTP boundary, use one pure, immutable location compatibility helper to physically omit `readAction` unless the request advertises the exact supported version. Omission must preserve the prior strict object shape rather than replacing the field with null. Apply the helper to all four existing response shapes:

1. `/api/game`: `location`.
2. `/api/commands`: `gameProjection.location`.
3. `/api/commands`: legacy `movementProjection.location`, including move/road-step paths that can emit projections without the older command opt-in.
4. `/api/queries`: successful `location.describe` under `value`, including any success fallback path.

The [game route](../../../apps/server/src/worlds/routes/game.ts), [command route](../../../apps/server/src/worlds/routes/commands.ts), and [query route](../../../apps/server/src/worlds/routes/queries.ts) are the emission boundaries. Gate a finalized command projection once before choosing its response field, after ordinary enrichment/woodcutting projection. Do not mutate cached/shared projections or strip data within engine query handlers. Realtime remains an invalidation/refetch path and needs no new payload.

### 4. Resolve object identity first and share Read dispatch

Use one Read resolution policy across text commands and typed object actions. Existing exact-ID/world/character/location guards run before dispatch. Exact readable IDs take precedence, then unique exact readable labels; duplicate exact labels require disambiguation. Recognized generic bulletin aliases are resolved explicitly against available board identities rather than through array position. Other object text uses the existing unique partial-name resolution, retaining its ambiguity checks.

Consolidate the parser/handler alias definitions, including the currently inconsistent `read board` case. An exact ordinary object match must not be hijacked merely because its label resembles a bulletin alias. Legacy generic aliases can use the advertised local board list when exactly one target is available; multiple targets require a more specific selection. Do not serialize a selected ID into a display-name command string.

In shared object Read dispatch, resolve the current object by its exact selected ID. If its current action is `daily-board`, verify that target ID is still advertised locally and call the existing daily controller with that exact ID. Otherwise call the current ordinary reader. Missing objects, unavailable linked targets, or captured associations that have changed must fail as obsolete/unavailable without substituting a same-named object or opening another board.

Route explicit board-reading intents/aliases and selected-object resource reads to the same guarded board-opening operation. Keep the daily controller's world/character/room/request sequencing checks, loading/error presentation, and board state lifecycle. Look remains inspection. Resource reads use the existing board query only; they do not also send `character.read`, accept/complete jobs, or append read-progress events. Ordinary Read events and their quest consumers remain unchanged.

### 5. Make quick controls explicit and reuse the existing dialog

Replace bulletin-label inference in quick-action selection with the declared action. Keep one dedicated quick board control per advertised local board, bound to its exact board ID and current context. Suppress a redundant ordinary-object Read quick control only when the object's explicit action points to that same advertised board; unrelated same-named readables keep their normal controls. Room-description object menus continue to offer Read and Look.

The dedicated quick control dispatches a typed board action, not synthetic `read bulletin` text. Bind the clicked board identity even when multiple boards share a display name. Preserve the existing single-board quick control's label where practical, and use the existing button/dialog components. No new reusable UI component or styling system is needed; add application integration coverage for the routing defect rather than creating a cosmetic Storybook variant.

## Verification Strategy

- Contract tests cover legacy omission, the supported discriminant, invalid actions, valid/different IDs, missing/duplicate/wrong-room references, and composition round trips.
- Character/location tests verify the action survives ordinary and nondefault-state room projection, while generic reading retains identical text/events. Orraveth tests assert the stable authored association.
- Server compatibility tests cover absent, supported and unsupported headers for all four response shapes and parse legacy responses with the prior strict object shape. Assert shared objects are not mutated between requests with different capabilities.
- SDK tests cover optional header behavior and preservation through common/command headers, Look/game parsing, fallback refresh, and old responses without metadata.
- Parser/dispatch tests cover exact IDs, names, aliases, multiple boards, duplicate labels and ordinary same-named readables. Application tests reproduce room text -> chooser -> Read -> daily dialog and assert the exact board query with no ordinary read command. Retain dedicated quick-button and typed-command tests.
- Deferred-response and stale-selection tests cover object removal/replacement, association changes, world/character/location changes, failures and loading. Extend the stale-selection assertion to reject the real `character.read` command as well as the legacy `object.read` assertion.
- Run affected package tests after rebuilding their dependencies, then relevant typechecks, lint, full build and strict OpenSpec validation. Manually exercise the original click sequence and Look/ordinary-read controls in a production build; record browser checks separately from automated results.

## Risks / Trade-offs

- [A new optional field breaks old strict clients] -> Explicit independent capability header and consistent omission across every location-bearing HTTP response.
- [Alias handling still selects the first board or hides ordinary readables] -> Shared identity-first resolution, metadata-based quick selectors and multi-board/same-name regressions.
- [A stale association redirects a previous selection] -> Resolve current object/action and compare any captured association before dispatch; preserve existing context guards.
- [World validation is bypassed by one authoring path] -> Extend the established full-world validator and test real composition/pack-loading paths.
- [Browsing inadvertently changes quest history] -> Preserve resource-query-only board behavior and existing ordinary read contracts/events; assert no generic read is sent for an action-bearing board.
- [Generic architecture grows beyond the bug] -> One optional schema, one initial variant, one compatibility helper, existing controller/dialog, and no action-execution registry.

## Migration Plan

1. Add contracts, validation, contract/compatibility ADR, and schema tests. Document the proposed header and why it is independent of command projections.
2. Project the action and author the Orraveth association, then implement HTTP negotiation/omission and SDK opt-in with compatibility tests before exposing metadata to clients.
3. Update shared Read dispatch/parser and quick controls, enable the PWA capability and land the exact click-flow regression with existing modal/controller protections.
4. Run integrated checks and the production browser exercise. Ship the server and client changes through the normal build; cached clients remain on the old payload shape until refreshed. World-loading code must understand the optional authoring field before loading updated content.

No database/event migration is required. Roll back the content association with any rollback to older strict world-definition code. Client/server rollout can overlap because capability gating preserves legacy HTTP payloads. Do not archive or rewrite the unrelated client/server refactor changes as part of this fix.
