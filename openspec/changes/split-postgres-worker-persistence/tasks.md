# Tasks

## 1. Durable-effect persistence

- [ ] 1.1 Extract effect claiming, command-scoped claiming, completion, retry, and dead-letter operations into an internal PostgreSQL repository; delegate the existing `PostgresEventStore` methods and verify the effect repository unit tests pass.
- [ ] 1.2 Keep the shared command-effect key format and append-time effect inserts in the current append transactions; verify PostgreSQL integration tests still cover scoped claims, restart recovery, and rollback when effect persistence fails.

## 2. Object-lifecycle persistence

- [ ] 2.1 Extract due-object claiming and claim release into an internal repository, and give `createObjectLifecycleScheduler` a narrow storage interface; verify scheduler unit tests pass without concrete-store casts.
- [ ] 2.2 Keep lifecycle materializers in append transactions and preserve lease behavior; verify PostgreSQL integration tests cover claiming, lease expiry/recovery, release, and lifecycle event persistence.

## 3. Integrated verification

- [ ] 3.1 Run the event-store unit and PostgreSQL integration tests, object-lifecycle scheduler tests, and server typecheck; confirm both append paths and the unchanged schema work with the delegated repositories.
