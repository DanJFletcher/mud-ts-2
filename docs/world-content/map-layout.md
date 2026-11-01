# World map layout authoring

Both world packs compose their layout data with TypeScript content, following
[ADR 0042](../adr/0042-world-map-layout-data-files.md).

Edit these files in the pack's `src/map/` directory:

| File | Authored fields |
| --- | --- |
| `locations.json` | `locations`: each room's `id`, `name`, `description`, optional `regionId`, `mapAreaId`, `mapPosition`, and `exits` |
| `location-groups.json` | `locationGroups`: group definitions, memberships and metadata |
| `roads.json` | `roads`: each road's `id`, `name`, and ordered `locationIds` |

Each file starts with `formatVersion: 1` and the same `packId` as the content.
All locations share one file, including overworld and dungeon rooms. A location's
optional `mapAreaId` selects its map; omission means the overworld. Exits remain
nested in their source room, including exits between map areas.

Preserve every array's order. New characters start at `locations[0]`, so never
sort or regroup rooms; append new ones. Road `locationIds` describe traversal
order. Write keys in schema field order with two-space indentation and a trailing
newline. Keep released IDs stable even when display names change.

In `src/index.ts`, add optional room content under `locationContent[locationId]`:
`states`, `defaultStateId`, `requiresWaterTravel`, `requiredVisitedLocationId`, `safeResting`, `readables`,
`takeables`, `containers`, `interactables`, `itemUses`, `npcs`, and `inn`. A room
without content needs no entry. Keep each road's `encounterChancePercent` and
`encounters` under `roadRules[roadId]`; every map road needs rules. Quests,
gathering, crafting, currency, classes and other pack content also stay in
TypeScript.

The pack parses all three files, composes them with the content, then runs
`WorldPackDraftSchema` and `validateDraftWorldGraph`. Descriptions must be
non-empty. Replace any builder placeholder starting with `TODO: describe` before
release; pack tests reject these placeholders.

Open water must explicitly set `requiresWaterTravel: true` in TypeScript
content. States can override the location value: a dry stage uses `false` and
the water beside it uses `true`. Movement rejects water access until swimming
or boats are supported. Map terrain alone never changes movement rules; see
[ADR 0043](../adr/0043-water-travel-access-requirements.md).

Run `npm run build`, `npm run typecheck`, `npm run lint`, and `npm test` from the
repository root. Tests cover file schemas, descriptions, and exact equivalence
with temporary pre-migration fixtures. Remove those fixtures and equivalence
tests in a follow-up after the migration merges; they intentionally fail on
subsequent content changes until removed.

The one-time [extraction script](../../scripts/extract-world-map-data.ts) generated
the files from built, original packs and retained TypeScript helpers. It is
migration tooling, not an authoring command for already migrated packs.
