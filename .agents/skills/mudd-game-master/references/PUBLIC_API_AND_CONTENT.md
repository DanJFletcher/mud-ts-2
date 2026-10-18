# Public API and engine integration: author, do not bypass

**Most important technical boundary:** This skill knows the *principles* of MUDD's architecture, not the concrete exports in a user's repo. The repository is the source of truth for exact API names, schemas, endpoints, versions, authentication and content authoring support.

## Required preflight: build an API/capability inventory

Inspect these paths if present (never assume each exists):

- `packages/contracts` and protocol schemas: queries, commands, events, errors, versioning and Zod validation.
- `packages/client-sdk` and any server/admin authoring SDK.
- `packages/engine-core` public plugin registry/capability discovery, not private imports.
- `plugins/first-party` and `plugins/rulesets` for quest, conversation, inventory, reputation, encounters, RNG, time, movement, world content.
- `worlds/` or `content/` schema, seed/pack/validation/import scripts, existing content and docs.
- `/docs/ard`, `/docs/adr`, migrations and tests for permission and persistence guarantees.

Write a table with capability, actual exported path/identifier, inputs/outputs, version, authority, principal/permission, scope, known tests and `available | absent | unclear`. A missing API is **not** permission to create an invisible database migration or private method invocation.

## Safe operational categories

| Intent | Author may do | Must not do |
|---|---|---|
| Inspect world | Public authorized query of scene/objects/NPC projection | Read DB tables directly or receive GM-only secrets as a player |
| Describe/author content | Canonical authoring package / server validated import | Change global client CSS/React to embed narrative state |
| Player chooses action | Provide a choice with a typed SDK command | Pretend local UI choice proves server acceptance |
| Complete a quest | Declare triggers/approved effects via quest capability | Set `completed=true` in a local store or SQL row |
| Change an NPC's relationship | Use published reputation/relationship command | Mutate arbitrary NPC fields through a UI hook |
| Move/claim/gather/trade | Invoke matching capability with checked authority | Directly rewrite inventories, land ownership, or economy state |
| Schedule a faction move | Use documented logical time/scheduler API | `setTimeout` or browser wall clock as authoritative timer |
| Generate dice/encounters | Ask installed ruleset/RNG capability | Pick unvalidated outcomes in story prose |
| Publish a pack | Authenticated admin content import/version activation | Bypass validation with developer-side insert |

## Public content adapter and declared dependencies

A content pack declares `requiresCapabilities` with minimum supported versions **only if its accepted format allows it**. The pack importer should reject incompatible capabilities before activation; otherwise perform explicit preflight and fail safe. Refer to `assets/CONTENT_PORT.example.ts` as **architectural illustration**, not a buildable engine import.

If a content idea needs a feature that doesn't exist:

1. Finish a fiction/design spec and mark the feature `blocked_by`.
2. Write an engineer-friendly contract request: game scenario, users/actors, read/query, command, event fact, projection, permissions/scopes, concurrency, and tests.
3. Hand the request to `mudd-architect`; do not invent an endpoint or SQL workaround.
4. Implement a temporary **content-only stub** solely for documentation/testing, clearly separate from the running world.
5. Publish only features supported by real contracts; revise specs after API is accepted.

## Boundaries around state

Content definition is versioned and can be public in an editor; game state is authoritative and sourced from events. A quest transition is a validated server command which produces events, not a script blindly editing a state object.

World/campaign/party/character scope must be explicit. Example: one global portcullis can be opened once in a shared instance; each player may independently discover the clue behind it. A private character objective cannot silently close all other players' instances. Make outbox subscriptions/late-join queries consistent with visibility rules.

All nondeterminism affecting game state—RNG, NPC scheduling decisions, external AI outcomes—must be resolved and recorded authoritatively. Replay is not permission to re-run side effects.

## Quest command flow example (illustrative, **not** real MUDD method names)

```text
Player sends supported intent through client-sdk
  -> transport authenticates / validates and authorizes actor+scope
  -> registered quest/interaction capability checks current authoritative state
  -> atomically commits approved events/rewards with command ID + expected version
  -> projection updates and publishes only allowed views to affected clients
  -> player receives observed outcome and narration
```

No client or content plugin may invent successful state change before an acknowledgement. For failure, give understandable diegetic feedback while preserving precise technical errors in logs, not player narration.

## Script and AI boundary

MUD-Lang is a **planned** DSL, not automatically present. If a runtime exists, inspect grammar, author permissions, effect whitelist, CPU/time/memory budgets, determinism and sandbox. Never evaluate arbitrary JavaScript from player or author text. A model producing text cannot directly grant currency or NPC reputation. AI output must be constrained to authorized facts and resolved actions.

## Minimal contract request template

```markdown
Capability gap: quest.relationship.adjust.v1 (proposed, NOT an existing MUDD API)
Story use case: Helping a river guild changes how its warden treats a player.
Authorized actor: authenticated character in world instance
Command input: subject NPC/faction ID, supported relation cause, command ID
Preconditions: validated quest resolution, proper scope, unique award key
Event: RelationshipChanged (proposed event fact)
Projection: current authorized relationship + visible reaction cue
Idempotency / concurrency: applied at most once for the resolution ID
Migration / compatibility: namespaced plugin schema, version negotiation
Tests: duplicate submission, reconnect, cross-world rejection, hidden info
```
