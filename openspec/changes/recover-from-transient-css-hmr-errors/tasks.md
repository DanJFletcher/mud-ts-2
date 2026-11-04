# Tasks

## 1. Reproduce and choose recovery behavior

- [ ] 1.1 On the running Vite dev server, perform a controlled invalid CSS update followed by a valid update; capture the `vite:error` and HMR update payloads, confirm whether the page recovers without refresh, and restore the tracked stylesheet unchanged.
- [ ] 1.2 If native HMR leaves the page stale after a successful CSS update, add a dev-only one-shot recovery helper and unit tests proving it recovers only after a CSS error followed by a successful CSS update; if native HMR recovers, record that result and add no fallback code.

## 2. Verify the preview and production boundary

- [ ] 2.1 Repeat the invalid-to-valid CSS smoke test in a browser and verify the latest styles appear, the original error remains actionable, and ordinary CSS updates do not reload the page.
- [ ] 2.2 Run `npm run build --workspace @mudd/web` and verify the production build succeeds with no production-only CSS or application behavior changes.
