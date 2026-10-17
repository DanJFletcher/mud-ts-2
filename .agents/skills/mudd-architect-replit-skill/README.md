# MUDD Architect — Replit Agent Skill

A reusable project-scoped Agent Skill for architecting and building **MUDD**, a TypeScript-first, rules-agnostic, plugin-based multiplayer MUD engine.

## Install in your Replit project

Unzip this archive **at the root of the Replit project**, preserving hidden folders. It will create:

```text
.agents/
  skills/
    mudd-architect/
      SKILL.md
      references/
        ARCHITECTURE.md
        PLUGIN_SYSTEM.md
        STATE_AND_PROTOCOL.md
        DATA_MODEL.md
        CLIENTS_AND_REPLIT.md
        DELIVERY_AND_TESTS.md
      assets/
        ADR_TEMPLATE.md
        IMPLEMENTATION_PLAN_TEMPLATE.md
        PLUGIN_CONTRACT.example.ts
        MESSAGE_CONTRACTS.example.ts
        SMOKE_TEST_PROMPTS.md
```

Replit project skills belong at `.agents/skills/<skill-name>/SKILL.md` and are loaded when relevant. In the Replit editor, view Skills to confirm it is detected; you can also create/upload a Skill from Workspace Settings → Customization. In Agent chat, ask it to **use `/mudd-architect`** if you want to explicitly invoke the skill. Skill invocation UI may vary by workspace.

If manually copying instead of unzipping, copy the **entire** `mudd-architect` folder into `.agents/skills/`, not just `SKILL.md`, so referenced guides are available.

## Suggested first prompt

> Use the mudd-architect skill as the architecture authority for this repository. First inspect the codebase and identify which MUDD boundaries already exist. Then implement the smallest playable, mobile-first React/Tailwind v4 PWA vertical slice: one character, a few connected rooms, look/move/say, an inspectable object, event-sourced state transitions, a local browser host adapter, and persistent browser storage. Preserve the contracts for a later authoritative WebSocket/Postgres server, multiplayer and TTY clients. Work iteratively, write tests for the command/event/replay path, document significant decisions as ADRs, and report verified results.

## What is deliberately not included

- No game application code or database provisioning: this is an **agent skill**, not a generated MUDD app.
- No reproduced commercial D&D book content or Curse of Strahd adventure assets. Use original fixtures or properly licensed SRD material when authoring a distributable ruleset/game.
- No requirement to implement all future plugins before the MVP.

## References

- Replit Agent Skills: https://docs.replit.com/replitai/skills
- Replit skills customization (June 2026): https://replit.com/blog/custom-skills
- Agent Skills file format: https://agentskills.io/specification
