---
name: Deployment packaging
description: Distinguish deployment exclusions from Git exclusions when investigating missing runtime files.
---

Keep Git exclusions for installed dependencies and compiled output separate from deployment exclusions. Production requires the built workspace packages, built PWA, dependencies, and migration SQL.

**Why:** Two publishes built successfully but crashed before listening: deployment exclusions removed installed dependencies and compiled output. A local build alone could not detect the packaging failure.

**How to apply:** When production reports missing modules after a successful build, inspect deployment exclusions before changing dependency placement or introducing another runner. Verify the exact production start command with the development server stopped to avoid duplicate world schedulers, then verify the public port targets the game rather than the design sandbox. Only a new publish verifies the resulting deployment image.
