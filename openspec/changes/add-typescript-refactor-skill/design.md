# Design

## Context

The repository keeps project skills under `.agents/skills/`, and already has Claude and Copilot discovery directories. The existing research role shows how to register a named agent on three hosts. Its read-only permissions fit research. A specialist authorized to edit and run tests needs different permissions. See proposal.md for motivation.

## Goals / Non-Goals

Keep refactoring judgment in one versioned source. Keep discovery, invocation and reporting understandable to a contributor moving between hosts. Product code cleanup, new lint gates, and automatic orchestration on every green test are outside scope.

## Decisions

1. **Keep one guide and one short field reference.** Place the canonical skill under `.agents/skills/typescript-refactor/`. Route review and edit requests explicitly. Use the reference for worked TypeScript examples, including extraction with error ordering, moving a shared decision, a meaningful parameter object, replacing a flag, discriminated unions versus Strategy, and type assertions at trust boundaries. For each show when the change helps, when to leave the code alone, and what to verify. Ground examples in [the hands-on exercises](https://github.com/publiosilva/code-smells-ts-hands-on), [smells](https://refactoring.guru/refactoring/smells), [patterns](https://refactoring.guru/design-patterns), [Fowler's catalog](https://refactoring.com/catalog/) and [TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html). Reference repository policy for limits and commands so it can evolve independently.
2. **Keep registration thin.** Use the canonical discovery directory for Codex, Copilot CLI and Replit. Expose a Claude project skill entry that loads the canonical guide and resolves its references from the repository root. Follow the research role's naming conventions for `.codex/agents/refactorer.toml`, `.claude/agents/refactorer.md`, and `.github/agents/refactorer.agent.md`. Have each load the skill and repository instructions explicitly or via verified preloading. Duplicating full prompts across profiles makes behavior depend on which copy was last edited.
3. **Delegate by scope.** Add a short selection rule to the repository TDD guidance. Put the portable handoff in the skill. Include mode, owned files or responsibility, observed test outcome and command, invariants, and expected report. A delegate working in a separate task must be able to see the tested revision including any pending changes. If it cannot reproduce green, it reports the discrepancy before editing. The parent reviews the integrated result. This retains an independent read when valuable without imposing a serial handoff for routine cleanup.
4. **Validate each host surface separately.** Use Codex, Copilot CLI, Claude Code and Replit Agent as the acceptance targets. Exercise the same small scenario in a disposable workspace. Record observed discovery, skill behavior, named delegation and Replit task execution separately, with host/version or date and any unavailable access. Profile syntax alone cannot establish that a host selected the specialist. [Codex subagents](https://developers.openai.com/codex/subagents/) · [Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) · [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) · [Replit skills](https://docs.replit.com/features/agent/skills) · [Replit tasks](https://docs.replit.com/references/agent/task-board)

## Risks / Trade-offs

- A refactor can pass the newest test while breaking older callers. Establish passing characterization coverage wherever the intended edit reaches beyond the green test.
- A specialist may attribute the parent's red run to itself. Label inherited observations and newly run checks in the handoff and final report.
- Host capabilities differ. Replit's documented separate-task workflow is the supported fallback. Claim named Replit delegation only after a supported mechanism and live invocation are verified.

## Migration Plan

Land the shared skill, host entries and TDD guidance together. Existing work can continue through the inline path. Rollback removes those additions as a unit.
