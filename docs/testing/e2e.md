# Browser end-to-end testing

The browser suite uses Playwright against the production-built web client and
the real Express game server. Each `npm run test:e2e` run creates a fresh,
localhost-only PostgreSQL 16 container, applies the repository migrations, and
removes that exact container when the run finishes. It does not use or modify a
developer's configured database.

## Setup and run

Install the browser once:

```sh
npm run test:e2e:install
```

Then run the suite:

```sh
npm run test:e2e
```

Docker must be running and the `postgres:16` image available (the runner pulls
it if needed). The script builds the workspaces, migrates its temporary
database, starts the API and production preview on `127.0.0.1`, runs Playwright,
and cleans up the API, preview, and database container. Playwright traces and
screenshots are retained for failures in `test-results/`.

To run Playwright directly against already-running local services, first build
with `MUDD_E2E_AUTH=1`, configure a dedicated disposable database and session
secret, and run the server with `NODE_ENV=test MUDD_E2E_AUTH=1` bound to
localhost. Then run `npm run test:e2e:playwright`. Do not point E2E tests at a
shared, staging, or production database.

## Test-only auth adapter

The E2E web build aliases Clerk's React provider and theme modules to a small
anonymous test adapter. It models an unauthenticated visitor so tests exercise
the real guest-session and game APIs, rather than inventing authenticated
identities or mocking gameplay requests. The server skips Clerk middleware
only when `MUDD_E2E_AUTH=1` and `NODE_ENV=test`; it otherwise uses the normal
Clerk auth path. In that mode the API also binds to loopback. The runner removes
Clerk keys from child environments and does not embed credentials in the
browser bundle.

The adapter is not a production or general development login mechanism. Never
enable it on a network-accessible server.

## Coverage boundaries

The initial browser journey exercises guest character creation, entering the
demo world, selecting and reading a room item, NPC dialogue, keyboard movement
after dismissing a dialog, and leaving/re-entering through Menu → Characters.
A second guest journey obtains a fishing rod through NPC dialogue, travels to
the river, starts a cast, and cancels it through the gameplay controls.

The mobile history check uses a 390×844 viewport and verifies 200 mounted rows,
no horizontal overflow, no live-region replay when navigating history, and a
new-activity announcement when new content arrives. Browser assertions also
check focus restoration after closing dialogs. These checks do not certify
what a screen reader announces; VoiceOver/NVDA checks remain a separate manual
QA step. Unit and integration suites continue to cover server rules, controller
lifecycles, long-history windows, and identity edge cases.
