# Generic world-object lifecycle

The object lifecycle plugin provides a persistent expiration schedule for any
world object. It does not decide what an object is, what expiration means for
that object, or what should happen to its contents. A feature plugin owns those
policies.

## Scheduling an object

Schedule an object in the same event-store append that creates it whenever
possible. The lifecycle event belongs in its own `world-object-lifecycle:<id>`
stream, written as a companion so object creation and its schedule commit
atomically:

```ts
import {
  objectLifecycleScheduledEvent,
  objectLifecycleStreamId,
} from "@mudd/core-plugins";

const createdAt = context.now();
const expiresAt = new Date(createdAt.getTime() + 10 * 60_000);

const lifecycle = objectLifecycleScheduledEvent({
  objectId: campfire.id,
  objectType: "campfire",
  locationId: campfire.locationId,
  createdAt: createdAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
});

await context.store.append({
  worldInstanceId: context.worldInstanceId,
  streamId: campfireStreamId,
  actorId: context.actorId,
  commandId: command.commandId,
  payloadHash,
  expectedVersion: campfireRevision,
  events: [campfireCreatedEvent],
  companions: [{
    streamId: objectLifecycleStreamId(campfire.id),
    expectedVersion: 0,
    events: [lifecycle],
  }],
});
```

The PostgreSQL event store updates its indexed due-work projection in the same
transaction. The projection is only a scheduler index; lifecycle event streams
remain authoritative. A batched worker claims due records with expiring leases,
then dispatches the trusted `world.object.expire` system command. The worker
polls every ten seconds, so expiry is not expected to happen at an exact
millisecond.

Lifecycle timestamps are UTC real-world timestamps, not accelerated world
time. The schedule survives server restarts and works even when no player is
connected or present in the object's room.

## Defining expiration behavior

The generic plugin emits `world.object_expiring` after the scheduled time.
Plugins register an event handler for object types they own, inspect
`payload.objectType` and `payload.objectId`, and apply that type's rules. The
temporary campfire plugin is the first complete non-corpse example:

- `campfire.light` appends a `world.campfire_lit` event and its lifecycle
  schedule as one atomic write.
- The plugin handles `world.object_expiring` only for `objectType: "campfire"`.
- It appends `world.campfire_extinguished` and `world.object_expired` together,
  removing the campfire and completing its lifecycle in one transaction.
- The expiry event and room announcement use the existing durable effect path.
  Failed writes are retried; stale expiration events are ignored.
- Room queries merge live campfires into the standard object list. They read
  the current lifecycle projection, so a reschedule moves the visible deadline,
  an expired/due campfire is hidden before the worker poll, and a cancelled
  schedule leaves the fire visible as a non-expiring object.

The generic lifecycle event stream remains authoritative for the deadline.
Feature-owned campfire events describe only whether the fire was lit or
extinguished; no corpse state or corpse-specific query logic is involved.

Do not schedule an object type until a plugin defines how it is finalized.
The generic lifecycle plugin deliberately does not delete arbitrary objects or
their contents.

Lifecycle events are version 1:

| Event | Purpose |
| --- | --- |
| `world.object_lifecycle_scheduled` | Starts a schedule with object type, location, creation time, and expiration time. |
| `world.object_lifecycle_rescheduled` | Changes the expiration time of a scheduled object. |
| `world.object_lifecycle_cancelled` | Cancels a schedule before expiration. |
| `world.object_expiring` | Signals that the expiration time has arrived; the owning plugin performs its policy. |
| `world.object_expired` | Records that the owning plugin completed expiration. |

Reschedule and cancel events are appended to the object's lifecycle stream with
the current expected revision. A reschedule makes the lifecycle scheduled
again; cancellation is terminal. The database projection and due-work index
follow those events atomically.

## Corpse behavior

`corpseLifecyclePlugin` consumes `world.object_expiring` for `objectType:
"corpse"`. Its settings are authored on each world through
`corpseLifecycle`:

- Ordinary NPC corpses: 300 seconds.
- Boss corpses: 900 seconds.
- Player corpses: 1,800 seconds.
- Corpses with no remaining contents: at most 60 seconds, without extending
  their original expiration deadline.
- NPC expiry policies: `destroy` or `drop`.
- Player expiry policy: `recovery-storage`, preserving unclaimed contents.
- NPC definitions may override category, lifetime, and NPC policy.
- Decay-stage descriptions are derived from creation and expiration timestamps;
  no periodic corpse updates are written.

Expiration policy and item transfers are committed together with corpse
removal and lifecycle completion. `destroy` removes contained loot, `drop`
moves it into the room, and `recovery-storage` returns unclaimed player-corpse
contents and currency to the owner. Items already claimed by another character
remain with that character.

## Client visibility and notifications

Room and object queries filter corpses whose expiration timestamp has elapsed,
even if the next worker poll has not run yet. Temporary campfires follow the
same user-facing contract through the generic object projection: they are
hidden once their scheduled deadline has elapsed, and the owning plugin's
durable room announcement reports when they burn out. No corpse-specific
client protocol or filtering is needed for campfires.

## Adding another expiring object type

For another temporary object:

1. Append its creation event and a `world.object_lifecycle_scheduled` companion
   event atomically.
2. Register a plugin handler for `world.object_expiring` and filter for
   `objectType === "campfire"`.
3. In the handler, remove or transform the campfire according to that feature's
   rules and append `world.object_expired` using the lifecycle stream's current
   expected revision.
4. Make any transfer of contained objects part of the same atomic append.
5. Add tests for normal expiry, handler retry, rescheduling/cancellation, and
   concurrent interactions with that object.

The object lifecycle and scheduler do not import or depend on corpse code.
