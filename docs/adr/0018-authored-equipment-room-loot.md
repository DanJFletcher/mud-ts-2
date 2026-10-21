# ADR 0018: Authored equipment room loot

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

The demo world can author takeable room items, while the character inventory
contract already supports equipment. The takeable definition schema does not
yet expose equipment, so authored dungeon loot cannot use the existing equip
command.

The existing world-item ownership decision keeps authored takeables
character-instanced. Making loot globally unique would require a separate shared
item aggregate and transaction boundary, which is outside this feature.

## Decision

- Add optional `equipment` metadata to authored takeable definitions, reusing
  the existing inventory schema and validation rules.
- When a character takes an authored equipment item, copy its metadata into the
  existing `character.item_taken` event payload. Character replay remains the
  authority for inventory and equipment state.
- Keep authored takeables character-instanced: each character may take their own
  copy, and no shared world-item state is introduced.
- Preserve `questBound` semantics for puzzle-critical items; ordinary treasure
  and the final sword remain droppable under the existing rules.
- Keep equipment values as authored data. The engine does not introduce a new
  item system or change combat calculations.

## Consequences and trade-offs

- Existing content remains valid because the new field is optional.
- No database migration or event rewrite is required; the item-taken event
  already contains the shared inventory-item projection shape.
- Old events continue to replay with the metadata they recorded. New item events
  preserve equipment metadata for later equip commands.
- Two characters can each take an authored item. These items are not globally
  scarce; globally unique loot remains deferred until shared-item ownership is
  deliberately implemented.

## Verification

- Contract tests accept valid authored equipment and reject invalid
  weapon/armor combinations.
- Public client tests take and equip a dungeon sword, verify the projection
  retains its weapon bonus, and exercise the ordered puzzle interactions.
