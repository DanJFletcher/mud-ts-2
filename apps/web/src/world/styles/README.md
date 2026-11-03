# World stylesheet ownership

[The app CSS entry](../../index.css) eagerly imports [index.css](./index.css). Keep this topology during source moves: world JavaScript remains lazy, but world styles are intentionally eager.

The aggregator preserves the original gameplay sequence: theme, shell, terminal, chat, map, then screen/navigation rules and their late responsive overrides. Some shared panel-disclosure rules remain in the terminal section because moving them later would change precedence. The final screen stylesheet also retains late responsive adjustments for other world components. Further colocation requires rendering comparisons rather than sorting selectors by name.

World theme tokens override shared root tokens only under the world host. Standalone Codex inherits shared tokens; embedded Codex inherits world tokens. App resets, focus and reduced-motion rules belong to [shared app foundations](../../app/styles/base.css), not to world styles.

Recovery-action styling belongs to the world; world controls must not depend on account CSS. App-owned adaptations of shared UI components remain here unless a verified defect requires a supported UI styling hook.

## Verification

Run isolated browser checks with `npx playwright test --config apps/web/style-tests/playwright.config.ts` from the repository root. The fixture loads only declared area styles and shared UI foundations; it is not shipped as an application route.

For real application baselines, run `MUDD_RECORD_STYLE_BASELINE=1 npm run test:e2e`. Screenshots and computed-style records go to `/tmp/mudd-web-style-evidence` (override with `MUDD_STYLE_EVIDENCE`). After refactoring, run `MUDD_COMPARE_STYLE_BASELINE=1 npm run test:e2e` to compare computed appearance and save after screenshots. Ordinary E2E runs capture evidence without requiring pre-existing temporary files.
