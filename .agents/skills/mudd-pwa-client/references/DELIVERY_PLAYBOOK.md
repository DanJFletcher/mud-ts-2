# Iterative execution playbook & gates

## Phase 0: audit

Read existing code, scripts, CSS, story files, SDK and ADRs. Summarize repo findings and create next-vertical-slice component inventory. Do not blindly overwrite existing design system or change package manager. Identify accepted brand/theme choices if present and reuse them.

## Phase 1: bootstrap the design system

Create or audit `@mudd/ui` with public exports, CSS token source, Storybook React Vite, global theme decorator, baseline stories, a11y addon, and a repeatable build/test path. Start with Button, Panel, typography specimen, and one text input. Ensure Storybook and app render the same colors/fonts before continuing. Do not spend time on an entire unused catalog.

**Gate:** Storybook opens, button/panel/text stories render in dark/light and narrow viewport; production Storybook build works; baseline interaction and a11y tests are executed where supported; app imports components from package instead of cloning them.

## Phase 2: make exploration playable

Add RoomDescription, ExitList, ConnectionStatus as presentation-only components with fixtures. Compose ExploreScreen; connect using existing typed client SDK or documented stub adapter. Render loading/empty/connection error/rejected command states. Keep game description as selectable text.

**Gate:** on mobile, room renders at 320px without horizontal overflow, exits are focusable/operable, movement callback reaches SDK, update comes from projection/event; mock stories cover empty and long descriptions.

## Phase 3: command & transcript

Build CommandComposer and Transcript with props/fixtures/stories. Handle Enter submit and Shift+Enter for multiline if applicable, IME composition, errors, drafts, focus, long history, autoscroll away from bottom, and polite announcements.

**Gate:** E2E command → SDK → event/projection update. Rejected command does not change projected world. Duplicate replay doesn't duplicate entries. A long transcript doesn't block input on reasonable reference hardware.

## Phase 4: PWA readiness

Add PWA manifest/icons, secure cache strategy, production offline-shell fallback, reconnect/resync states, update UX, safe area/keyboard behavior, deep link handling.

**Gate:** install basics verified where supported; production preview handles offline gracefully; mode distinctions are truthful; large touch targets and keyboard navigation checked.

## Phase 5: next user-requested features

Plan each feature at most a couple UI layers ahead. Add or upgrade components in Storybook first, then compose. Follow full command/event flow; coordinate engine changes via `mudd-architect`. Do not build inventory/crafting/economy/combat screens until required by chosen gameplay slice.

## Change-specific loop

1. Capture issue or expected behavior as story/interaction test (when component-owned).
2. Identify reusable component vs screen adapter scope.
3. Change component API and stories/fixtures.
4. Run story/test/a11y checks; manually inspect keyboard states where needed.
5. Wire in real screen via SDK adapter.
6. E2E and production build; document changed tokens/components and any migration.

## Forbidden anti-patterns

- One giant `App.tsx` with ad hoc UI controls and networking mixed together.
- Copy-pasting Button/Card/Modal/Tabs variants per screen.
- Creating mock UI that isn't wired and calling the feature complete.
- Storybook as a static screenshot gallery with no realistic error/interactive states.
- CSS constants duplicated in app and library, or Storybook rendering without production theme imports.
- Overabstracting a 'universal component renderer' before 2–3 real use cases.
- Server authority simulated via `setState` pretending a move succeeded, except explicitly labelled fixtures/local-host mode.
- Whole-world history or proprietary content loaded into UI bundles.
- Hiding navigation behind hover-only actions or tiny tap targets.
- Auto-scrolling on every message even when user is reading older history.
- Claiming offline server gameplay from service-worker asset caching alone.

## Completion report example

"Added semantic action/surface/text tokens and Button/Panel/ExitList to `@mudd/ui`; created 12 stories and tested interaction/a11y. ExploreScreen now uses `@mudd/ui` and a typed adapter for `movement.move`. Verified Storybook static build, app typecheck, and E2E happy/error path. Manual iOS soft-keyboard test remains; next slice is command transcript."

Only report test numbers and passes that actually occurred. Take screenshots for human review when possible, but still provide real source changes and verification evidence.
