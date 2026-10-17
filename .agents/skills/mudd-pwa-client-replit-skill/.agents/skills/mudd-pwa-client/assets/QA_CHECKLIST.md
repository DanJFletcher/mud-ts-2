# MUDD UI quality gate — copy into review/checks

- [ ] Inspected existing architecture, UI library and accepted ADRs before implementing.
- [ ] New reusable UI written in `@mudd/ui` (or actual repo equivalent) before screen composition; reused existing control when appropriate.
- [ ] Public exports and prop types documented; no app/engine SDK imports into library primitives.
- [ ] Semantic reference→alias tokens and visual consistency; app/Storybook CSS parity.
- [ ] Stories cover meaningful normal/error/loading/empty/disabled/long/dark/mobile states as applicable.
- [ ] Keyboard focus, accessible names/labels, non-color-only feedback, reduced motion, contrast checked.
- [ ] Storybook interaction tests / a11y addon executed; manual testing reported separately.
- [ ] Room/combat/character mechanics are **not implemented in UI**; typed SDK callbacks and projections are used.
- [ ] Server authority, local demo and offline shell states aren't confused.
- [ ] Mobile 320/390 CSS-px, tablet 768, desktop 1280 width checked for layout overflow.
- [ ] Touch controls comfortable; safe area and software keyboard do not obscure composer.
- [ ] Narrative and chat safely render untrusted text; message history doesn't trigger unbounded live-region spam.
- [ ] Transcript order/dedup, reconnect, stale projection and failed command scenarios checked.
- [ ] PWA production preview (manifest, icons, caching/update) checked if modified.
- [ ] Lint, typecheck, unit/interaction, Storybook static build, app build and E2E run as applicable.
- [ ] Reports precisely what ran; unmet criteria remain visible and actionable.
