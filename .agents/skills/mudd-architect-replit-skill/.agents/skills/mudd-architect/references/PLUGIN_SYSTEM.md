# Plugin system contracts and lifecycle

## Goals

A plugin can contribute commands, queries, event handlers, projections, content types, capabilities, transports and scheduled jobs without modifying the kernel. It declares what it requires and provides and can be installed/disabled in a test host. Core plugins use **the same public contract** where practical.

The plugin host exposes *limited registrations and services*, not a mutable global service locator.

## Minimal manifest (design-level example)

```ts
interface PluginManifest {
  id: string;                     // stable namespace: org.mudd.movement
  version: string;                // semver
  apiVersion: string;             // supported host/plugin API range
  description?: string;
  category: 'core' | 'first-party' | 'ruleset' | 'third-party';
  requiredPlugins?: Record<string, string>;    // id -> semver range
  optionalPlugins?: Record<string, string>;
  requires?: string[];            // named capabilities
  provides?: string[];            // named capabilities
  permissions?: string[];         // requested host-granted permissions
  configurationSchemaVersion?: number;
  eventSchemaVersions?: Record<string, number>;
}
```

Runtime implementation must Zod-validate manifests and configurations. Namespace capabilities (`mudd.movement.v1`); version compatibility is explicit. Prefer declarative plugin metadata over reflection/import-time side effects.

## Lifecycle and registry

1. **Discover** configured plugin descriptors from trusted installation sources.
2. **Validate** schema, signature/trust policy if applicable, unique IDs, host API version and dependency ranges.
3. **Resolve** dependencies topologically; reject cycles, missing hard dependencies and incompatible capabilities before startup.
4. **Configure** with typed, validated options and required host-granted permissions.
5. **Register** commands/queries/events/projections, migrations and capabilities in a bounded registry.
6. **Initialize** through dependency injection; build resources but do not accept traffic yet.
7. **Start** listeners/workers after state storage and projections are ready.
8. **Run** command/event handlers under authorized world context.
9. **Stop/dispose** in reverse order; release listeners, timers and DB leases. Failed startup rolls back already-started plugins.

Use a deterministic, documented ordering model for multiple handlers. Avoid `new Function`, `eval`, dynamic arbitrary module execution or `import()` from unaudited URLs. Executing a JS plugin inside the same Node process is **not sandboxing**; permissions in the manifest don't isolate its filesystem or network access. For untrusted mods, first choose a sandbox/process boundary and resource caps in an ADR.

## Registration contracts

Prefer contributions such as:

```ts
interface PluginRegistrationApi {
  command<T>(type: string, schema: unknown, handler: CommandHandler<T>): void;
  query<T>(type: string, schema: unknown, handler: QueryHandler<T>): void;
  event(type: string, version: number, handler: EventSubscriber): void;
  provide<T>(capability: CapabilityToken<T>, implementation: T): void;
  schedule(job: ScheduledJob): void;
}
```

These are **illustrative shapes, not a mandated implementation**. Actual TS types should be generic and Zod-inferred; the example avoids forcing the entire abstraction into the initial MVP. For concrete standalone illustrative contracts, see `assets/PLUGIN_CONTRACT.example.ts`.

## Capability-oriented integration

`movement` may require a `world.graph.read` port and `characters.location.write` command capability. `combat` may require `ruleset.combat.resolve` and `rng.roll` services. The engine host injects these at runtime after checking dependency readiness. This avoids a movement plugin importing combat internals just to ask whether a character can move.

**Important:** Capability calls should be scoped to actor/world/transaction context. They must not grant unrestricted database access. Domain command handlers orchestrate consistency; cross-plugin data mutation is through explicit commands or transactionally coordinated domain services.

## Hooks, conflicts and extension points

- Keep preconditions typed, pure when possible, bounded and ordered (e.g. `beforeCommand` can veto but not silently mutate hidden state).
- Avoid open-ended synchronous event subscriber chains that recursively dispatch state changes without limits.
- Event handlers should be retry-safe and idempotent, and identify their consumer/cursor.
- Prefer a feature-specific extension point (movement policy/terrain cost) over 'everything event' hooks.
- Every extension needs contracts, versioning policy, unit tests and documentation. Do not add an interface for an unimplemented speculative plugin unless it protects an imminent seam.

## Compatibility and upgrades

- Public contract major versions signal breaking change. Minor changes remain backwards-compatible according to documented policy.
- Persist event schema type + version. Introduce upcasters/migration steps for old events; avoid in-place edits to historical facts.
- Plugins containing own database projections/migrations must maintain upgrade and rollback guidance; don't allow plugin migrations to silently drop shared tables.
- Any plugin that writes event data must supply an integration test proving replay on the previous persisted version.

## Mandatory tests

1. Plugin loads with compatible required dependencies.
2. Missing dependency, version mismatch and dependency cycle yield useful errors.
3. Registry rejects duplicate command or capability ownership unless explicitly permitted by a policy.
4. Startup failure disposes all previously initialized plugins and releases resources.
5. Enabled/disabled plugins do not alter core behavior unpredictably.
6. Unauthorized plugin action is denied; third-party 'permissions' aren't mistaken for process isolation.
7. Event subscribers are retry-safe and do not duplicate effects.
