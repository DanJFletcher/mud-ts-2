# Verification

## Outcome and scope

Implemented the application-area layout, explicit common session contracts, ordered CSS extraction and verified import-only suppression-budget migration. Shared UI APIs, protocol, gameplay authority and stylesheet loading policy are unchanged. No other change's tasks or historical planning artifacts were edited.

The branch was created after fetching origin and confirming main/origin/main at `85058f89e85031a7b7f4ceca59ed4bbef693aac0` (0 ahead/0 behind). This is the explicit PR-quality base. Source verification checkpoint: `f9fd1d4`; subsequent completion-record edits are documentation only.

## Observed test-first evidence

- Before production edits, web behavior coverage passed: 28 files / 532 tests. Web typechecking passed. These establish refactor protection, not a new-behavior red cycle.
- Isolated browser test **world recovery actions wrap with spacing without account CSS** failed because computed display was `block`, expected `flex`. Account and standalone Codex checks passed without world CSS. Moving the unchanged recovery rule to world-owned CSS made the same test pass. Full-app recovery states later matched the original rule's flex/wrap/8px-gap layout in both viewports/themes, with visible Retry/Characters controls.
- **Suppression counts follow an import-only rename whose dependency keeps its identity** failed because the destination was treated as a new allowance, then passed after the narrow budget proof.
- The full-gate migration test failed before historical-inventory wiring, then passed after wiring tracked base/head paths into budget comparison.
- Adversarial dependency-destination collision and unchanged unsupported-loader tests each exposed a fail-open case before their production fixes, then passed afterward. Existing numeric selection and site-ledger tests remained intact.
- Account routing and Codex composition were locally refactored under existing passing behavior coverage. Account navigation tests now await their React updates. No red/green claim is made for these behavior-preserving edits.

## Automated results

| Check | Actual result |
| --- | --- |
| `npm run test --workspace @mudd/web` after moves | 28 files / 532 tests passed |
| Focused account/entry tests before moves | 2 files / 56 tests passed |
| Focused session/feature tests after contract extraction | 12 files / 58 tests passed |
| `npm run quality:test` after final guard | 63 tests passed |
| `npx playwright test --config apps/web/style-tests/playwright.config.ts` | 6 tests passed |
| `MUDD_COMPARE_STYLE_BASELINE=1 npm run test:e2e`, sequential final run | 9 tests passed, 32.7 seconds |
| `npm run typecheck` | All workspaces passed |
| `npm run lint` and supported lint pruning | 0 errors / 405 warnings; existing warnings remain |
| Production builds | Passed; separate world JavaScript/Codex assets and eager app CSS retained |
| `npm run test:coverage` with isolated PostgreSQL and normal authentication mode | All nine workspaces passed |
| `npm run quality:pr -- --base 85058f89e85031a7b7f4ceca59ed4bbef693aac0 --head HEAD` at source checkpoint | Passed, no failures |
| `openspec validate reorganize-web-source --strict` | Passed |

All nine coverage floors passed. Measured web coverage: lines 96.82%, branches 83.30%, functions 96.49%, statements 91.66%. The full PR gate independently validates every workspace metric; no floor, exclusion or policy threshold changed.

Budget migration applies only to unique Git renames with identical source outside supported relative static module specifiers and corresponding historical dependencies. Unchanged specifier text is also resolved. Unsupported loaders, copies, ambiguous/substituted dependencies and other edits fail closed. Numeric selection and site identity enforcement are unchanged. The first real gate run correctly refused the WorldClient transfer when Git could not identify the locally refactored Codex dependency; preserving more existing Codex JSX restored an actual R077 correspondence without relaxing the proof.

`npm run quality:prune` removed two obsolete account-test sites (25 -> 23). Lint budget keys follow proved moves; obsolete account/Codex length allowances and account-test floating-promise allowances were removed. No counts increased and no ledger identities were regenerated.

## Browser evidence and scenario mapping

Pre-edit baselines captured public home, lobby, standalone Codex, world play and embedded Codex at 390px/1280px in light/dark themes: 20 screenshots and computed-style records. The final E2E run compares computed appearance with those records and captures after screenshots. Evidence is under `/tmp/mudd-web-style-evidence`; override using `MUDD_STYLE_EVIDENCE`. These are local QA outputs, not committed golden images.

| Spec scenario | Verification |
| --- | --- |
| Account/lobby without world styles | Isolated account-control browser test; shared foundations focus/reduced-motion check |
| World recovery without account styles | Observed isolated red/green test; real full-app unavailable-world states across viewport/theme matrix |
| Standalone encyclopedia without world styles | Isolated Codex-control browser test |
| Theme survives world entry/exit | Real character entry, exit, persisted-theme and toggle assertions in area-appearance tests |
| Encyclopedia follows host palette | Isolated light/dark palette tests and standalone/embedded appearance comparison |
| Return after lazy encyclopedia loading | Actual SPA navigation from Codex back to lobby in area-appearance tests |
| Standalone encyclopedia after world exit | Actual world exit then SPA Codex entry compared with direct-load baseline |
| Visible keyboard focus and reduced motion | Isolated browser focus/reduced-motion assertions; existing modal/keyboard behavior suites |
| Supported import relocation and moved dependency | Focused migration matrix and full-gate fixture |
| Substitution, unchanged-string retargeting and ambiguous dependency | Adversarial migration tests |
| Non-import edits, copies and unsupported loaders | Rejection matrix, including unchanged unsupported-loader red/green regression |
| Count growth and duplicate transfer | Existing enforcement tests plus migration-specific count tests |
| Numeric and site checks remain independent | Same-line function-selection regression and existing site-context/ledger tests |

Browser checks also cover terminal/map/chat fullscreen, terminal disclosure, room-message controls, actual recovery controls and existing shared-component adaptations. No shared UI API change was necessary, so additional Storybook implementation/build work was not applicable. The separate service-worker-enabled test updates registration and reloads the public shell offline; normal gameplay E2E continues to block service workers. It makes no offline multiplayer promise.

A manual mobile before/after screenshot spot check found consistent layout. Vital text differed with live projection timing, so pixel-identical content is not claimed. No full manual screen-reader audit was performed; this change introduces no new controls and does not complete another change's outstanding manual accessibility work.

## Review and process notes

- New/edited production functions were checked by the explicit-base gate; no numeric disables or allowance increases were used. Six existing web classes were reviewed separately: 8–60 nonblank/noncomment lines, all below 100.
- Account provider/navigation, scroll behavior and Codex loading composition received focused local refactoring where required. Existing world/session function bodies remain intact across their moves. Common and gathering controller options use the explicit session contract; specialized travel/social options retain their existing hook-derived types rather than expanding this work into controller rewrites.
- Session infrastructure has no dependency on feature implementations. Generic UI stays in the UI package; app code still consumes SDK authority. Module names and colocated tests make ownership clearer without introducing runtime wrappers.
- Remaining local debt includes the broad WorldClient composition and an existing room-chat effect-dependency warning. Neither was hidden by this reorganization.
- Fresh dependency installation initially left workspace exports unbuilt; tests/typecheck could not resolve them until the production build completed. This was setup failure, not TDD red evidence.
- Runtime observed: Node 23.4.0. npm reported engine-range warnings; no runtime configuration or lockfile change was made.
- One initial existing fishing E2E timeout did not repeat on the subsequent clean baseline. New capture tests needed a heading expectation correction, a flex-item computed-display correction, and reselecting the character before testing recovery after leaving a world. Assertions were corrected to the actual intended public states; production behavior was not changed to satisfy those setup mistakes.
- The first coverage wrapper inherited E2E authentication and failed server-auth expectations. Normal authentication mode corrected the setup and all workspace coverage passed. Overlapping builds invalidated one intermediate browser run; the sequential final browser run passed.
- Automatic approval review briefly stopped a command because of a usage limit; work resumed on the user's continuation. No approval check was bypassed.
