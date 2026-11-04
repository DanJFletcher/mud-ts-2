# Assertion mapping and verification

## Original assertions → named destinations

- Ashcombe and Thornmere settlement type, Codex ID, political status, five-member length and all-primary flags → settlement membership and political metadata / named settlement rows.
- Mosswake settlement type, Codex ID, independence, exact ordered five IDs and all-primary flags → Mosswake preserves its ordered primary locations and independence.
- All three route types, exact ordered equality with their road location IDs and all-non-primary flags → non-primary road routes / named route rows. Explicit road existence also prevents absent road/route values from comparing equal.
- Ashcombe's sole woodcutting tree ID and oak takeables/interactables/itemUses/NPC absence → authored restrictions / Ashcombe oak and harvesting case.
- Oren Kest, Cartwright, Nessa Valeen, Tavin Reed and Herbalist exact IDs/names → NPC identities / named individual cases; exact ordered five-name roster → ordered roster case.
- Thornmere bridge interactables/itemUses/NPC absence and healer NPC absence → authored restrictions / separate bridge and offstage healer cases; lake river terrain → Thornmere lake presentation case.
- Four Lower Rill reach x/y/river/visibility values and primary memberships → Lower Rill / named reach presentation rows; three reciprocal east/west pairs → named adjacency rows; road-ID absence at sedge reach, channel and open water only → named road-free reach rows; channel south exit → landing connection case.
- Territory edge exact single endpoint, south-platform south-exit absence, unfinished-road exact endpoint and forbidden later road IDs → authored restrictions / explicit endpoint and future-road cases.
- Landing marsh terrain and #74865a color → Mosswake landing presentation case.
- Landing fishing tickSeconds 5 → fishing timing case; both open-water notice substrings → readable restriction case; Tavin fish response substring → unresolved cause dialogue case.
- Pack version 1.21.1 → pack version case; first location bellwold-market-square → starting location case.

## Baseline

Before any test edits: dependency-free invocation failed because Vitest was missing. After npm ci it failed to resolve unbuilt @mudd/contracts. Building contracts resolved setup; all 7 original tests passed. These were environment failures, not behavioral red evidence. Only the owned test file and this change's artifacts are implementation scope.

## Verification and review

- Focused suite passed after settlement/route organization (12 cases), identity/restriction separation (27), river separation (37), and final lookup/formatting review (37).
- Full Orraveth suite: 7 files, 66 tests passed.
- Full `npm run build`: passed. Repository typecheck initially failed on unbuilt workspace exports; after building, `npm run typecheck` passed across all workspaces.
- `npm run lint`: failed with 170 errors, 405 warnings and unused suppressions in unchanged repository files. Rerunning after the full build produced the same totals. The owned test has no findings; direct ESLint invocation passed with `--pass-on-unpruned-suppressions` (needed because the global suppression ledger contains unrelated obsolete entries).
- `npm run quality:pr -- --base origin/main --head HEAD`: attempted, exit 2 because the documented clean, committed-head prerequisite is unmet. No gate pass is claimed. Full cross-workspace coverage and database migration were skipped: an isolated PostgreSQL test database was not configured (psql is unavailable), and this task leaves changes uncommitted for review. Coverage floors and the complete PR decision therefore remain unverified.
- Reviewed every original expectation against the mapping above and the diff: no assertion weakened or removed; named rows retain original repeated values, ordering and precise river road-absence scope. Added entity existence assertions improve undefined-content diagnostics without a helper API.
- Cleanup replaces the mixed river loop and its conditional/non-null assertion with explicit named reach and adjacency rows. No new classes, production functions, transport logic, fixtures, snapshots or runtime behavior; test callbacks are exempt from numeric limits. Naming and cohesion were reviewed separately from automated checks.
- Only the owned test and this change's artifacts changed. Content, manifests, configuration, baselines, other tests and other changes remain untouched. No ledger pruning is applicable to this owned test-only scope; unrelated obsolete ledger entries and repository lint debt remain.
- No behavioral red/green cycle was needed or claimed: this is a behavior-preserving refactor protected by an observed green baseline. Setup failures are documented above. Tracking was confirmed in batches for baseline/mapping and after each later implementation task; pack metadata separation occurred alongside identity separation and was verified again in its dedicated review step.

- `npm run quality:test`: all 63 tests passed. `git diff --check`: passed.
