---
name: Replit preview origins
description: Origin and proxy-header behavior when the web client runs through the Replit development preview.
---

In the Replit preview, the browser Origin can include the web server port (`:5000`) while the API behind Vite sees an internal Host such as `127.0.0.1:5001` and a forwarded HTTPS protocol. A hostname-only allowlist entry will not match that browser Origin.

**Why:** A hostname-only development allowlist still rejected signed-in preview actions even though requests sent through the local proxy reached the API.

**How to apply:** When debugging preview origin errors, inspect only safe origin/proxy metadata. Allow the exact Replit development hostname on the preview's known web port; keep production origins explicitly configured and do not accept arbitrary hosts or ports.

Shell smoke tests must also use the main application's explicit preview port when multiple web workflows are exposed.

**Why:** The bare development hostname reached the component sandbox rather than the game API and returned 404, while the same hostname with `:5000` reached the healthy main application.

**How to apply:** Target `https://$REPLIT_DEV_DOMAIN:5000` for main-app HTTP checks when that is its configured port. Do not interpret a bare-host 404 as a failed game endpoint or weaken origin validation.
