# Responsive mobile-first PWA implementation

## Initial mobile layout

First design for 320–390 CSS-pixel widths. The central journey is **read room description → inspect exits/entities → issue command → read feedback**. On mobile: readable narrative region, scrollable bounded transcript where appropriate, persistent accessible composer without obscuring navigation, large interactive targets, safe-area-aware bottom regions, and flexible height when the software keyboard appears. On desktop, enhance with optional status/sidebar and multiple resizable or adaptive panels; never make wide multi-pane layout mandatory.

Use CSS grid/flex constraints instead of fixed viewport-sized blocks that trap content. Respect `env(safe-area-inset-bottom)`, `100dvh` where supported, and avoid nested scroll regions when unnecessary. Test landscape, one-handed use, large text, browser zoom, input focus while soft keyboard open, focus staying visible under sticky toolbars, and long room names and user-generated strings.

## PWA fundamentals

- Web app manifest with name/short_name, display mode, start_url and scope, theme/background colors, correct installable icons and maskable icon if desired; icons are project-owned assets.
- Service worker and offline fallback only with a deliberate cache plan; Vite PWA tooling may simplify generation but is not mandatory. Verify the plugin's *current* API before use.
- Cache public immutable static assets/versioned bundles, avoid accidental caching of authenticated/private API responses, session cookies, chat logs, and per-user projections.
- Distinguish **app-shell cache available** vs **world playable offline**. Online worlds need authority, so offline state must be explicit. Local-host mode can provide real offline play only if the existing engine supports it.
- Do not silently enable aggressive `autoUpdate` or force reload mid-combat/command entry; notify users before applying breaking updates when possible. Preserve drafts and pending state safely before reload.
- Test deep links with SPA fallback in hosting environment; use HTTPS in deployment; Replit preview and production may differ.
- Never assume Background Sync or install prompts exist across browsers; feature-detect and provide fallback.

## Connection UX matrix

| Mode/state | Display | Allowed |
|---|---|---|
| Local-only playable | Explicit local mode badge/notice, persistence scope | Local adapter commands only |
| Connecting | Loading and cancellation/timeouts | Read cached public UI, preserve draft |
| Connected and synchronized | Normal play | Typed commands through SDK |
| Reconnecting | Non-blocking warning; retries/backoff status | Do not imply action success |
| Resyncing | Stale/progress state until snapshot/cursor caught up | Avoid irreversible commands unless SDK guarantees safety |
| Offline while server-authoritative | Clear unavailable status; draft saved | No fabricated accepted commands |
| Protocol/auth error | actionable alert with retry/sign-in | Handle safely, no infinite loop |

## Accessibility and device quality

- Target WCAG 2.2 AA. WCAG 2.2 AA minimum pointer target is 24×24 CSS px or sufficient exceptions/spacing; design system aims for **44×44** for key touch controls because the minimum alone may be uncomfortable.
- Supports system reduced-motion; don't make direction/availability identifiable solely by color.
- Prose and command text supports text resizing and non-Latin scripts; ensure long strings wrap or scroll intentionally.
- Use meaningful landmark/heading structure; avoid focus traps; test keyboard alternatives to gesture interactions.
- Include network and event updates that are announced thoughtfully—not every movement frame or entire transcript replay.

## Tests and tooling

1. PWA build/dev check, generated manifest and assets existence, production preview service worker registration, offline shell and update behavior.
2. Playwright device viewport + keyboard/focus: 320, 390, 768, 1280 widths; test browser overflow and on-screen keyboard manually on at least one phone if available.
3. E2E local stub / actual SDK: connect, room read, command, result, error and reconnect.
4. Manual check iOS Safari and Android Chrome when devices are available, and note untested devices honestly.
5. Lighthouse/PWA checks can guide quality, but do not misrepresent a single score as proof of usability or offline game functionality.

## References

- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Best_practices
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- https://vite-pwa-org.netlify.app/ (verify relevant version and integration docs)
