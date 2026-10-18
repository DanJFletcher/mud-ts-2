---
name: Replit preview origins
description: Origin and proxy-header behavior when the web client runs through the Replit development preview.
---

In the Replit preview, the browser Origin can include the web server port (`:5000`) while the API behind Vite sees an internal Host such as `127.0.0.1:5001` and a forwarded HTTPS protocol. A hostname-only allowlist entry will not match that browser Origin.

**Why:** A hostname-only development allowlist still rejected signed-in preview actions even though requests sent through the local proxy reached the API.

**How to apply:** When debugging preview origin errors, inspect only safe origin/proxy metadata. Allow the exact Replit development hostname on the preview's known web port; keep production origins explicitly configured and do not accept arbitrary hosts or ports.
