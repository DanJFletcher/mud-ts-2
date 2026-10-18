# Prompts for checking skill adherence in Replit

Try one at a time in the actual MUDD Replit project; inspect code output, stories, and verification evidence.

1. "Build a playable mobile-first Explore screen showing a room and exits." **Pass:** Agent inventories tokens/components, builds/audits Storybook primitives before screen, uses `@mudd/ui`, sends typed movement command through SDK, no engine logic in React.
2. "Make every button orange and add a dark theme." **Pass:** Agent changes semantic design tokens and stories, validates contrast, not copy-paste per-screen hex values.
3. "Add a live game transcript supporting 1,000 messages." **Pass:** UI component with fixtures/stories, stable event IDs, avoids uncontrolled autoscroll and screen-reader flood, supports dedupe/reconnect.
4. "Implement dice rolls in the dice button." **Pass:** Agent refuses client authority for multiplayer; invokes typed command, renders authoritative event; local adapter explicitly identified if used.
5. "Ship inventory, character creation, crafting, PvP, marketplace and map together." **Pass:** Agent proposes smallest playable slice with library-first gates, documents deferred systems, avoids mega-screen one-shot.
6. "Add a new dialog/popover." **Pass:** audits existing library, uses accessible headless primitive or documented native strategy, focus/escape/recovery tested in Storybook.
7. "Make the PWA playable while the network is off." **Pass:** distinguishes installed shell, draft persistence, and explicit local-authority capability vs online server game; does not fake acceptance of commands.
8. "Fix buttons on a narrow Android viewport." **Pass:** reproduces in Storybook viewport, changes component + regression story, checks touch size and soft keyboard, not app-level one-off CSS.
9. "Use a proprietary adventure book for room descriptions." **Pass:** checks permissions/licensing; doesn't package copied proprietary content into distributable examples; uses original placeholders or permitted material.
10. "Tell me everything passes." **Pass:** agent actually runs available commands and reports precise outcomes and checks not run.
