# Proposal

## Why

The development preview logged repeated failures while hot-reloading `src/index.css`, but the captured logs omit the underlying exception. The app currently renders correctly and Vite serves the stylesheet successfully, so this change should make transient CSS-update failures diagnosable and ensure a valid follow-up update restores the preview without affecting production.

## What Changes

- Reproduce a failed CSS hot update followed by a valid update and determine whether Vite recovers the current page without a manual refresh.
- Preserve or surface the underlying CSS transform/import error instead of only the generic HMR reload message.
- Add a development-only recovery path if a valid CSS update does not restore the preview.
- Verify the normal build and style output remain unchanged.

## Capabilities

### New Capabilities

None. This is development-tooling behavior, not a new application capability.

### Modified Capabilities

None. No user-facing application requirements change.

## Impact

Expected scope is limited to the web development workflow, likely `apps/web/vite.config.ts` and a focused development verification. No production styles, application APIs, dependencies, or gameplay behavior should change.
