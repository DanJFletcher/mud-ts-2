# Tasks

## 1. Reproduce and choose recovery behavior

- [x] 1.1 On the running Vite dev server, perform a controlled invalid CSS update followed by a valid update; capture the `vite:error` and HMR update payloads, confirm whether the page recovers without refresh, and restore the tracked stylesheet unchanged.
- [x] 1.2 If native HMR leaves the page stale after a successful CSS update, add a dev-only one-shot recovery helper and unit tests proving it recovers only after a CSS error followed by a successful CSS update; if native HMR recovers, record that result and add no fallback code.

## 2. Verify the preview and production boundary

- [x] 2.1 Repeat the invalid-to-valid CSS smoke test in a browser and verify the latest styles appear, the original error remains actionable, and ordinary CSS updates do not reload the page.
- [x] 2.2 Run `npm run build --workspace @mudd/web` and verify the production build succeeds with no production-only CSS or application behavior changes.

## Verification notes

- In an isolated Vite 8 server, a missing CSS import emitted `vite:error` with the PostCSS message, `vite:css` plugin, and stylesheet path.
- Restoring valid CSS updated the rendered style in the same browser page; the page load count remained one. Ordinary CSS updates also applied without reload.
- A second browser smoke run confirmed the same recovery and actionable error payload.
- The temporary probe lived under `/tmp` and was removed. No tracked stylesheet or application code was changed.
