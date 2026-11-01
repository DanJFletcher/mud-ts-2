# MUDD feature implementation plan — Map builder

**Status:** Phase 0 is implemented following [ADR 0042](../adr/0042-world-map-layout-data-files.md) (accepted and amended). Both packs compose JSON layout with TypeScript content. Phases 1–4 have not started. This is the first part of a GUI for authoring worlds. It moves part of the engine roadmap's "CLI and eventually GUI world-editing tools" work earlier, and its data-format work is the first step toward distributable content packs (finding A6 of the 2026-10-31 architecture audit).

**Goal / user-observable behavior:** A world author opens a world pack in a local builder app, sees its map as a grid, and edits the layout: adds rooms next to existing ones with paired exits, sets terrain, and assigns rooms to settlements and roads. Saving writes data files in the pack that pass the existing schema and graph validation. Players see no change until the pack is released as usual.

**Existing repo findings:**

- **Rooms sit on an integer grid.** `mapPosition` holds integer `x`, `y`, optional `z`, a presentation-only `terrain` string, an optional `mapColor` and `visibleWhenUnvisited` ([world.ts:60](../../engine-contracts/src/world.ts#L60)). `mapAreaId` separates dungeon maps from the overworld ([world.ts:492](../../engine-contracts/src/world.ts#L492)).
- **Exits are almost all compass directions.** Orraveth has 210 exits: 202 go north, south, east or west, and 8 go up or down. There are no diagonals. Each exit is stored on its source location, so a two-way passage is two records. `label` is required; `direction`, `roadId`, state and interaction fields are optional.
- **Terrain is free text.** Orraveth uses `building`, `land`, `dirt`, `river`, `pasture`, `cobblestone` and `gravel`. River and building tiles cannot take a custom `mapColor`.
- **Settlements are location groups.** A settlement is a `locationGroup` with `type: 'settlement'`; a room can have at most one primary membership ([location-groups.md](../location-groups.md)). Groups also have a runtime catalog with revisions and create/update/delete operations, seeded from the pack ([location-groups.ts:99](../../engine-contracts/src/location-groups.ts#L99)).
- **Roads need encounters.** A road is an ordered list of at least 3 location IDs and needs at least one encounter ([world.ts:240](../../engine-contracts/src/world.ts#L240)). Every consecutive pair needs an exit carrying the road's `roadId`.
- **Descriptions are required.** `LocationDefinitionSchema` requires a non-empty `description`.
- **Layout is now JSON data (Phase 0).** Orraveth's 98 rooms and the demo's 42 rooms live in each pack's `src/map/locations.json`, in their original order, alongside `location-groups.json` and `roads.json`. [Composition](../../engine-contracts/src/world-map-data.ts) merges this with TypeScript content. Both packs retain `WorldPackDraftSchema` parsing and `validateDraftWorldGraph` checks at module load. See [authoring instructions](../world-content/map-layout.md).
- **A tile renderer already exists.** `WorldMapPanel` draws tiles, connections, terrain and vertical markers from a map projection ([WorldMapPanel.tsx](../../apps/web/src/WorldMapPanel.tsx)). It lives in `apps/web`, not in `@mudd/ui`.
- **Room IDs are kept stable on purpose.** The Lower Rill content change renamed rooms without changing their IDs, because event history refers to location IDs.

## Decisions

| # | Question | Recommendation |
|---|---|---|
| 1 | Where does map layout live? | Data files in each pack, combined with TypeScript content by location ID. A GUI cannot safely edit a 3,000-line TypeScript file. Record the format in an ADR. |
| 2 | Who runs the builder, and where? | Local-only for the MVP: bound to `127.0.0.1`, never deployed, writing only inside `packages/world-*/`. Changes reach the game through git and review. A hosted, multi-user builder needs authentication, roles, audit trails and publishing, and belongs with the content-pack work. |
| 3 | What protects existing players? | IDs are immutable once released; renaming changes only the display name. Deleting or moving a released room shows a warning. Saving prompts for a `packVersion` bump. |
| 4 | How are IDs made? | Generated from the name on creation (for example `rillford-ferry-stage`), then never changed. |
| 5 | How do new rooms satisfy the required description? | A marked placeholder that validation reports until it is replaced. |
| 6 | How are roads' required encounters handled? | Road editing waits until phase 3, where encounters are chosen from existing definitions. |
| 7 | Pack groups or runtime group catalog? | The pack only, at first. |
| 8 | Exit labels? | Generated from the direction ("North", "Up") with an optional override. Check Orraveth's existing labels first. |
| 9 | Grid or freeform canvas? | Grid. The engine's map is a grid, and a freeform canvas would allow layouts it cannot represent. |

## Cross-cutting requirements

- **Engine, not Orraveth.** The builder opens any pack, including the demo world. Terrain choices come from the pack, not a hardcoded list.
- **Accessibility.** The selection moves with arrow keys, and Shift+arrow creates a neighbouring room. A room and exit list beside the map gives screen readers the same information. Follow the existing Storybook accessibility checks.
- **Git-friendly output.** Stable key order keeps diffs readable. Array order is preserved, never sorted: location order decides where new characters start ([ADR 0042](../adr/0042-world-map-layout-data-files.md)), so the builder appends new rooms and never reorders existing ones.
- **File access.** The local file API rejects paths outside the approved pack directories and validates every write against the schema before writing.

## Phases

### Phase 0 — Separate the map data

**Implemented.** The extraction script generated all six layout files from the
built original packs. Strict equality tests preserve array order against fixtures
captured before migration in commit `3ced52f`. Remove those fixtures and their
equivalence tests in a follow-up after merge, before changing authored content.

1. Follow [ADR 0042](../adr/0042-world-map-layout-data-files.md) (accepted), which specifies the map data format and how it combines with TypeScript content.
2. Move layout out of the TypeScript: locations' ID, name, description, region, map area and position; exits; location groups; and each road's room list. NPCs, quests, objects and road encounters stay in TypeScript.
3. Build the packs from both sources through `WorldPackDraftSchema` and `validateDraftWorldGraph`.
4. Add a test that the rebuilt Orraveth and demo packs deep-equal the current packs.

**Exit:** both packs build from the data files, all tests pass and nothing changes for players.

### Phase 1 — Read-only viewer (`apps/builder`)

1. A Vite + React app on the web client's stack.
2. Move the tile drawing code from `WorldMapPanel` into `@mudd/ui` and use it in both apps.
3. A local file server limited to localhost and approved paths.
4. Switch between map areas and floors.
5. An inspector showing a room's exits, groups and road.
6. A validation panel that lists schema and graph errors, each linked to its room.

**Exit:** the builder opens Orraveth, every room appears at its position, and validation results match the tests.

### Phase 2 — Layout editing (MVP)

1. Select a room. Add a neighbouring room with paired exits by clicking or with Shift+arrow; up and down create rooms on other floors.
2. Edit name, terrain, colour and `visibleWhenUnvisited`. Set the primary settlement.
3. Connect or disconnect existing neighbours, including one-way exits.
4. Delete rooms, with protection for released IDs.
5. Undo and redo.
6. Save with a summary of rooms added, renamed and removed. Schema errors block saving; warnings do not.

**Exit:** an author can rebuild Rillford's layout from scratch in the builder, and the result passes `npm test`.

### Phase 3 — Settlements and roads

1. Create and edit location groups, and assign several rooms at once.
2. A road tool: click rooms in order, and the builder tags their exits with `roadId`.
3. Choose road encounters from existing definitions.

### Phase 4 — Workflow

1. Open the selected room in a locally running game.
2. Detect released IDs from the last tagged pack version.
3. Prompt for a `packVersion` bump on save.

### Later

- Editors for descriptions, NPCs and quests.
- A hosted, multi-user builder, together with the content-pack manifest, publishing, permissions and rollback work.

## Testing

- Phase 0: deep-equality tests for both packs, plus the existing pack and server integration tests.
- Builder: unit tests for the edit operations (add neighbour, connect, delete, undo), the ID generator and save formatting.
- Component tests and Storybook stories for the grid, inspector and validation panel, including keyboard navigation.
- File server tests that paths outside the approved directories are rejected.
