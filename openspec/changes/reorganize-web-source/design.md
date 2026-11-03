# Design

## Context

See [proposal.md](./proposal.md) for motivation and [style isolation](./specs/web-style-isolation/spec.md) for observable guarantees. Source inspection and focused research found:

- [main](../../../apps/web/src/main.tsx) mounts [AccountApp](../../../apps/web/src/app/AccountApp.tsx); [App](../../../apps/web/src/world/WorldClient.tsx) actually contains world/session composition. Existing [feature ownership documentation](../../../apps/web/src/world/features/README.md) already describes controllers, screens, session ports, and shared UI boundaries.
- [Controller options](../../../apps/web/src/world/features/controller-options.ts) derives session operations from the hook's return type. [PlayScreen](../../../apps/web/src/world/screens/PlayScreen.tsx) imports world panels and controller types. These are app-local dependencies, not evidence that all controllers need redesign.
- [main](../../../apps/web/src/main.tsx) imports shared UI and app CSS; AccountApp independently imports account CSS. [index.css](../../../apps/web/src/index.css) imports Tailwind and eager gameplay CSS before its app theme mapping and global rules. Preserve the actual import graph and inspect emitted order rather than assuming textual import order in main alone determines precedence.
- [UI styles](../../../packages/ui/src/styles.css) define root theme tokens; [gameplay styles](../../../apps/web/src/gameplay.css) override them on `.focused-client`. Lobby and world navigation independently maintain the same persisted theme preference. Codex derives colors from its host, so embedded and standalone palettes intentionally differ.
- `.focused-session-recovery-actions` is defined in [account styles](../../../apps/web/src/app/account.css) but used by world composition and PlayScreen. Conversely, account-qualified `.focused-kicker` and `.focused-screen-title` selectors have no confirmed current account markup consumers; they are not proof of a live account dependency on world typography.
- [Public home styles](../../../apps/web/src/lobby/public-home.css) deliberately use `:has(.mudd-home)` to adapt lobby layout. World and Codex styles also adapt shared `.mudd-*` descendants. Moving files must preserve those relationships.

No browser-computed cascade or rendering equivalence has been verified during planning. The original checkout named in the initial request could not be read; this plan targets the attached worktree.

## Goals / Non-Goals

**Goals:** Make ownership visible without replacing existing controller architecture; make stylesheet dependencies explicit and independently verifiable; preserve loading boundaries, visual design, and session semantics.

**Non-Goals:** Full gameplay feature colocation, broad screen/controller API rewrites, a theme provider migration, CSS Modules conversion, cascade-layer migration, lazy world CSS, or completion of outstanding checks in another change. Do not impose a new abstraction merely to meet a numeric limit.

## Decisions

### 1. Organize by application area and preserve internal world boundaries

Use this target shape; tests remain beside their modules:

```text
src/
  main.tsx
  index.css
  test-setup.ts
  vite-env.d.ts
  app/
    AccountApp.tsx
    account.css
    styles/
      base.css
  lobby/
  codex/
  world/
    WorldClient.tsx
    session/
    commands/
    features/
    screens/
      panels/
    styles/
      index.css
      theme.css
      shell.css
      terminal.css
      map.css
      chat.css
      screens.css
  e2e/
```

Move existing world-only commands/features/screens together. Consolidate the root session hook, refresh gate, command projection, and existing feature/session lifecycle infrastructure under world/session. Update controller imports without making session infrastructure depend on feature implementations. Keep feature-specific helpers with their owner: dialog focus with panels, NPC farewell with dialogue presentation. Keep Codex content and its relative loader glob together. Retain world Codex composition within world screens while consuming the independent Codex capability.

The alternative of only clearing the root leaves generically named world folders scattered across the app. Fully colocating every view and controller would introduce cross-feature ownership decisions that this move does not need.

### 2. Make only necessary dependency refactors

Name an explicit session contract for the operations consumed by controllers, located with session ownership, instead of tying shared controller options to the entire hook implementation. Keep contracts narrow and verify the hook satisfies them without casts or transport type duplication. Preserve injected clients, session generation boundaries, refresh-gate ordering, uncertain command identity, and execution-versus-presentation lifetimes.

Keep current screen props unless moving a module reveals an actual cycle or a dependency on an implementation detail that blocks ownership. Do not mechanically copy controller return types into new interfaces. Further thinning of WorldClient and broad presentation-interface work are follow-up changes; touched production functions still require the local behavior-protected refactor necessary to satisfy the repository's numeric gates.

### 3. Separate CSS ownership without changing loading policy

Keep index.css as the app CSS entry, including Tailwind integration and existing theme utility mapping. Extract global reset, document background, focus and reduced-motion rules into app/styles/base.css while retaining their cascade position. Base styles must not import world components or world-exclusive rules.

Keep the shared UI stylesheet imported as today. Extract the world-local palette and color-scheme overrides into world/styles/theme.css without flattening them into the shared root theme. Preserve both existing theme controllers, their storage key, default preference and document updates; replacing them with a provider is unnecessary for source moves.

Split the remaining gameplay stylesheet into cohesive world-owned files using the existing declaration sequence as the baseline. world/styles/index.css is a deterministic aggregator, imported eagerly from the app CSS entry at the current gameplay import position. Do not move that import into a lazy component. Keep repeated selector blocks, media-query precedence and keyframe behavior until equivalent ordering is demonstrated; ownership extraction must not silently reorder overrides.

Move recovery-action styling from account CSS into its world owner. Extract a shared app rule only when current consumers in multiple areas actually need it. Leave unproven historical rules alone unless removal is justified by verified unused markup and relevant rendering checks.

Component-local imports remain local where already established, including Codex. Importing a CSS file from a component does not scope its selectors. Prefer existing namespaced selectors and explicit ownership over renaming every class or adding broad ancestor selectors that could break portaled dialogs.

### 4. Preserve UI library boundaries and limit override cleanup

Keep layout adaptations in app styles. Preserve existing `.mudd-*` descendant overrides during extraction. When an override prevents area isolation or demonstrably relies on unstable component structure, replace only that dependency with a supported UI variant/styling hook, backed by stories first. Do not turn this change into an inventory-wide component redesign. No new UI API is assumed necessary before that evidence exists.

### 5. Verify independence in the browser as well as normal builds

Establish passing web behavior tests and fixed-environment screenshots before edits. Use the existing Playwright tooling for focused stylesheet-boundary checks with shared foundations and the area's declared styles, intentionally omitting unrelated area styles. Keep this fixture test-only and out of production routes. Assert visible behavior and computed styles, not CSS filename substrings or private class structure.

The world recovery fixture should first reproduce the account-CSS dependency as an observable layout failure. Fix the rule's ownership, then observe the same check pass. Account/lobby and standalone Codex fixtures establish independence from world CSS; passing characterization checks are a baseline, not a fabricated red cycle. Reuse authenticated E2E fixtures for full route transitions and world entry.

Compare direct loads and navigation sequences for public home, lobby, standalone Codex, world play and embedded Codex at 390px and 1280px widths in both themes. Check selected colors, layout, recovery controls, command inputs, disclosures, panel fullscreen, focus and reduced motion. Use deterministic content and wait for fonts before screenshot comparisons. Record rendering checks separately from unit/type/lint results.

Inspect the production build's CSS ordering, lazy JS/Codex boundaries and service-worker asset behavior. Existing E2E configuration blocks service workers, so it cannot by itself prove PWA update behavior. Preserve chunk-relevant component names where appropriate and update explicit caching patterns only if emitted output requires it.

## Risks / Trade-offs

### Approved addition: import-only rename budget migration

The current budget remapper accepts only byte-identical file moves. The user authorized extending it before continuing the module moves. Add a separate eligibility proof used only by suppression-budget comparison; never set `file.unchanged` for an edited file or alter hunks, numeric selection or site-ledger occurrence checks.

Accept only Git-detected one-to-one renames whose exact source differs solely within relative top-level static import/export module-specifier string contents. Parse source rather than stripping strings with regex. Preserve comments, formatting, quotes, declaration order, imported identifiers, type modifiers and all other text. Reject parser failures, files containing unsupported dynamic imports/require/import globs (even unchanged loader text), copies, ambiguous mappings and unsupported dependency resolution.

Resolve every relative static dependency, even unchanged specifiers, against tracked base/head inventories. Require each head target to equal the original target or its unique Git-renamed destination. Initially support explicit tracked assets and repository `.js` to `.ts`/`.tsx` correspondence; fail closed for ambiguous/unresolved paths. Permit unchanged/decreased counts only, without new rule allowances or duplicate transfer to both paths. Existing byte-identical handling remains intact.

Tests first reproduce rejection of a valid import-only move. Add adversarial dependency substitution, unchanged-specifier retargeting, body/comment/format changes, copy/ambiguity, count growth and changed-function/site-ledger regressions. Documentation must explain this is a budget path migration, not exemption from changed-function enforcement. Type-contract extraction and any other non-import edits do not qualify for this additional rule; resolve such cases explicitly rather than broadening the classifier.

- [A file split changes precedence] -> Preserve import topology and ordered rule groups first; compare emitted CSS and rendered states before cleanup.
- [CSS remains eager despite new ownership] -> This intentionally avoids a loading-policy change; isolated fixtures verify ownership without introducing a performance project.
- [Themes are accidentally unified] -> Preserve root versus world palette scopes and test standalone versus embedded Codex separately.
- [Moves affect tests, globs, links or quality selection] -> Update imports, documentation, E2E aliases and relevant path-bound records; verify rename-aware explicit-base PR quality checks. Do not increase or regenerate legacy budgets to pass.
- [Legacy long functions become part of a modified-code gate] -> Review rename-only versus edited functions honestly; keep semantic changes small and bring every modified production function into compliance with passing behavior coverage. Do not disable rules or weaken tests.
- [Concurrent world-client work changes files] -> Reconcile with that change's current module map and retain its outstanding manual validation tasks; do not overwrite or claim its completion.

## Migration Plan

1. Establish passing behavior and visual baselines; add the isolated styling regression before changing ownership.
2. Correct CSS ownership, separate foundations/theme and split world styles with eager order preserved.
3. Clarify session contracts and perform application-area moves, updating tests and path references together.
4. Run focused checks after each step, followed by complete web checks, production build, browser matrix and explicit-base quality verification. Run UI checks and Storybook when the shared package changes.
5. Review source ownership, no cycles, class sizes, naming, cohesion and actual TDD evidence. Revert a move or stylesheet split as a unit if verification fails; no data migration is involved.
