# Tokens, theming, and visual language

## Stable token strategy

Three layers: reference foundation (raw palette values and type measurements) → semantic aliases (meaningful usage) → component-level decisions (variant state/size mapping). For MUDD, use appearance that favors long-form reading and accessible action hierarchy. Avoid conflating lore/horror/fantasy visuals with the core UI library; themes can customize style without altering semantics.

Typical semantic tokens:

- Background/surface: `--ds-background`, `--ds-surface`, `--ds-surface-raised`, `--ds-surface-inset`.
- Text: `--ds-text`, `--ds-text-muted`, `--ds-text-inverse`.
- Borders/focus: `--ds-border`, `--ds-border-strong`, `--ds-focus-ring`.
- Actions: `--ds-action`, `--ds-action-hover`, `--ds-action-text`, `--ds-danger`, `--ds-warning`, `--ds-success`.
- Game content: `--ds-chat-player`, `--ds-chat-system`, `--ds-chat-error`, `--ds-room-heading`; these should meet text contrast against their own surface.
- Dimensions: `--ds-radius-sm/md/lg`, shadow/elevation semantics, typography/font family and line heights, spacing scale, z-index categories. Touch target minimum preferred 44 CSS px for primary controls.

Avoid the following: `bg-[#121212]` repeated in app; component-local color hex; tokens named `--dark-vampire-red-600` as the only public theme contract; calculating hover styles separately in each screen; arbitrary pixel values everywhere; shipping theme changes without testing text contrast.

## Tailwind CSS v4: CSS-first pattern

Recommended package layout:

- `packages/ui/src/styles/tokens.css`: semantic variables + Tailwind `@theme inline` aliases. This file should be reusable, not import the app.
- `packages/ui/src/styles/base.css`: minimal base typography, accessibility defaults and font fallback, **no resets that unexpectedly override browser controls**.
- `apps/web/src/styles.css`: `@import "tailwindcss";` and then the shared style files, with monorepo `@source` when appropriate.
- `packages/ui/.storybook/preview.ts`: import the **same assembled stylesheet** or dedicated library entry with equivalent Tailwind compilation. Do not maintain an unrelated Storybook palette.

See `assets/tokens.example.css` for an illustrative token set (not a final brand decision). CSS custom properties enable runtime light/dark themes. Tailwind `@theme inline` exports utility class aliases mapping to those semantic properties, without hardcoding theme-specific values into every component.

### Important build details

- New setup: use `tailwindcss` and `@tailwindcss/vite` with Vite. Ensure Storybook's Vite builder also processes the same CSS; if a standalone UI workspace needs `viteFinal` plugin registration, add only once.
- `@import "tailwindcss";` once per independently bundled CSS entry; don't accidentally layer Tailwind Preflight multiple times in the same app.
- Because workspaces often hide source outside the app's scan path, use `@source` paths relative to CSS to include `packages/ui` when needed. Do not construct Tailwind utility strings dynamically (`bg-${intent}`) because static scanning cannot see them. Use class maps with literal values.
- Prefer design tokens in semantic vars and `@theme inline` over outdated Tailwind v3-only JS config examples. Preserve an existing valid Tailwind prefix; do not impose `sui` prefix without repo/user requirements.
- Keep the **same** visual styles/themes in Storybook and app (including fonts, layer/background and `color-scheme`). Verify dark + light and OS dark preference behavior.
- Use consistent reading measure for prose, ample line-height for narrative text, tabular numbers for stats, intentional monospace for command snippets. Keep color contrast checks in each theme.

## Documentation

Add docs for typography specimens, palette/surface/feedback semantics, radius/shadows/spacing, and available component variants. Storybook can host token docs pages/stories; `docs/design-system` should record rationale and migration notes. Token changes require impacted story review, ideally screenshot diff, and a11y contrast checks; don't treat CSS token edits as harmless.

## Sources to check at implementation time

- Tailwind v4 theme variables: https://tailwindcss.com/docs/theme
- Tailwind Vite installation: https://tailwindcss.com/docs/installation/using-vite
- Tailwind source scanning in monorepos: https://tailwindcss.com/docs/detecting-classes-in-source-files
- Storybook global CSS: https://storybook.js.org/docs/configure/styling-and-css
