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
`payload.objectType` and `payload.objectId`, and apply that type's rules. For
example, a campfire plugin can remove its campfire from its own projection and
append `world.object_expired` to the lifecycle stream. That final append should
be idempotent and use the lifecycle stream's current expected version. If the
handler fails, the durable event-effect system retries it.

For a campfire, the handler follows this pattern:

```ts
registerEventHandler(
  "world.object_expiring",
  1,
  ObjectExpiringEventSchema.shape.payload,
  async (payload, context) => {
    if (payload.objectType !== "campfire") return;

    const lifecycleStream = objectLifecycleStreamId(payload.objectId);
    const history = await context.store.readStream(context.worldInstanceId, lifecycleStream);
    const lifecycle = projectObjectLifecycle(history);
    if (!lifecycle || lifecycle.state !== "expiring") return;

    const expired = objectLifecycleExpiredEvent({
      objectId: lifecycle.objectId,
      objectType: lifecycle.objectType,
      locationId: lifecycle.locationId,
      expiredAt: context.now().toISOString(),
    });
    const result = await context.store.append({
      worldInstanceId: context.worldInstanceId,
      streamId: lifecycleStream,
      actorId: SYSTEM_ACTOR_ID,
      commandId: `campfire-expire:${context.effectId}`,
      payloadHash: `${payload.objectId}:${payload.expiresAt}`,
      expectedVersion: lifecycle.revision,
      events: [expired],
      companions: [{
        streamId: campfireStreamId(payload.objectId),
        expectedVersion: campfireRevision,
        events: [campfireExtinguishedEvent(payload.objectId)],
      }],
    });
    if (!result.receipt.ok) throw new Error("Could not expire the campfire.");
  },
);
```

The companion write removes the campfire and marks its lifecycle complete in
one transaction; it is illustrative API usage, so the campfire event names and
revision lookup belong to the campfire plugin.

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
even if the next worker poll has not run yet. The plugin emits room announcements
through the existing durable room-message path. No corpse-specific client
protocol is needed.

## Adding another expiring object type

For a temporary object such as a campfire:

1. Append its creation event and a `world.object_lifecycle_scheduled` companion
   event atomically.
2. Register a plugin handler for `world.object_expiring` and filter for
   `objectType === "campfire"`.
3. In the handler, remove or transform the campfire according to that feature's
   rules and append `world.object_expired` using the lifecycle stream's current
   expected revision.
4. Make any transfer of contained objects part of the same atomic append.
5. Add tests for normal expiry, handler retry, rescheduling/cancellation, and
   concurrent interactions with the campfire.

The object lifecycle and scheduler do not import or depend on corpse code.
