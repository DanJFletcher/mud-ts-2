# Location Groups

Location groups attach reusable, descriptive labels to existing locations. They
can overlap and do not add exits, change movement rules, create map boundaries,
or own room content.

## Authoring a world pack

Edit `src/map/location-groups.json` in the world pack. The file has
`formatVersion: 1`, the pack's `packId`, and a `locationGroups` array. Keep its
existing array order and append new groups. See [map layout authoring](world-content/map-layout.md)
for the split between JSON layout and TypeScript content.

The composed `WorldPackDraft` still accepts an optional `locationGroups` array;
packs that omit it behave as if it were empty.

For example, an entry in the file's `locationGroups` array is:

```json
{
  "id": "clearwater",
  "name": "Clearwater",
  "type": "settlement",
  "description": "A small riverside settlement.",
  "memberships": [
    { "locationId": "glasswater-bridge", "isPrimary": true },
    { "locationId": "reedbank-stalls", "isPrimary": true }
  ],
  "metadata": { "settlementKind": "riverside" }
}
```

Group `type` is an extensible string, and `metadata` is JSON data. Room IDs must
exist in the same world pack. A room can belong to any number of groups, but at
most one of those memberships can be primary. Group IDs and membership IDs must
be unique.

`resolveLocationDisplayName(shortName, memberships, separator)` formats the
primary group and short room name. The default separator is `": "`. It returns
structured `shortName`, `qualifiedName`, and primary group ID values; clients
should not parse the display string to recover group membership.

## Persistence and trusted authoring

The server seeds authored group definitions into PostgreSQL once for each
`packId` and `packVersion`. After seeding, PostgreSQL is the authoritative catalog
for that pack version. Creating, updating, deleting, and changing memberships
requires the trusted `mudd.location-groups.catalog.v1` plugin capability and an
expected catalog revision. Stale revisions fail rather than overwrite another
author's changes.

The capability supports:

- `read()`
- `createGroup(group, expectedRevision)`
- `updateGroup(groupId, patch, expectedRevision)`
- `deleteGroup(groupId, expectedRevision)`
- `addLocationToGroup(groupId, locationId, isPrimary, expectedRevision)`
- `removeLocationFromGroup(groupId, locationId, expectedRevision)`
- `setPrimaryGroup(locationId, groupIdOrNull, expectedRevision)`
- `groupsForLocation(locationId)`
- `locationsInGroup(groupId)`
- `qualifiedLocationName(locationId, separator?)`

Room definitions remain owned by the versioned world pack. The database does
not duplicate rooms or use a restrictive foreign key to a room table. Removing
a group cascades only its membership rows. If pack content changes, bump
`packVersion`; this creates a new initial catalog without replacing edits to an
older version.

There is intentionally no player HTTP write endpoint. The application does not
yet have a world-authoring identity or permission model.

## Client projections

`GET /api/game` returns group-aware current-location and map projections.
`MuddHttpClient.getLocationGroups(characterId)` runs the typed
`location.groups.list` query for the active character.

Room projections include short and qualified names plus structured memberships.
Map projections retain short names, expose qualified names and group IDs for
visible locations, and include group descriptions, metadata, visible member IDs,
and primary member IDs. Undiscovered rooms are filtered from both the group
projection and its membership lists.

The mobile and desktop map renderer does not infer or render group boundaries.
