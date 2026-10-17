# Component Specification — [Component Name]

- **Purpose:** What user problem does this reusable component solve?
- **Classification:** primitive / pattern / game-view widget / screen-only.
- **Existing alternatives:** Reuse, extend, compose, or justify new component.
- **Package path/public export:**
- **Semantic HTML and accessibility:** native element/role, name, keyboard, focus, announcements.
- **Props:** controlled/uncontrolled, variants/sizes, disabled/loading/error, callbacks, composition slots.
- **Dependencies:** tokens, other UI components, external headless library. No network/SDK imports into library.
- **Token mapping:** semantic tokens for surfaces, text, state, focus, sizing.
- **Responsive behavior:** 320 px, 390 px, 768 px, 1280 px, long text, zoom, keyboard.
- **State stories:** baseline, secondary, disabled, loading, error/empty, long content, dark, narrow as relevant.
- **Interaction tests:** at least one significant behavior and a negative case.
- **A11y verification:** automated tool, manual keyboard, manual screen reader if performed.
- **Consumers:** which real screen(s) will use it?
- **Migration risk:** impact on existing consumers.
- **Definition of done:** storybook/app CSS parity, stories, focused test, app use, docs, build.
