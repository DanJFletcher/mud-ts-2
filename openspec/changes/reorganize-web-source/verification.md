# Verification

## Baseline

- Branch: `refactor/reorganize-web-source`, created after fetching origin and confirming main/origin/main at `85058f89e85031a7b7f4ceca59ed4bbef693aac0` (0 ahead/0 behind).
- Fresh worktree dependency setup: `npm ci --ignore-scripts` completed. Initial web tests/typecheck could not resolve unbuilt workspace exports; this was an environment/setup failure, not a behavior regression or TDD red observation.
- `npm run build`: passed before production edits, including web production/PWA output. Existing large-chunk warning remains.
- `npm run test --workspace @mudd/web`: passed before production edits, 28 files / 532 tests, 46.65 seconds.
- `npm run typecheck --workspace @mudd/web`: passed before production edits.
- Runtime observed: Node 23.4.0; npm reported engine-range warnings during install. Chromium and Docker are available. No runtime or lockfile changes made.

## Implementation evidence

Other changes' manual verification tasks remain untouched.

- Isolated CSS browser suite after extraction: 6/6 passed. Checks cover recovery ownership, account and standalone Codex independence, both host palettes, shared focus and reduced motion.
- `MUDD_COMPARE_STYLE_BASELINE=1 npm run test:e2e`: 8/8 passed (16.5s) after stylesheet extraction and session contract extraction. Computed appearance matched all 20 pre-edit area/theme/viewport cases; before/after screenshots were captured. Manual screenshot inspection is not claimed.
- `npm run test --workspace @mudd/web -- src/use-game-session.test.tsx src/action-refresh-gate.test.ts src/command-projection.test.ts src/features`: 12 files / 58 tests passed after session-contract extraction. Web typecheck passed afterward.
- `npm run typecheck`: passed across the repository.
- `npm run lint`: completed with 0 errors / 405 warnings. No suppression or policy records changed.
- `npm run build --workspace @mudd/web`: passed after CSS extraction; world JavaScript and Codex remain separate chunks, Codex retains its own CSS chunk, and world CSS remains in the eager app stylesheet.

## Scope decision before module moves

The existing budget remapper in [baselines.mjs](../../../scripts/quality/baselines.mjs) permits path remapping only when a Git comparison reports `unchanged: true`. Its focused test explicitly rejects identical counts remapped across a rename with edits. Verified with `node --test --test-name-pattern='budget additions' scripts/quality/enforcement.test.mjs`: 1/1 passed.

Moving the planned legacy modules requires relative-import edits, so carrying their suppression counts to their destination paths would fail this rule. No such moves, baseline increases, policy changes or gate bypasses have been made. User decision requested: narrowly tested import-only rename support, staged preparatory changes before a later reorganization, or broader legacy refactoring to remove the allowances. This is additional scope beyond the current design; implementation of the module moves waits for that decision.

Remaining verification includes normal-app recovery-state comparison, full fullscreen/control review, final source moves and quality checks, and service-worker-enabled smoke checks. Current code keeps existing world theme persistence owners and the original loading policy.

- Browser baseline: corrected a new-test heading expectation and a flex-item computed-display expectation before production edits. Rerun `MUDD_RECORD_STYLE_BASELINE=1 npm run test:e2e` passed 8/8 tests in 17.7s; 20 screenshots and computed-style JSON files captured under `/tmp/mudd-web-style-evidence`. Initial existing fishing case timed out on readonly command input; passed on rerun without production/test changes to that case.
- CSS red: isolated world recovery assertion expected display:flex but observed block without account CSS; account and standalone Codex characterization checks passed. After moving the unchanged recovery rule to gameplay CSS, the identical check passed: isolated suite 3/3 green (1.5s). Normal application recovery comparison remains pending.

- Expanded route/theme E2E comparison: 8/8 passed (21.5s), including actual world exit, SPA Codex entry after world play, return to lobby after lazy Codex, persisted preference and theme toggle.
- Complete web suite after this implementation slice: 28 files / 532 tests passed (47.58s).
- Review: no production function bodies or signatures changed; contract declarations accept at most four parameters. No new or modified classes. Existing large world/session functions remain local debt; no numeric gate bypass or baseline modification was used. CSS cleanup is limited to verified ownership and ordered extraction.
