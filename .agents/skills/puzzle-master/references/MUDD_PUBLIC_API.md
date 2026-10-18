# Binding puzzle content to MUDD without pretending the API exists

**Current project context**: The prior `mudd-engine-contracts-bundle.zip` explicitly described itself as a **design proposal**, not a verified running API. Its proposed `authoring.ts`, `world.ts`, `protocol.ts` and `plugins.ts` illustrate names and boundaries; they are *not guaranteed exports* in a user repository.

## Discover before bind

Look for the actual exported `packages/contracts`, world/content authoring API, runtime interaction definitions, plugin registry, condition/effect capability, client-sdk, ruleset and time/RNG services. Identify actual input schemas, return receipts, auth scopes, content versions, lifecycle hooks and real tests. Record unavailable parts in `assets/API_INVENTORY_TEMPLATE.md`.

## Mapping responsibilities (use real exported names)

| Puzzle intention | Necessary capability | Fallback if missing |
| --- | --- | --- |
| Observe inscription | Authorized read-only location/object description or inspect query | Draft description only |
| Rotate apparatus | Authenticated object interaction command | Design spec and API gap |
| Record completion | Transactional authoritative event and projection | Completion remains design-only |
| Present hint | Authorized character/party knowledge query | Editorial hint table |
| Share collaborative state | Party/world instance scoped authoritative state | Single-player proof-of-concept draft |
| Reset apparatus | Authorized reset action or world-instance lifecycle | Document expected policy |
| Publish puzzle | Authenticated, versioned content importer/admin API | Content-only draft; no SQL workaround |
| Conditional timed lock | Authorized logical-time scheduler | Remove timer or keep as future gap |

## Example *proposed*, unapproved boundary

```
Player intent: "turn north vane to reservoir"
  -> client SDK uses a verified, typed command contract (if present)
  -> server authenticates player and validates reachable object + action
  -> puzzle/interaction rules validate current version, prerequisites, permissions
  -> event store appends committed facts with command id, actor and scope
  -> world projection updates exposed apparatus state
  -> only authorized audience receives the new state
```

**Do not create** ad hoc endpoints such as `/api/puzzle/solve`, modify Drizzle tables directly or publish a mutable object from client memory. Do not assume MUD-Lang already exists or execute arbitrary scripted expressions without a trusted sandbox and signed capabilities.

## Capability gap handoff

Write a narrowly scoped `mudd-architect` request with: player story, command/query inputs and output, auth principal, state scope, domain event fact, emitted projection, expected version/idempotency, replay behavior, privacy, version migration, and black-box tests. Puzzle Master may complete the design draft while integration is blocked. Existing repo implementations supersede any generic method or envelope suggested here.

## Cross-skill boundary

Puzzle Master designs challenges; `mudd-game-master` owns whether/how they connect to quests and narrative arcs, `mudd-lore-wiki` owns canon (but not spoiler solutions), `mudd-pwa-client` owns Storybook UI. The engine's generic object/interaction capability should not gain special-case logic for every new puzzle.
