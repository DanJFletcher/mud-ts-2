# Maintainable React component architecture

## Favor explicit contracts

Props must be typed and minimal: `variant`, `size`, `isLoading`, `disabled`, `children`, conventional DOM props/callbacks. Prefer native HTML attributes and composition (`<Panel><PanelHeader/><PanelBody/></Panel>`) to a single giant config object. Define a small, finite variant map rather than ad hoc conditions scattered through JSX. Make `ref` forwarding consistent with the project's React version. Preserve input behavior; do not hide native button type semantics or accessible labels.

### Ownership checklist

- UI primitives: own visuals, native semantics, focus and local interaction only; no domain SDK, routing, fetch, global store, cookies, or hidden game state.
- Game UI widgets: receive plain typed view models (`RoomView`, `ExitView`, `MessageView`, `ConnectionView`), state and callbacks. They may format values, but must not roll dice, decide success, determine legal movement, or secretly issue network commands.
- Feature controllers: use SDK and subscriptions, map protocol types to UI view models, handle pending/errors, and pass props to game widgets.
- App/screens: route composition, layout and application-specific state. A screen may be unique; not everything should be published in `@mudd/ui`.

Do not let a `Button` component import `useNavigate`, `useGameSession`, `fetch`, `useWebSocket`, or ruleset types. Do not let `RoomDescription` need the event store directly. Avoid deep imports into internal `@mudd/ui/src/` paths; package export surface is public API. Document compatibility if changing exported signatures.

## State modeling

Use local React state for transient UI interactions (open drawer, current input draft, focused tab); use a query/cache/state adapter for SDK projections and connection status. A client-side store is a *read model* not the server authority. Prefer a pure reducer for transcript presentation and deduping keyed events. Loading, empty, error, stale data, denied actions, resync, and optimistic pending must be visually distinct.

Model async action states as explicit unions, e.g. `idle | submitting | acknowledged | rejected | stale | disconnected`. If command replies can arrive out of order, match them by `commandId` and avoid applying a 'success' UI effect before ack/state projection. Do not use a spinning overlay as the sole indicator of submission.

## Native elements and accessible interaction

- Use `<button>` for actions, `<a>` for navigation, `<label>` + native input for forms, and `role=log` only for appropriate log containers. Prefer semantic regions/headings before ARIA patches.
- Keyboard flows: visible focus, escape on dismissible dialogs, focus restoration, no keyboard traps, input history behavior that doesn't interfere with IME or arrow-key editing, logical tab order.
- Text and announcements: user content rendered safely, not via `dangerouslySetInnerHTML`; errors associated with form fields; avoid duplicate announcements caused by reconnect/replay.
- Responsive layout: bottom stack or single-column on mobile, optional multi-pane on wide screens, no reliance on hover for essential actions, motion behind reduced-motion preferences.
- Icons never the only indication of game status; add readable labels/text equivalents.

## Choosing third-party primitives

Radix or React Aria may be helpful for complex dialogs, menus, popovers, listboxes. Prefer standards-based accessible implementation or battle-tested library rather than recreating focus management for its own sake. Wrap selected library primitives behind a stable `@mudd/ui` API; do not couple every screen to a third-party component prop surface. Audit package footprint and CSS strategy. Do not introduce a large component framework solely because it is expedient; if importing headless primitives, document dependencies and license.

## Review and maintenance policy

- New visual patterns: check inventory and existing stories before adding code. Extend or compose an existing pattern rather than copying it.
- Refactors: preserve public API or document migration and update consumers and stories in same change.
- Keep components small enough for isolated mental models; split by semantic/behavior responsibility, not arbitrary line counts.
- Token/variant additions are changes to design system API; review with all impacted components and any public UI guideline.
- No mega `GameScreen.tsx` combining chat, map, modal, network handling, movement rules and CSS. No generic `DataCard` pretending every domain interaction is identical.
- Avoid huge barrel files and circular imports; test package's public entry exports and dependency direction.

## Component PR checklist

See `assets/COMPONENT_SPEC_TEMPLATE.md`. No component is accepted because it looks correct in one app screenshot. Demonstrate reusable props, isolated stories, accessibility, use from real feature, and boundary discipline.
