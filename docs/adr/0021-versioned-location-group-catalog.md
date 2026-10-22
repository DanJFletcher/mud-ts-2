# ADR 0021: Versioned location-group catalogs

- **Status:** Accepted
- **Date:** 2026-10-21
- **Owners:** MUDD engine and world-content maintainers

## Context

World rooms and exits are authored in a validated `WorldPackDraft`; PostgreSQL
currently stores gameplay events and session data, not room definitions. Location
groups add shared geographical metadata and many-to-many room memberships without
changing the movement graph or creating a second room store.

Group changes need to survive server restarts and be available to clients. They
must not become player-owned state, expose undiscovered rooms, or provide
unauthorized players a way to edit shared world content.

## Decision

- A location group and its room memberships belong to a **world-pack definition
  version**, keyed by `packId` and `packVersion`. They are not owned by a
  character, world instance, or gameplay event stream.
- `WorldPackDraft.locationGroups` contains the authored initial catalog. On first
  activation of a pack version, the server seeds that catalog into normalized
  PostgreSQL tables. The persisted catalog is authoritative afterward; restarting
  the server does not overwrite authored edits or resurrect deleted groups.
- A pack content change that should replace the initial group catalog must bump
  `packVersion`. Older catalog revisions remain scoped to their old version.
- PostgreSQL stores group records and memberships separately. Memberships have a
  composite key, and a partial unique index allows at most one primary group per
  room. Group deletion cascades only to memberships; it never deletes room
  definitions.
- Room IDs remain owned by the immutable world pack. The catalog service validates
  every membership against that pack's room IDs; a room is not duplicated in the
  database.
- A versioned, server-injected plugin capability provides catalog reads and
  revision-checked create, update, delete, and membership operations. It is
  available only to trusted server plugins. No player-facing write route is
  added until the product has an explicit world-authoring identity and
  authorization policy.
- Existing game and map responses expose structured short names, qualified
  names, group metadata, memberships, and primary membership. The default
  qualified-name separator is `": "` and formatting accepts an explicit
  separator. Map group memberships include only rooms already visible in that
  character's current map projection; group labels do not reveal undiscovered
  room IDs or coordinates.
- Group types are descriptive strings, not engine rules. Group membership does
  not create exits, movement permissions, terrain behavior, or map geometry.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Duplicate room records in PostgreSQL | Simple relational foreign keys | Creates a second authority for room IDs and content; rejected. |
| Store all memberships inside each room | Convenient room reads | Makes a normalized many-to-many catalog and group-to-room queries harder; creates redundant group references. |
| Store groups in world-instance or character event streams | Reuses gameplay event append | Couples definition edits to live play, duplicates metadata across instances, and misstates ownership; rejected. |
| Expose CRUD over player HTTP endpoints | Immediately reachable from clients | There is no world-authoring role or authorization policy; rejected as unsafe. |
| Keep groups only in the TypeScript world pack | No database work | Does not preserve trusted authoring changes across restarts; rejected. |

## Consequences and trade-offs

- **Positive:** Rooms remain independent; group membership can overlap; primary
  names are unambiguous; projections are reusable across clients; edits survive
  restart and are protected by optimistic catalog revisions.
- **Negative:** Each query reads a small persisted catalog; group changes replace
  one pack-version catalog transactionally, so concurrent edits to that catalog
  conflict and must retry.
- **Compatibility/migration:** The migration is additive. Packs without
  `locationGroups` remain valid and seed an empty catalog. Existing room IDs,
  movement, map coordinates, character sessions, and gameplay event histories do
  not change.
- **Security/abuse/trust:** Player projections are read-only and filtered to
  visible locations. Mutations are server-side capability calls; third-party
  plugin code remains trusted code, not a sandbox.
- **Performance/operational:** The demo catalog is small. Add caching only after
  measurements; a future cache must invalidate on catalog revision.
- **Rollback/reversibility:** Application code may stop consuming the new
  projections while additive tables are retained. Do not drop persisted catalog
  data during rollback.

## Verification

Validate group IDs, types, membership references, uniqueness, and primary
membership; test catalog CRUD, stale-revision conflicts, persistence across a
PostgreSQL-backed restart, visibility filtering, qualified names, and unchanged
movement/map behavior. The demo pack must show overlapping Clearwater, Glasswater
River, and King's Road memberships.

## Follow-up / revisit trigger

Add player-facing world editing only after an authenticated authoring identity,
permissions model, and audit policy are designed. Add hierarchical groups or
automatic geographic boundaries only when authored content requires them.
