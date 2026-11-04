# TypeScript refactor skill compatibility checks

This record separates observed repository configuration from live host behavior. A profile file or discoverable path is not proof that an assistant loaded a skill or invoked a specialist.

## Repository-level artifacts

- Canonical skill: `.agents/skills/typescript-refactor/SKILL.md`
- Shared examples: `.agents/skills/typescript-refactor/references/typescript-field-guide.md`
- Codex named agent: `.codex/agents/refactorer.toml`
- Claude skill bridge and named agent: `.claude/skills/typescript-refactor/SKILL.md`, `.claude/agents/refactorer.md`
- Copilot skill bridge and named agent: `.github/skills/typescript-refactor/SKILL.md`, `.github/agents/refactorer.agent.md`
- Replit uses the canonical `.agents/skills` location and the portable task handoff in the skill.

## Host checks

Run live checks in the named host. Record the exact host/version, date, invocation, and observed result. Do not infer runtime support from file presence.

| Host and surface | Invocation / check | Observed result | Status |
| --- | --- | --- | --- |
| Codex skill discovery | On 2026-11-04, `command -v codex` returned unavailable; no fresh Codex session could be started to load `typescript-refactor`. | CLI version and live discovery result unavailable. | Unverified |
| Codex named delegation | On 2026-11-04, not invoked because `command -v codex` returned unavailable. | No child response; CLI version unavailable. | Unverified |
| Claude Code skill discovery | On 2026-11-04, `command -v claude` returned unavailable; no fresh Claude Code session could invoke the skill or resolve its shared field guide. | CLI version and live discovery result unavailable. | Unverified |
| Claude Code named delegation | On 2026-11-04, not invoked because `command -v claude` returned unavailable. | No child response; CLI version unavailable. | Unverified |
| GitHub Copilot CLI skill discovery | On 2026-11-04, `gh copilot --version` was unavailable; no Copilot CLI session could request the skill or read the canonical guide. The target surface is Copilot CLI, not GitHub.com chat. | CLI version and live discovery result unavailable. | Unverified |
| GitHub Copilot CLI named delegation | On 2026-11-04, not invoked because `gh copilot --version` was unavailable. | No child response; CLI version unavailable. | Unverified |
| Replit Agent discovery | On 2026-11-04, a fresh session was not available to ask it to discover `typescript-refactor`. | Canonical file presence is confirmed, but no direct-discovery result or runtime version was available. | Unverified |
| Replit separate-task fallback | On 2026-11-04, no separate task was launched with the portable handoff; the same-revision and mismatch prompts were not run. | No task result; Replit Agent version unavailable. | Unverified |

## Replit Agent in-workspace exercises

Date: 2026-11-04. The Replit Agent runtime version was not exposed. Local TypeScript checks used Node.js `v24.22.1`. These exercises use the in-workspace general subagent callback, not the registered Codex, Claude, or Copilot profiles and not a separate Replit task.

| Exercise | Invocation | Observed result |
| --- | --- | --- |
| Review skill and field guide | General subagent with the canonical skill and examples supplied as relevant skills/files; instructed to review only. | It identified the duplicated account checks' drift risk, kept the exhaustive `RenderJob` switch, and flagged stricter validation as a compatibility change for a legacy record omitting `displayName`. It reported no files changed. |
| Selective delegation walkthrough | Follow-up to the read-only subagent, asking it to assess an already-green cleanup and a bounded extraction. | It confirmed the simple green cleanup can finish inline and listed mode, baseline, observed evidence, owned scope, invariants, verification, and parent review as handoff requirements. No files changed. |
| Bounded edit | General subagent in edit mode, scoped to `examples/authorization.ts`, with the parent's passing command, expected count, source hash, and rejection-order invariants. | It extracted the shared account decision, reported the focused test and TypeScript check passing, and changed only the authorized example file. The parent independently inspected the diff and reran both checks; they passed. This validates generic in-workspace delegation only, not named-profile discovery. |

Host tool availability was checked in this workspace with `command -v codex`, `command -v claude`, and `gh copilot --version`; each reported unavailable. No version was therefore available for those targets, and no named profile invocation was attempted.

The portable Replit task handoff is documented in the canonical skill, but no separate task was started. Its same-revision and mismatched-revision behavior remains unverified; follow the reproduction steps above when a separate-task runner is available.

### Reproduction steps for unavailable host checks

1. Use a clean disposable workspace containing these skill and agent files.
2. Record the host and version/date.
3. Run each direct-discovery and named-delegation check separately; save the exact prompt/invocation and response.
4. For the Replit task fallback, first use a green baseline, then repeat with a different revision. Confirm the second task stops before editing.
5. Inspect the workspace after read-only checks and review the parent-integrated diff after edit checks.
6. Update only the corresponding row with observed evidence. Leave unsupported or unavailable paths unverified.

## In-repository scenario walkthroughs

These are manual checks of the written guidance, not live host compatibility claims:

- **Independent rules:** two similar conditions with separate policy owners should remain separate unless callers actually enforce the same decision. The review process asks for ownership and affected callers, so duplication alone does not produce an edit.
- **Shared permission decision:** when multiple handlers enforce one permission rule, the guide asks for all callers, the shared owner, and existing rejection behavior.
- **Exhaustive union:** the field guide keeps variant behavior explicit and requires checking each discriminant; it does not replace an exhaustive switch with a generic map by default.
- **Legacy record cast:** the field guide treats runtime validation as a potential accepted-input change and requires a separately scoped behavior change.
- **Delegation:** a bounded handoff includes mode, tested revision and pending changes, actual green command/result, owned scope, invariants, verification, and parent responsibility. Baseline mismatch requires stopping before edits.

## Isolated TDD/refactor exercise

The disposable example is under `.agents/skills/typescript-refactor/examples/`.

- **Parent red:** `node --import tsx --test .agents/skills/typescript-refactor/examples/authorization.test.ts` — 6 passed, 2 failed. Both manual and scheduled transfer tests exposed the missing blocked-destination rejection (`allowed` instead of `destination-blocked`).
- **Parent minimal fix / green:** added the destination rejection to both paths. The same command passed 8/8.
- **Parent behavior-preserving baseline before delegation:** the same test command passed 8/8; strict TypeScript check below passed; `authorization.ts` SHA-256 was `b04a96705b73f5f624fb985cc4230f26a6b2bcc4e30e961e85155f680a3a4c8a`.
- **Delegate:** an in-workspace general subagent, not a registered host refactorer profile, verified the stated test result and source hash before editing. It changed only `authorization.ts` and extracted the shared account-eligibility decision.
- **Parent integrated verification:** inspected the diff and reran both commands; each passed.

```sh
node --import tsx --test .agents/skills/typescript-refactor/examples/authorization.test.ts
node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --types node .agents/skills/typescript-refactor/examples/authorization.ts .agents/skills/typescript-refactor/examples/authorization.test.ts
```

The tests preserve and verify decision precedence: account disabled, transfer permission, destination blocked, then allowed. The test and strict typecheck passed after the delegated edit. No repository application code was changed by this exercise.

Do not mark the corresponding OpenSpec verification task complete until these observations are recorded. The review/edit profiles alone do not prove the workflow works end to end.
