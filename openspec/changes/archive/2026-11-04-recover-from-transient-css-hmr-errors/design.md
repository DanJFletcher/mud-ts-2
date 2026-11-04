# Design

## Context

See [proposal.md](./proposal.md) for the observed failure. The web entry imports the shared UI stylesheet and `src/index.css`; that root stylesheet imports Tailwind plus the app and world style bundles. Vite 8 and the Tailwind Vite plugin build the CSS. The logged HMR failures were generic; the current CSS endpoint responds successfully and the page renders normally.

## Goals / Non-Goals

**Goals:**

- Reproduce an invalid CSS update followed by a valid update against the running Vite server.
- Keep the original transform error visible enough to identify its source and plugin.
- Ensure the preview returns to the latest valid styles after a failed update.
- Limit any fallback to the development client.

**Non-Goals:**

- Changing production CSS, Tailwind configuration, or app styling.
- Reloading the page for ordinary successful CSS updates.
- Hiding or suppressing the original Vite error.

## Decisions

### Use Vite's HMR events before adding custom recovery

The first step is to capture the `vite:error` payload and the following `vite:beforeUpdate` / `vite:afterUpdate` payloads during a controlled invalid-save, valid-save cycle. Vite 8 exposes these event types and CSS update paths. Prefer native recovery if the second valid update restores the page; do not add a reload hook merely to silence a transient console message.

If reproduction confirms that the page remains stale after a successful CSS update, add a small dev-only HMR helper. It should remember a CSS-related HMR failure, then trigger one full page reload only after a subsequent successful CSS update. Clear the pending failure after recovery. Do not reload for unrelated JavaScript errors or ordinary CSS updates.

**Alternative considered:** Send a full reload on every stylesheet change. Rejected because it discards app state during normal CSS editing.

**Alternative considered:** Change the CSS imports or Tailwind plugin immediately. Rejected because the current stylesheet transforms successfully and the logs do not identify a broken import or plugin.

### Test the recovery condition separately from the Vite smoke test

Keep the decision logic small enough to unit test: CSS error then successful CSS update requests one recovery; a successful update without a prior CSS error does not; unrelated errors do not request recovery. Add a development smoke test that verifies the browser receives the latest stylesheet after the invalid-save, valid-save sequence. Do not leave invalid CSS in the repository.

## Risks / Trade-offs

- [The original failure cannot be reproduced] → Capture the current successful baseline and avoid shipping a speculative reload hook; record the observed failure as transient if the controlled cycle recovers natively.
- [A reload resets development UI state] → Trigger it only after a recorded CSS HMR failure and only once a later CSS update succeeds.
- [Vite payloads differ across versions] → Use the installed Vite 8 event types and test the exact payload shape; keep matching scoped to CSS paths.

## Migration Plan

1. Establish a baseline by confirming `src/index.css` transforms and the preview renders.
2. Reproduce a failed CSS transform, then restore valid CSS and observe whether HMR recovers without a manual refresh.
3. If native recovery fails, add the dev-only recovery helper and focused tests; otherwise make no runtime or Vite configuration change.
4. Verify the web build and normal CSS hot updates still work.

Rollback is limited to removing the dev-only recovery helper and its tests. Production behavior and assets are not involved.
