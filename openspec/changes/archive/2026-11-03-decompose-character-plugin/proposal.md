# Proposal

## Why

`packages/plugins/src/character.ts` combines character state and recovery, inventory interactions, character lifecycle commands, and room/object queries in one large plugin module. These responsibilities already have distinct test groupings and dependency needs; separating their registration code should make changes easier to review and test without changing the runtime plugin boundary.

## What Changes

- Extract cohesive internal modules for character recovery/state helpers, inventory interactions, character lifecycle commands, and room/object queries.
- Keep `characterPlugin` as the single public plugin with the same manifest, version, required plugins, provided capability, command/query/effect names, and event behavior.
- Pass each registration module only the shared capabilities and registration functions it needs.
- Preserve existing public helper exports through the current character module and plugin package entry point.
- Organize character plugin tests by the extracted responsibilities while retaining behavior and integration coverage.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is an internal code organization change; it does not change externally observable behavior or plugin contracts.

## Impact

- `packages/plugins/src/character.ts` and new internal modules under `packages/plugins/src/character/`.
- Existing public exports from the character plugin module and `packages/plugins/src/index.ts`.
- `packages/plugins/src/character-state.test.ts` and plugin composition tests.
- No changes to plugin manifests, world plugin lists, event schemas, persistence, client APIs, or database migrations.
