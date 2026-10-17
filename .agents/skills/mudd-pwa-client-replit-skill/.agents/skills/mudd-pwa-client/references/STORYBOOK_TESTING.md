# Storybook as the component lab, test suite, and documentation

## Bootstrap/reuse

**Inspect first.** If a working Storybook exists, reuse/update it rather than initialize again. For new React+Vite workspace, install Storybook with its current CLI (e.g. `npm create storybook@latest` in appropriate workspace, or project's package-manager equivalent), selecting React Vite (`@storybook/react-vite`). Prefer official addons that match installed major versions. Ensure generated Storybook stories use the *actual package exports*, not duplicate mock components.

Required baseline:

1. `.storybook/main.ts`: stories glob, React-Vite framework, installed addons, correct static asset configuration; adapt to workspace structure.
2. `.storybook/preview.ts(x)`: import the very same token/Tailwind CSS pipeline the app consumes; decorators for light/dark and relevant context (avoid production SDK imports), viewport presets as useful.
3. Story files next to components (`*.stories.tsx`) or in dedicated stories folder with predictable convention; keep `Meta` and `StoryObj` typing current.
4. a11y addon; Vitest addon for a supported Vite version/browser test environment. If unavailable in Replit, run alternatives and report what could not be executed (do not claim coverage you lack).
5. Storybook scripts for dev and static build; test scripts integrated into workspace/CI where supported.

## Stories are behavioral specifications

Every component story should demonstrate the states and usages the app depends on. Typical story set:

- Button: Primary, Secondary, Disabled, Loading, KeyboardFocus, LongLabel, ContrastDark/Light (prefer global themes).
- TextField/CommandComposer: Empty, Filled, Submitting, Error, LongContent, MobileViewport, IME/Enter interaction.
- RoomDescription: Standard, LongRoom, NoExits, ObjectsAndActors, Dark.
- Transcript: Empty, SingleSystemMessage, LongHistory, IncomingWhileScrolledUp, ErrorEvent, HighVolume (performance fixture).
- ConnectionStatus: Connecting, Online, Reconnecting, Resyncing, Offline, LocalOnly.

Use serializable args for view data and `fn()` callbacks where appropriate. Avoid requiring live WebSocket server in Storybook: supply fixtures, mocked providers and deterministic simulated behavior. Storybook is not a free pass to freeze behavior; interaction-rich states need real `play` functions or focused tests.

## Interaction and accessibility testing

Prefer `@storybook/addon-vitest` in compatible Vite projects and `@storybook/addon-a11y`, following official setup for actual installed versions. Use `play` functions with queries scoped to story canvas, `userEvent` and `expect` from current Storybook-supported testing API. `play` should assert meaningfully: action enabled/disabled, Enter submit, error messaging, focus movement/restoration, scrolling behavior when testable. Tests should not simply verify that a prop string renders.

Axe automates only a portion of WCAG coverage. Additionally run manual keyboard-only checks for all compositional patterns and at least one realistic mobile and desktop user journey; screen reader checks for log/announcements and dialogs if tools are available. Record when they weren't possible. Make a11y errors fail the tests for stable component stories (`parameters.a11y.test = 'error'` under supported Storybook versions), except explicitly documented legacy exclusions with issue/ticket.

### Visual regression

Adopt screenshot comparisons for critical representative variants if tooling is available (Storybook visual tools, Playwright snapshots, or a chosen visual CI system). If baselines are not configured, produce manual side-by-side checks on Storybook states and state that automated visual regression is not available. Keep viewports stable and fixtures deterministic. Check 320/360/390 CSS-pixel mobile, tablet ~768, desktop ~1280 (adjust for real product analytics), dark and light, 200% zoom/large text where feasible.

## End-to-end integration tests are separate

Storybook tests components. Playwright or equivalent E2E should prove: open room, show exits, type/send command, receive pending/ack/error, update projected room/transcript, reconnect, preserve draft, and install/offline fallback where supported. A Storybook 'success' story with mocked callbacks doesn't prove a command went through SDK/authority. Ensure test fixtures use valid command IDs and event ordering; no proprietary adventure content needed.

## Version-safe commands

Examples only; adapt to workspace package manager and installed major versions:

```sh
npm create storybook@latest
npx storybook add @storybook/addon-a11y
npx storybook add @storybook/addon-vitest
npm run storybook
npm run build-storybook
```

Never blindly paste unrelated old version config and mark tests as passed. Verify commands in package scripts and build after setup. If Storybook and the app have CSS mismatch, fix the shared style pipeline before writing more screens.

## Official docs to consult

- https://storybook.js.org/docs/get-started/frameworks/react-vite
- https://storybook.js.org/docs/configure/styling-and-css
- https://storybook.js.org/docs/writing-stories/args
- https://storybook.js.org/docs/writing-stories/play-function
- https://storybook.js.org/docs/writing-tests/accessibility-testing
- https://storybook.js.org/docs/writing-tests
