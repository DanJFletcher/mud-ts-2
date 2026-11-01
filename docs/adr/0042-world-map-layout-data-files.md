# ADR 0042 — World map layout data files

- **Status:** Accepted
- **Date:** 2026-11-01
- **Owners:** MUDD contracts and world packs
- **Related:** [Map builder plan](../implementation-plans/map-builder.md), [location groups](../location-groups.md)

## Context

World packs are hand-written TypeScript. Orraveth's 98 rooms, 210 exits, location groups and roads sit in one 2,958-line file alongside NPCs, quests, objects and gathering definitions. The pack is parsed with `WorldPackDraftSchema` and checked with `validateDraftWorldGraph` when the module loads.

The planned map builder needs to read and write a world's layout. It cannot safely edit a large TypeScript file: the layout is mixed with game rules, helper functions and computed values, and a rewrite would lose formatting and comments. Distributable content packs (finding A6 of the 2026-10-31 architecture audit) also need world content that is data rather than code.

Event history refers to location IDs, so changing how packs are authored must not change any ID or any value the engine reads.

## Decision

### Split

Each pack's layout moves into JSON files under `src/map/`. Everything else stays in TypeScript.

| Data files (layout) | TypeScript (content and rules) |
| --- | --- |
| Location `id`, `name`, `description`, `regionId`, `mapAreaId`, `mapPosition` | Location `states`, `defaultStateId`, `requiredVisitedLocationId`, `safeResting`, `readables`, `takeables`, `containers`, `interactables`, `itemUses`, `npcs`, `inn` |
| Exits, using the existing `ExitDefinitionSchema` unchanged | Road `encounterChancePercent` and `encounters` |
| Location groups, using the existing `LocationGroupDefinitionSchema` unchanged | Everything outside locations, groups and roads: quests, daily boards, gathering, crafting, currency, classes, respawn and corpse rules |
| Road `id`, `name` and ordered `locationIds` | |

`name` and `description` are layout because room descriptions name their exits ("The tower road rises north"), so they change together, and because the builder must create rooms that pass the schema.

### Files

```text
packages/world-<pack>/src/map/
  overworld.json            locations with no mapAreaId
  <mapAreaId>.json          one file per map area
  location-groups.json
  roads.json
```

Every file starts with `formatVersion: 1` and `packId`. Exits are nested in their source location, as they are today, so a cross-area exit lives in the file of the room it leaves from.

Array order is meaningful and preserved: the composed pack lists locations, exits, groups and roads in file order. New entries are appended. Keys are written in schema order with two-space indentation and a trailing newline, so diffs stay readable.

### Contracts

`@mudd/contracts` gains a `world-map-data` module:

- `WorldMapAreaFileSchema`, `WorldLocationGroupsFileSchema` and `WorldRoadsFileSchema`, built from the existing location, exit, group and road schemas. Unknown `formatVersion` values fail parsing.
- `WorldPackContent`: the TypeScript side, with location content keyed by location ID and road rules keyed by road ID.
- `composeWorldPackDraft(map, content)`: a pure function, usable in Node and the browser, that merges the two and returns the input for `WorldPackDraftSchema`. It fails when content refers to a location or road the map does not define, or when a road has no rules.

Each pack's `index.ts` imports its JSON files, composes the pack, then parses and validates it as today. The exported `WorldPackDraft` and every consumer, including `world-registry.ts`, are unchanged.

### Placeholder descriptions

Rooms created in the builder get the description `TODO: describe <name>.` A pack test fails while any placeholder remains, so a placeholder cannot reach a release. The builder lists placeholders as warnings.

### Migration

1. A one-time script reads each current pack, writes its map files and the reduced TypeScript content, and checks that `composeWorldPackDraft` reproduces the parsed pack exactly.
2. The migration change includes a test that the composed Orraveth and demo packs deep-equal fixtures captured from the pre-migration parse. The fixtures are deleted in a follow-up once the change has merged.
3. `packVersion` does not change: no value the engine reads changes.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Builder edits the TypeScript with an AST tool | No format change | Fragile on helper functions and computed values; loses formatting; keeps world content as code |
| Builder writes a generated TypeScript module | No JSON imports | The builder must parse TypeScript to read it; not usable as data by future content packs |
| Store the map in the database | Live editing | Needs authentication, roles, audit and publishing first; out of scope for a local tool |
| Put all location content in JSON | One source per location | NPCs, quests and objects use helpers and shared values; moving them is a much larger change with no builder need yet |
| Keep descriptions in TypeScript | Prose stays beside NPC content | New rooms could not pass the schema without a TypeScript edit |

## Consequences and trade-offs

- **Positive:** the builder reads and writes plain data. Layout changes show as small JSON diffs. The format is the first piece of a distributable pack.
- **Negative:** a location's definition is split across two files. Full validation, including references from quests, NPCs and gathering to locations, needs both halves, so the builder's local server must load the pack's TypeScript content to validate.
- **Compatibility/migration:** the composed pack equals the current pack, so event history, saved character locations and replay are unaffected.
- **Security/abuse/trust:** JSON files are parsed with the same schemas as today. This ADR adds no network or runtime write path.
- **Build:** pack `tsconfig.json` files enable `resolveJsonModule`, and imports use `with { type: 'json' }`. `tsc` copies the JSON into `dist`.
- **Rollback/reversibility:** the composed output is a normal `WorldPackDraft`, so a pack can return to a TypeScript literal by printing it.

## Not included

- The map builder itself (plan phases 1–4).
- Protecting released IDs from deletion or renaming.
- The runtime location group catalog. It continues to be seeded from the pack's `locationGroups`.
- A content-pack manifest, namespaces or distribution.

## Verification

- Contract unit tests for each file schema, unknown `formatVersion`, and `composeWorldPackDraft` errors: content for an unknown location, a road without rules, duplicate IDs across area files.
- Deep-equality tests for the Orraveth and demo packs against pre-migration fixtures.
- A placeholder-description test in each pack.
- The existing pack, server integration and web test suites pass unchanged.

## Revisit trigger

Revisit when packs need to be installed from outside the repository, when a second tool writes the map files, or when the builder needs to edit content that this ADR leaves in TypeScript.
