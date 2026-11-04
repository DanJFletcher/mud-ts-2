# Proposal

## Why

PR-quality tests combine independent safety rules in dense scenarios with escaped source fixtures and compressed assertions. Making each guarantee explicit will improve review and failure diagnosis without changing gate behavior.

## What Changes

- Separate independent comparison, function-selection, allowance, and coverage cases into descriptively named scenarios.
- Expand compressed setup and make source fixtures readable while preserving exact line endings, whitespace, diff coordinates, measurements, and expected findings.
- Preserve all regression assertions, especially conservative selection and fail-closed behavior.
- Keep ownership independent of `organize-orraveth-content-tests` and `improve-test-readability-and-maintainability`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This behavior-preserving test refactor declares `skip_specs: true`; quality gate requirements do not change.

## Impact

Implementation owns only `scripts/quality/comparison.test.mjs` and `scripts/quality/enforcement.test.mjs`, plus this change's planning artifacts. The optional budget-rename expansion from exploration is deferred to keep scope precise. Consume shared repository helpers unchanged. No production analyzer/gate modules, policy, ledgers, manifests, runner configuration, other test suites, or other change artifacts may be modified.
