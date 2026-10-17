# MUDD PWA Client — Replit Agent Skill

A companion to `mudd-architect`: this skill enforces a reusable **design system → Storybook components → mobile-first React PWA screens** workflow for MUDD. It is a design-system engineering skill, not a prebuilt game app.

## Install

Copy the bundled `.agents/skills/mudd-pwa-client/` folder to the root of the **same Replit project** containing your MUDD code. Keep the previous `.agents/skills/mudd-architect/` skill installed; this ZIP adds a separate skill and does not replace it. On systems that hide dotfolders, enable hidden files when extracting.

```text
your-mudd-replit-project/
  .agents/
    skills/
      mudd-architect/        # companion skill from earlier package
      mudd-pwa-client/       # this skill
        SKILL.md
        references/
        assets/
```

Replit Agent loads installed skills by description when the task is relevant; you can explicitly name `mudd-pwa-client` in prompts. Replit skill documentation: https://docs.replit.com/replitai/skills

## Recommended first prompt

> Use both `mudd-pwa-client` and `mudd-architect`. Audit my current MUDD repo and establish the frontend foundation **before building any full gameplay screens**. Identify existing UI, tokens, Storybook config and client SDK. Create or reuse a `@mudd/ui` workspace package with semantic Tailwind v4 tokens, light/dark themes, Storybook React Vite, and a small set of accessible primitives (Button, Panel, TextField), each with meaningful stories and tests. Make the app and Storybook share the same CSS/theme and prove the package can be consumed by the app. Then deliver **one** mobile-first Explore screen with a RoomDescription, ExitList and ConnectionStatus connected through an explicit typed SDK stub or existing real SDK. Do not implement client-side engine rules. Run builds/tests, document what's deferred, and propose the next vertical slice.

## Suggested second prompt

> Now use `mudd-pwa-client` to implement a CommandComposer and Transcript in Storybook first, including error/loading/disconnected states, IME-safe input handling, scroll retention, accessible new-event announcements, and long-history fixtures. Compose them into the PWA only after the components pass relevant tests. Wire commands and projected events through the existing SDK and verify the full movement/chat journey.

## Files included

- `SKILL.md` — main rules, workflow, boundaries and required deliverables.
- `references/COMPONENT_INVENTORY.md` — what belongs in library vs app, phased component backlog.
- `references/TOKENS_AND_THEMES.md` — Tailwind CSS v4 semantic token strategy and theme parity.
- `references/COMPONENT_ARCHITECTURE.md` — React component contracts, state, accessibility and maintenance.
- `references/STORYBOOK_TESTING.md` — Storybook React Vite, accessibility, interaction and E2E strategy.
- `references/MUDD_CLIENT_BOUNDARIES.md` — typed SDK, events, projections, transcript, offline/authority separation.
- `references/PWA_AND_RESPONSIVENESS.md` — install/offline/update and mobile layout concerns.
- `references/DELIVERY_PLAYBOOK.md` — phased quality gates and anti-patterns.
- `assets/` — reference token CSS, example Button and story, component/feature templates, QA checklist and smoke test prompts.

**Illustrative files in `assets/` are examples only.** Do not blindly copy them without adapting package paths, brand tokens and installed dependency versions. No licensing-restricted D&D rulebook or adventure text is included.

## Why the two skills coexist

`mudd-architect` protects server-authoritative game rules, plugins, contracts and replay semantics; `mudd-pwa-client` protects visual coherence, component contracts, Storybook tests, mobile ergonomics, and user-facing UX. Both require end-to-end proof that a player action is a typed intent resolved by the authoritative engine, not a fabricated React state change.
