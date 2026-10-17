# Frontend feature plan — [Feature]

## Player journey
What meaningful action can player complete by end of this slice? What happens on disconnection, error, or empty state?

## Repository inventory
Existing UI primitives, Storybook, tokens, client-sdk, protocol contracts, tests. Record why reuse is or isn't possible.

## Component dependency map
| Piece | Layer | Reuse/create/extend | Stories needed | Owner |
|---|---|---|---|---|
| ... | tokens / primitive / pattern / game-view / feature screen | ... | ... | ... |

## UI vs engine boundary
SDK query/subscription data → typed UI view model → component props. Callback → feature adapter → typed command; server/event projection → UI. Never put domain validation in UI.

## Sequence and gates
1. Tokens/theme, if truly needed.
2. Stories and component code together; component test/a11y.
3. Feature screen composition with SDK stub.
4. Real SDK integration + error/reconnect states.
5. PWA/responsive test and E2E.

## Acceptance criteria
- [ ] Storybook and app use same styles/theme; stories cover real states.
- [ ] Mobile, touch and keyboard usable; no clipped content at 320 px.
- [ ] All authoritative changes pass SDK command boundary.
- [ ] Errors, pending, empty, reconnect handled.
- [ ] Typecheck, lint, tests, Storybook build and PWA production build pass, or limitations recorded.
- [ ] Docs/component inventory updated; next slice scoped.
