# Tasks

## 1. Protect the stable character-plugin surface

- [x] 1.1 Add characterization coverage for the `characterPlugin` manifest, event schema versions, registered command/query/effect names, and public helper exports; verify the focused plugin test passes before extraction.
- [x] 1.2 Extract the character-state capability, guards, and shared recovery/combat helpers into internal modules while preserving the existing re-exports and object identity; verify plugin typecheck and dependent plugin tests pass.

## 2. Extract character write responsibilities

- [x] 2.1 Move vital recovery, rest/stand, and team-flee stamina registrations into a focused internal module; align recovery/combat tests with that boundary and verify focused tests pass.
- [x] 2.2 Move create, rename, archive, and restore registrations into a lifecycle module; group lifecycle tests with the module and verify creation, naming, and archive/restore behavior remains unchanged.
- [x] 2.3 Move take/drop/put, equipment, item use, and related shared-world item registrations into an inventory module; group inventory tests with it and verify item ownership, equipment, and effect behavior remains unchanged.

## 3. Extract room and object queries

- [x] 3.1 Move location description, object reading/inspection, and corpse presentation into a query-focused internal module; group query tests with it and verify location, readable-action, and inspection behavior remains unchanged.
- [x] 3.2 Reduce `character.ts` to the stable plugin facade and explicit dependency wiring; verify internal modules do not import through the facade and all existing package exports remain available.

## 4. Verify integration

- [x] 4.1 Run the complete core-plugin test suite and typecheck, plus downstream engine/server tests that assemble `characterPlugin`; verify the manifest, registration set, and public exports match the characterization baseline.
