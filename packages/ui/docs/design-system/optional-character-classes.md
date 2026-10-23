# Optional character classes

## Component inventory

- `ClassChoice` is an explicit native radio group for world-provided class definitions. It is used in account and guest creation; its caller controls selection and persists only the chosen class ID.
- `ClassAbilityList` displays authoritative action projections. It shows the supplied resource cost and availability reason, and emits an action ID without calculating game rules.
- Account roster entries show the projected class label when present. Existing classless worlds keep name-only creation.
- The character Stats sheet shows an adopted class and its starting action, or offers one-time legacy adoption when the current world has a class catalog and the character is outside combat.

## Boundary

The app discovers catalogs through `MuddHttpClient.getWorlds()`. Class creation, adoption, and combat are commands through the client SDK. Do not derive ability costs, damage, or eligibility in the UI. Ability enablement comes only from `availableClassActions`; a server rejection remains authoritative.

Combat controls appear separately in solo, cooperative, and PvP encounter regions. No action is added to terminal command handling. Class adoption requires a selected choice and a second explicit confirmation, and is hidden during active combat.

## States and accessibility

`ClassChoice` is unselected by default, supports disabled, loading, error, and empty states, and uses native radios for keyboard and screen-reader behavior. Its descriptions and attribute details wrap at narrow widths. `ClassAbilityList` supports loading, error, empty, unavailable, pending, and disabled states; actions meet the 44px touch target and unavailable actions expose the server reason.

The matching stories cover selected/unselected, long copy on narrow viewports, disabled and busy states, and server-unavailable actions. Focus styling uses the shared warm focus token.
