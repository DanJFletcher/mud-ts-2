# Design

## Context

See [proposal.md](./proposal.md) for motivation. `characterPlugin` is currently the single public runtime boundary for character state, recovery, inventory, lifecycle, and room/object query behavior. Its `register` closure resolves shared and optional capabilities once, and other plugins import the character state capability and several helper functions.

The existing module has 13 player commands, 2 system commands, 3 queries, and 1 effect. Its tests already group recovery, inventory, lifecycle, and query behavior separately. Preserve the current plugin manifest and registration semantics while making those internal ownership boundaries explicit.

## Goals / Non-Goals

**Goals:**
- Make each registration module responsible for one cohesive character behavior area.
- Keep shared state and capability identity centralized and stable.
- Make dependencies explicit at module boundaries and keep tests aligned with them.

**Non-Goals:**
- Creating separately loadable plugins or changing plugin manifests and world registration.
- Changing commands, query results, event schemas, materialization, authorization, or gameplay behavior.
- Reworking unrelated plugin boundaries or the engine registration API.

## Decisions

### Keep one public plugin and compose internal registrations

Retain `characterPlugin` as the only runtime plugin for this domain. Its `register` method remains the composition root: it resolves capabilities, provides the existing character-state capability, and calls internal registration functions in a deliberate order.

This avoids changing world plugin lists and keeps the external plugin graph stable. Splitting into independently loadable plugins was considered, but it would change dependency declarations and registration/test assemblies without being necessary to improve source ownership.

### Split by behavior and keep shared dependencies narrow

Use internal modules for:

- **State and recovery:** character state loading and guards, vital recovery helpers and system commands, rest/stand, and shared combat-presence helpers.
- **Inventory interactions:** take/drop/put, equipment, item use, and the shared-world item effects those commands coordinate.
- **Character lifecycle:** create, rename, archive, and restore.
- **Room and object queries:** location description, reading, inspection, and corpse presentation.

The composition root constructs the shared state capability and resolves required or optional capabilities once. Each registration function receives only the registrars and capability services it needs. Avoid a generic plugin framework; the modules should remain ordinary functions with explicit, typed dependencies.

### Preserve the public import surface

Keep the existing `character.ts` module as the facade for `characterPlugin` and its currently exported helpers. Move implementation details into internal modules, then re-export public symbols from the facade and package entry point. The `characterStateCapability` object must retain a single stable identity.

Internal modules should import shared helpers directly from their internal source module, not back through the facade, to avoid circular imports. Other plugins and the server scheduler can keep their existing imports during this refactor.

### Align tests with the new responsibilities

Split the large character test suite into focused files corresponding to recovery/state, inventory, lifecycle, and room/object queries. Keep common command-context builders in test-only support. Preserve existing integration tests that assemble the public plugin with other plugins; add a registration-parity assertion so command, query, effect, and event behavior cannot silently disappear during extraction.

## Risks / Trade-offs

- [Moving a registration can alter initialization order or schema ownership] -> Preserve registration order in the facade and verify the registered command/query/effect set and plugin manifest.
- [Shared capabilities can create hidden coupling between internal modules] -> Pass a small explicit dependency object to each registration function and keep capability resolution in the composition root.
- [Compatibility re-exports can accidentally become a second implementation path] -> Re-export only stable public helpers; keep implementation modules internal and test the existing package entry point.
- [Test splitting can lose common setup or coverage] -> Share only test builders, keep assertions near the behavior under test, and run the full plugin suite after extraction.

## Migration Plan

1. Establish baseline coverage for the manifest and complete registration surface.
2. Extract shared state helpers and the least-coupled registration groups first, preserving exports and order.
3. Move inventory and room-query registrations with explicit dependencies; split the corresponding tests as each boundary settles.
4. Run plugin tests, typecheck, and downstream world/engine integration tests. Compare manifest, command/query/effect registrations, and event schema versions with the baseline.
5. Remove obsolete implementation from the facade only after all imports and tests use the extracted modules.

The refactor changes no persisted data and requires no database migration. Reverting consists of restoring the previous module organization; the public plugin manifest and runtime contracts remain unchanged.
