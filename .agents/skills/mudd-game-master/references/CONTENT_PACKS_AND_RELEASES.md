# Content packs, schemas, editing and release discipline

## Authoring outputs are assets, not database hacks

Recommend a human-reviewable versioned content-pack repository, *adapted to whichever format MUDD actually accepts*: YAML or JSON entries for worlds, regions, rooms, NPCs, objects, factions, dialogue, quest definitions, localized strings, encounters and optional scripts. Namespaces prevent collisions across mods (`author.pack-id.v1` etc.); local IDs remain stable across renames.

**Never impose this suggested schema over a canonical schema the repo already uses.** `assets/ORIGINAL_STARTER_WORLD.draft.yaml` is an example of editorial information architecture, not a valid or supported MUDD import format by default.

## Pack manifest (editorial checklist)

- Stable machine-readable `id`, human title, semantic `version`, engine contract/ruleset requirements.
- Authorship, license, attribution, source provenance and moderation/content rating; include any required SRD attribution where applicable.
- Supported locales and default locale; per-entry localization keys, no raw prose hidden in engine code.
- Entry world/region, dependencies, referenced asset IDs, namespace rules, optional extensions.
- Supported migration strategy for ongoing campaign state, a rollback/disable plan, changelog and content QA status.
- Security and privacy: spoiler/admin data separated from public projections, no embedded credentials or hidden private player info.

## Publish process

1. Audit actual authoring schema and importer; don't invent pack file names/commands.
2. Write original content to distinct data files and sourceable narrative strings.
3. Run schema/type validator; cross-reference all namespaced IDs; test every room exit, dialogue link, quest trigger and terminal state.
4. Verify required plugin versions are installed; absent capability blocks release.
5. Test in isolated development world. Seed deterministic character/world fixtures through test kit; use the same public command pipeline.
6. Conduct author/GM review for lore, prose, safety, license, localization, spoilers and economy/game-rule fit.
7. Publish through **authenticated public admin authoring interfaces**, record content version and test a client query.
8. Verify event replay and late join; document version upgrades for active worlds.

## Migration concerns

A published quest changes while players are mid-quest: define whether existing quest instances stay on v1 or safely migrate to v2; never silently invalidate state. A location ID should not be repurposed for a different location. Deleting an item that a player possesses requires an explicit migration or legacy compatibility. Rewards must be committed atomically/idempotently via the engine, not through an import script granting items to all players.

## Suggested repo structure, if no established content convention

```text
worlds/
  briarfen-demo/
    README.md                 # goals, tone, development status
    manifest.draft.yaml      # editorial metadata; not automatically importable
    bible.md                  # GM-only truth and style guide
    regions/                 # scene/room descriptions, edges and local interactions
    actors/                  # NPCs, factions and creature references
    conversations/            # dialogue nodes and reveal predicates
    quests/                  # quest definitions and author test cases
    locales/en/              # localizable player text
    tests/                   # graph / transition / spoiler tests
```

## Difference between draft, validated, playable

- `draft`: world and fiction can be reviewed without a content engine.
- `validated`: all required schema/cross-reference checks pass against an actual content importer.
- `playable`: public API import succeeds, at least one player executes major paths and observes persisted results.
- `release-ready`: includes compatibility, license/visibility checks, multiplayer/replay and upgrade strategy.

Report accurate stage; do not claim a pack is playable based on YAML alone.
