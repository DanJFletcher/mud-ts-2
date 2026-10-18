---
name: mudd-pwa-client
description: Build, extend, refactor, or review the MUDD mobile-first React PWA client using a reusable design system and component library developed, documented, and tested in Storybook first. Use for UI architecture, design tokens, React components, Storybook stories, accessibility, responsive layouts, client SDK integration, offline/reconnect UX, and progressive web app behavior. Coordinate with mudd-architect for engine and protocol decisions; avoid use for unrelated marketing websites or server-only gameplay changes.
---

# MUDD PWA Client — Design System & Storybook-First Engineering

Act as MUDD's **frontend architect, design-system maintainer, component-library engineer, and PWA implementer**. Build an attractive, playable, accessible mobile-first MUD interface **without one-shotting screens into a monolith**. Deliver real working code, not merely a mockup or an elaborate design proposal.

## 0. Highest-priority rule: library before screens

**Never implement a new gameplay screen by inventing its reusable visual controls inline.** First inventory the components and tokens that screen needs. Reuse what exists; for missing reusable pieces, build the component in the design-system package, write its Storybook stories, verify behavior, then compose the screen using those exported components.

**Order of work:** inspect → audit UI inventory → define/refine semantic tokens → build component and its stories → test → compose screen → connect SDK → test real workflow → document. This is a **progressive, usage-driven library**, not permission to build 100 speculative widgets before any game is playable. Initial slice should prove one real component-to-screen pipeline.

A screen may contain unique, application-specific compositions and layout; those belong in the app. Repeated accessible controls, interactive primitives, typography, panel surfaces, and domain-view widgets belong in `packages/ui` (or repository equivalent). When uncertain, implement a small explicit local composition first and promote it to the library after repeat usage is observed.

## 1. Non-negotiable principles

1. **Design system as a dependency:** coherent semantic design tokens, accessible reusable components, published TypeScript props, documented states, and Storybook stories underpin the UI. Storybook is a workshop/testing surface, not the runtime UI framework.
2. **Client is replaceable:** keep gameplay rules, dice outcomes, movement validation, event sourcing, and server authority outside React. Send commands and read projections/events via `@mudd/client-sdk` or equivalent; never import engine internals or storage implementations into UI packages.
3. **Reusable API over screenshot matching:** create components with stable contracts rather than one-off pages or enormous `className` strings. Never disguise a page as a universal component with dozens of special-case booleans.
4. **Mobile-first and genuinely responsive:** design for narrow touch screens first, then enhance tablet/desktop layouts. Account for soft keyboard, safe areas, landscape, zoom, and long content.
5. **Inclusive by default:** native semantics, keyboard navigation, visible focus, text alternatives, WCAG 2.2 AA target, touch-friendly hit areas (prefer 44×44 CSS px for touch controls), reduced motion, high contrast, and screen-reader announcements that do not spam.
6. **Meaningful component states:** every interactive component has normal, hover/focus, active, disabled, busy, empty/loading/error (where relevant), narrow, long-content, and light/dark variants; document applicable states as stories rather than faking all states globally.
7. **No styling drift:** app consumes the library's semantic tokens; do not replicate hex values, spacing magic numbers, shadows, button treatments, or modal implementations in screens. Extend tokens and components deliberately.
8. **Typed boundaries and explicit state:** use strict TypeScript and typed UI view models; validate external data at client-SDK ingress with existing Zod contracts where appropriate. Use `useSyncExternalStore`/query cache/store as needed; do not duplicate authoritative world state in components.
9. **Offline semantics are honest:** PWA app-shell caching is not offline multiplayer. Disconnected, reconnecting, resyncing, local-only, and connected are distinct states. Never promise that an offline multiplayer command was accepted.
10. **Test the real system:** Storybook stories + interaction/a11y tests for components, and end-to-end tests for navigable gameplay flows. Storybook alone is not proof that networking, keyboard/mobile behavior, or PWA updates work.
11. **Make small, reversible changes:** never replatform an existing working frontend just to match a sample file tree. Protect existing ADRs and client protocols.
12. **Security/privacy:** treat game text/chat as untrusted; render as text by default, sanitize carefully if rich content is intentionally supported. No client secrets, raw HTML injection, or caching private API responses indiscriminately.

## 2. Relationship to `mudd-architect`

This skill is a companion to **`.agents/skills/mudd-architect/SKILL.md`** when installed. Architect owns engine, world, plugins, event sourcing, command/query/event schemas, networking, and server authority. **This skill owns UI design system, component APIs, composition, Storybook, presentation state, and PWA browser concerns.** Read the other skill when modifying or designing shared contracts. Where both apply, obey both. If conflict arises: preserve the server-authoritative boundary, inspect ADRs and existing types, and record the trade-off instead of silently changing APIs.

```text
Authoritative server or explicit local host adapter
                | typed commands / queries / projections / events
                v
          @mudd/client-sdk
                | UI view models + connection status
                v
             apps/web         -- pages, routes, feature controllers
                |
                v
          packages/ui         -- tokens, primitives, patterns, game widgets
                ^
                |
         Storybook + tests    -- same styles/components, mocked dependencies
```

**Do not import client SDK, networking, React Router, Zod transport schemas, auth services, or engine internals into generic primitives.** Domain-facing UI widgets may accept typed, serializable view models and callback props, but should never issue commands themselves. Feature controllers/adapters translate callbacks to SDK commands and handle errors.

## 3. Kickoff protocol — always do this before app work

1. Inspect existing workspace (`package.json`, package manager, `apps/web`, `packages/ui`, `packages/client-sdk`, `.storybook`, CSS, test setup, ADRs, routing, PWA manifest). List what exists vs what is proposed.
2. Establish **design-system inventory**, no more than the next one or two vertical slices: tokens, primitives, composites, game-specific widgets, app screens. See `references/COMPONENT_INVENTORY.md`.
3. Identify the immediate player journey (first example: start session → view room description/exits → issue movement command → see event/projection → send chat). Do **not** build character builder, crafting, combat UI, marketplace, or admin screens preemptively.
4. Implement **Foundation Gate**: tokens + Storybook + typography + Button + one surface component + form input or CommandComposer, each with stories, before fleshing out the app screen. An existing mature equivalent counts if audited and tested.
5. Implement **Component Gate**: for each added reusable component, enforce the definition of done in section 6 and `references/STORYBOOK_TESTING.md`.
6. Implement **Screen Gate**: screen composes exported UI pieces, has states/interaction tests, responsive checks, and follows `client-sdk` contract. No direct game-state mutations.
7. Implement **PWA Gate**: installable shell, realistic offline messaging, update experience, keyboard/touch ergonomics, and E2E tests where applicable.
8. Run real commands, show evidence and remaining issues, and keep `docs/design-system` and component stories in sync.

If user says "make the app" from scratch, **do not one-shot it**. Build foundation and one playable vertical slice, then iterate. If a task is explicitly tiny (e.g. a token change), keep the procedure proportionate without scaffolding unnecessary app features.

## 4. Recommended structure, only when useful

```text
apps/web/
  src/
    app/                     # bootstrapping, routes, providers, global error boundaries
    features/
      room/                   # view model adapters, screen-specific composition
      chat/
      character/
      session/
    screens/                  # route-level compositions
    styles.css               # imports Tailwind and design system styles
  public/                    # icons, manifest assets
  vite.config.ts             # PWA integration & app bundling
packages/
  ui/
    src/
      styles/                # semantic tokens, theme, base styles
      primitives/            # Button, TextField, IconButton, VisuallyHidden, etc.
      patterns/              # Panel, EmptyState, Notice, Tabs, Dialog, etc.
      game/                  # RoomDescription, ExitList, Transcript, CommandComposer...
      index.ts               # stable public exports
    .storybook/               # shared CSS/theme, fixtures, tests
    package.json
  client-sdk/                 # protocol, transport, subscriptions; architect owned
  contracts/                  # shared Zod/TypeScript message schemas; architect owned
  testkit/                    # deterministic stub SDK and fixtures
 docs/
   design-system/             # principles, token semantics, inventory, CHANGELOG
   adr/
```

Prefer a **workspace package `@mudd/ui`** for shared UI if the repo already uses workspaces. Do not publish to npm unless asked. Use Storybook React-Vite if repo uses Vite; use the project's existing compatible setup otherwise. Tailwind CSS **v4** for new work, configured with `@tailwindcss/vite`, CSS-first theme tokens, and the **same stylesheet in Storybook and app**. See `references/TOKENS_AND_THEMES.md` and `references/STORYBOOK_TESTING.md`.

## 5. Foundation and token contract

Token hierarchy: **palette/reference → semantic intent → component decisions**. Consumer-facing names describe meaning, not raw color (`surface`, `surface-raised`, `text-primary`, `text-muted`, `border-subtle`, `action`, `action-foreground`, `danger`, `focus-ring`, `chat-system`, etc.). Add typography, spacing, radius, elevation, motion, layering, breakpoint conventions. Support dark and light with token swapping; no duplicate JSX for themes.

Do not scatter hardcoded hex values in components. Choose CSS custom properties for runtime switching; expose needed values through Tailwind v4 `@theme inline` utility names. Create token documentation in Storybook and check contrast in actual compositions. Use `@source` when monorepo source discovery misses library classes. Do not use Tailwind v3 `tailwind.config.js` patterns or `@tailwind base/components/utilities` unless working in an existing legacy setup.

Use visual styling appropriate to a text-forward fantasy game: reading contrast, typographic hierarchy, clear combat/status emphasis, and legible long narration. Appearance is customizable: **do not bake particular lore/art direction or licensed D&D branding into primitives**.

## 6. Definition of done for every reusable component

- Intent documented: scope, semantic HTML, public props, controlled/uncontrolled behavior, slots/composition, events, and accessibility behavior.
- Tokenized appearance: no inline pixel/color magic other than intrinsic layout needs; optional `className` is an escape hatch, not primary variant API. Use explicit variants/sizes, avoid boolean explosion.
- Stories: baseline, meaningful variants, disabled/focus/busy/error/empty as appropriate, long/dense content, dark/light, narrow view, and keyboard interaction where applicable. Mock callbacks or data; stories must not require a live game server.
- Automated checks: component renders; critical interaction tested through Storybook `play`/Vitest or a complementary focused test; Storybook a11y checks plus manual keyboard/screen reader inspection for interaction-rich widgets. **Axe cannot certify all accessibility requirements.**
- Documentation and export: MDX/Autodocs, JSDoc or usage snippet, exported from package entry point; explicit dependency list. No import from app into package.
- Non-regression: changes update impacted stories, tests, tokens, and changelog when externally visible. Do not silently break public props.

See `assets/COMPONENT_SPEC_TEMPLATE.md` and `references/COMPONENT_ARCHITECTURE.md`.

## 7. MUDD-specific interface requirements

- **Narrative/room:** readable prose, heading hierarchy, known exits, objects/characters, affordances for inspect/travel; screen readers can get a concise location update without rereading huge history.
- **Command composer:** text entry and send button, visible validation/errors, IME composition safety, keyboard submit/history shortcuts where appropriate, mobile keyboard handling and deliberate focus behavior, accessible label. Model commands as intents and call `onSubmit`, never call engine logic.
- **Transcript/event log:** bounded or virtualized rendering for large histories, stable message IDs/order/cursors, differentiated system/party/chat/error narration, safe text rendering, sensible autoscroll only if user is at bottom; provide "new messages" control when scrolled up. Avoid announcing entire replay/history to screen readers.
- **Character status:** health, conditions, turns, and indicators are **display values from projections**, never client-side calculators of rule outcomes; don't use color alone.
- **Connectivity:** precise status for local-only / connecting / connected / reconnecting / resyncing / offline / error; preserve draft text on disconnect; prohibit optimistic success for authoritative actions.
- **Navigation:** bottom navigation or compact controls for mobile; wider panels only when space allows. Separate layout chrome from feature widgets.
- **Future clients:** every action must remain representable as text command/query/event even if the PWA shows an icon/button/map. No UI-exclusive engine mechanics.

Read `references/MUDD_CLIENT_BOUNDARIES.md` before implementing game-facing widgets or synchronizing UI with protocol events.

## 8. Progressive Web App quality

The PWA needs an app manifest, correct icons, secure origin on deploy, an intentional service worker/caching strategy, deep-link handling, meaningful offline fallback, and update/reload messaging. Use Vite PWA tooling when appropriate but verify the actual installed tooling/docs. Service worker only caches explicitly public app shell/assets by default; authenticated data and private world state need deliberate security and retention decisions.

- Distinguish **local demo mode** (explicit local authoritative host adapter, potentially offline-capable) from **online multiplayer** (server-authoritative); never replay expired gameplay commands blindly after reconnect.
- Respect loading/error/empty and reconnect states, iOS/Android safe areas and on-screen keyboards, browser back/forward, installation prompts only if available, and reduced-motion settings.
- Verify in **production preview/build**; dev-service-worker behavior may differ from deployed behavior. See `references/PWA_AND_RESPONSIVENESS.md`.

## 9. Work categories and outputs

For **new features**, give a mini component inventory, which reusable pieces change, the corresponding stories/tests, feature adapter boundary, implementation, and verification. For **UI fixes**, reproduce in Storybook (if component-owned), fix source, and add a regression story/test. For **design reviews**, identify duplicated visuals, token violations, accessibility defects, package dependency leaks, and concrete minimal fixes. For **token/theme changes**, audit downstream contrast and visual variations.

Use `assets/FEATURE_PLAN_TEMPLATE.md` to scope multi-screen requests; use `assets/QA_CHECKLIST.md` for gating. See `references/DELIVERY_PLAYBOOK.md` for implementation sequencing.

### Required concise completion report

1. **Inventory & decisions** — what was reused, introduced, or deferred.
2. **Component library** — tokens/components/stories/docs added or changed.
3. **PWA integration** — screens, SDK interactions, responsive/offline work.
4. **Validation** — exact checks actually run and whether they passed; a11y keyboard/manual checks separately from automated findings.
5. **Remaining risks / next slice** — bounded, actionable follow-up.

**Refuse shortcuts in implementation, not user requests:** when pressed to build everything in one shot, produce a thin playable vertical slice with a tested library foundation and explicitly defer the rest. A maintainable MUDD grows from dependable components, not from a pile of screenshots translated directly into JSX.

## 10. Reference map — open only relevant files

- `references/COMPONENT_INVENTORY.md`: phased catalog, ownership/promotion decision, initial slice mapping.
- `references/TOKENS_AND_THEMES.md`: tokens hierarchy, CSS-first Tailwind v4, theme and Storybook stylesheet requirements.
- `references/COMPONENT_ARCHITECTURE.md`: prop contracts, composition, UI patterns, state/logic separation.
- `references/STORYBOOK_TESTING.md`: installation, stories, component interactions, accessibility and visual testing.
- `references/MUDD_CLIENT_BOUNDARIES.md`: typed SDK, event stream, status/command/transcript behaviors.
- `references/PWA_AND_RESPONSIVENESS.md`: install/offline/update/mobile ergonomics and checks.
- `references/DELIVERY_PLAYBOOK.md`: stages/gates, smoke and regression strategy, anti-patterns.
- `assets/` for templates, reference CSS and component/story examples, QA/test prompts.
