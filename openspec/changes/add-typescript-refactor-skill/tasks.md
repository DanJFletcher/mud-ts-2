# Tasks

## 1. Shared refactoring guidance

- [ ] 1.1 Author the canonical skill with review and edit modes. Validate its frontmatter and exercise a review in a disposable workspace. Verify it cites a concrete maintenance cost and leaves the workspace untouched.
- [ ] 1.2 Add and link a source-backed TypeScript field reference covering the decisions in design.md. Exercise cases for an exhaustive union switch and a legacy record accepted by a cast. Verify the reviewer recognizes a justified switch and identifies the compatibility change introduced by new validation.
- [ ] 1.3 Add selective delegation to AGENTS.md and the portable handoff to the skill. Walk through a clean green change and a bounded extraction. Verify the former can finish inline and the latter identifies ownership, observed evidence, invariants, and who verifies the result.

## 2. Host discovery and specialist roles

- [ ] 2.1 Register the Codex refactorer against the canonical skill. In a fresh session verify direct skill discovery, then invoke the named specialist and confirm a read-only result reaches the parent.
- [ ] 2.2 Expose the skill to Claude Code and register the Claude refactorer with skill preloading. Verify direct skill use resolves the shared examples, and independently observe the named specialist return a review to its parent.
- [ ] 2.3 Register the Copilot CLI refactorer and verify the CLI discovers the shared skill. Exercise named delegation and confirm the child loads repository rules and returns findings. Identify the Copilot surface tested in contributor guidance.
- [ ] 2.4 Document direct skill use and a copyable Replit task handoff. Verify discovery in Replit Agent and exercise a separate task against the same green revision. Check that the task returns its findings or edit and reports a baseline mismatch before editing if given a different revision.

## 3. End-to-end verification

- [ ] 3.1 In an isolated example, observe a public test fail for missing behavior and pass after a minimal fix. Exercise a delegated refactor of overlapping rejection checks. Verify pre-edit coverage, preserved error precedence, bounded diff, post-edit checks and parent verification. Distinguish the parent's red observation from the specialist's green runs.
- [ ] 3.2 Record host, version or date, invocation, and observed results for skill use, named delegation and fallback task execution separately. Mark unavailable live checks unverified with reproduction steps and leave affected verification tasks open. Check that every compatibility claim is backed by the recorded evidence.
