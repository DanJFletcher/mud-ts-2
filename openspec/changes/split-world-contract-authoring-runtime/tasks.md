# Tasks

## 1. Extract shared world schemas

- [x] 1.1 Move schemas shared by authored and runtime contracts into `world-shared.ts`, preserve their constraints and exported types, and verify `npm run test --workspace @mudd/contracts` passes.

## 2. Separate runtime world contracts

- [x] 2.1 Move world query/command schemas, NPC presence, and location/map/runtime projections with their types into `world-runtime.ts`, and re-export them from `world.ts`; verify `npm run test --workspace @mudd/contracts` passes.
- [x] 2.2 Update client, stream, movement-projection, and other runtime consumers to import from `world-runtime.ts`; verify `npm run typecheck` passes.

## 3. Preserve compatibility and verify integration

- [x] 3.1 Verify existing imports through `world.ts` and `engine-contracts/src/index.ts` still expose all schemas and types; run `npm run test --workspace @mudd/contracts`.
- [x] 3.2 Run `npm test` and `npm run typecheck` to verify downstream packages and applications still build and pass tests.
