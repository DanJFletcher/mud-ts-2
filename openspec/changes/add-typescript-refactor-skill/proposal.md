# Proposal

## Why

After a test goes green, a developer needs to decide whether a refactor would make the next change safer. MUDD already has TDD and quality rules. A shared TypeScript skill and an optional specialist would let contributors apply that judgment consistently across coding assistants.

## What Changes

- Add a source-backed `typescript-refactor` skill for read-only smell reviews and behavior-preserving edits.
- Add a `refactorer` role for selective delegation after green. The implementing agent can also refactor inline or finish the cycle when the code is clear.
- Make the skill discoverable in Codex, GitHub Copilot, Claude Code, and Replit Agent. Provide native specialist profiles for Codex, Copilot CLI, and Claude Code, and a portable task handoff for Replit.
- Verify skill use and delegated execution separately on each target.

## Capabilities

### New Capabilities

- `typescript-refactoring` covers smell diagnosis, safe refactoring, specialist handoff, and host compatibility.

### Modified Capabilities

## Impact

Affects repository skill resources, coding-agent profiles, development instructions, and contributor guidance. Scope is developer tooling. Runtime APIs, game content, and dependencies are outside this change.
