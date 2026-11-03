---
name: Playwright E2E prerequisites
description: Environment constraints for production-preview browser tests in the Replit Nix container.
---

Production-preview E2E checks use a fresh PostgreSQL database and a real Playwright Chromium browser. Docker/database readiness failures and missing Chromium shared libraries happen before application assertions run. Some graphics libraries can exist in the Nix store but still be absent from Chromium's dynamic loader path.

**Why:** Treating runner setup failures as application regressions wastes debugging time, while reusing a development or production database would violate test isolation.

**How to apply:** Keep E2E data in a temporary database, verify the browser can launch with its required shared libraries, and separate infrastructure startup results from application test results.
