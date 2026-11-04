# Tasks

## 1. Extract shared world schemas

- [ ] 1.1 Move schemas shared by authored and runtime contracts into `world-shared.ts`, preserve their constraints and exported types, and verify `npm run test --workspace @mudd/contracts` passes.

## 2. Separate authored world content

- [ ] 2.1 Move authored definitions, `WorldPackDraftSchema`, its input/output types, and `validateDraftWorldGraph` into `world-content.ts`; verify `npm run test --workspace @mudd/contracts` and `npm run typecheck --workspace @mudd/contracts` pass.
- [ ] 2.2 Update `world-map-data.ts` to import authoring schemas and types from `world-content.ts`; verify map-data tests pass with `npm run test --workspace @mudd/contracts`.

## 3. Separate runtime world contracts

- [ ] 3.1 Move world query/command schemas, NPC presence, and location/map/runtime projections with their types into `world-runtime.ts`; verify `npm run test --workspace @mudd/contracts` passes.
- [ ] 3.2 Update client, stream, movement-projection, and other internal consumers to import from their owning modules; verify `npm run typecheck` passes.

## 4. Preserve compatibility and verify integration

- [ ] 4.1 Make `world.ts` a re-export facade and retain the existing `engine-contracts/src/index.ts` export; verify `npm run test --workspace @mudd/contracts` passes with no renamed or missing package exports.
- [ ] 4.2 Run `npm test` and `npm run typecheck` to verify downstream packages and applications still build and pass tests.
