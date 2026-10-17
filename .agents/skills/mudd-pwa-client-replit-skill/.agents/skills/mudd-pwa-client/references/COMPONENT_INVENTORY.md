# Component inventory and ownership

## Classification decision

**Reference tokens**: raw palette/typography measurements; never imported as pixel values by screens.

**Semantic tokens**: intended uses (`color-surface`, `text-primary`, `focus-ring`, `border-danger`); shared theme variables.

**Primitives** (`packages/ui/src/primitives`): Button, IconButton, TextField, TextArea, Checkbox, Badge, Text, Heading, Spinner, Separator, FocusRing / VisuallyHidden. Keep them domain-neutral, accessible, and composable.

**Patterns/composites** (`packages/ui/src/patterns`): Panel, Dialog, Alert/Notice, EmptyState, Tabs, Toolbar, Menu, Toast, Sheet, LoadingRegion, StatusPill. These are generic shared UX behaviors, built from primitives.

**Game-view components** (`packages/ui/src/game`): RoomDescription, ExitList, ObjectList, CharacterStatus, Transcript, MessageItem, CommandComposer, DiceResult, TurnIndicator, ConnectionStatus, InventoryList. These are pure UI projections with callbacks and should not embed gameplay rules.

**Features/screens** (`apps/web/src/features`, `screens`): ExploreScreen, SessionScreen, CharacterScreen, ChatScreen, layout/navigation, client SDK hooks; these coordinate commands, queries, state and specific workflows. Screens compose library components.

## First playable slice: recommended build order

| Stage | Build in UI library/Storybook | Compose in PWA | Criteria |
|---|---|---|---|
| Foundation | color/spacing/type/contrast tokens, theme story, Button, Panel, TextField | bare responsive app shell | Both app and Storybook use same CSS; stories and build work |
| Exploration | RoomDescription, ExitList, ConnectionStatus | ExploreScreen with stub SDK | narrow view; exits accessible; mock states rendered |
| Interaction | CommandComposer, Notice, Transcript/MessageItem | input → typed command → event/projection update | no direct engine mutation; complete/stale/error state tests |
| Character | CharacterStatus, StatusPill | compact sidebar or drawer | rules-derived values projected, not recalculated |
| PWA readiness | EmptyState, LoadingRegion, update notice | install, offline, update UX | production smoke tests on mobile-sized viewport |
| Later | Inventory, turn/combat, dialogue, crafting widgets | user-requested next gameplay slice | don't scaffold prematurely |

## Promotion test for a component

Extract or add to UI package if it has meaningful reuse (used twice or clearly shared semantic interaction), has a stable public prop API, improves accessibility consistency, or represents a ubiquitous user interaction (Button, Dialog, TextField). Keep screen-specific orchestration and one-off layout near the screen. If promoting, remove duplicate implementation and add stories.

Avoid both extremes: building the entire screen with inline styled `<div>`s and building an 'UltimateGamePanel' with 38 boolean switches to anticipate every future game mode.

## Starting inventory artifact

Maintain `docs/design-system/component-inventory.md` with columns: Name, Level, Owner, Status (planned/in progress/stable/deprecated), Used by, Story URL/ID, Tests, Notes. Update when components are added, renamed, or removed. The skill's table above is an example, not a promise of completed code.
