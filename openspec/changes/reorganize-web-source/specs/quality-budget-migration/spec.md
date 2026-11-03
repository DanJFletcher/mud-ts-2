# Spec Delta

## Purpose

Preserves existing suppression budgets across verified source-module relocations while preventing new allowances and retaining enforcement for changed code.

## ADDED Requirements

### Requirement: Import-only relocations preserve existing budget identity
The quality gate SHALL permit existing suppression counts to follow a verified one-to-one file rename when changes are limited to relative static module specifiers and all dependencies retain their identity across the compared revisions. Unchanged source outside those specifiers MUST be proven.

#### Scenario: Import depth changes during a module relocation
- **GIVEN** a tracked module is uniquely renamed and its relative static imports change only to reach the same dependencies
- **WHEN** the existing suppression counts move to its new path
- **THEN** budget migration passes without creating an allowance

#### Scenario: Imported dependency also moves
- **GIVEN** an importer and its dependency each have a unique tracked rename
- **WHEN** the import path changes to the dependency's corresponding destination
- **THEN** the existing importer budget can follow its relocation

### Requirement: Unproven relocations fail closed
The gate SHALL reject edited-rename budget migration when dependency identity is unresolved, ambiguous or substituted, when the original is copied rather than renamed, or when any text outside supported static module specifiers changes. Unchanged specifier text MUST NOT be assumed to identify an unchanged dependency after a move.

#### Scenario: Unchanged text resolves to another module
- **GIVEN** an importer moves and an unchanged relative specifier resolves to a different tracked module
- **WHEN** its old suppression counts are transferred
- **THEN** budget migration fails

#### Scenario: Source behavior or declarations change during the rename
- **WHEN** a renamed file changes function bodies, declarations, comments, formatting or unsupported dynamic module loading alongside import paths
- **THEN** it does not qualify for import-only budget migration

#### Scenario: Dependency cannot be established uniquely
- **WHEN** module resolution or rename correspondence has multiple candidates or no supported candidate
- **THEN** edited-rename budget migration fails closed

#### Scenario: Unsupported loader is present beside static imports
- **GIVEN** a renamed file contains dynamic imports, require calls or import globs whose dependency identity is not supported by the relocation proof
- **WHEN** its static import paths change, even if the unsupported loader text stays unchanged
- **THEN** edited-rename budget migration fails closed

### Requirement: Migration does not weaken quality enforcement
Budget migration SHALL permit unchanged or decreased counts only. New rule allowances, count increases and duplicate transfers MUST fail. Changed-function numeric selection and typed/smell occurrence checks SHALL operate independently of budget migration without altered diff evidence or regenerated site identities.

#### Scenario: Counts increase at the destination
- **WHEN** a verified relocation increases any rule count or adds a new rule allowance
- **THEN** the budget comparison fails

#### Scenario: Import edit shares a line with a function
- **WHEN** an eligible module-specifier edit changes a line that also contains a production function
- **THEN** existing changed-function selection still checks that function against the numeric limits

#### Scenario: Legacy occurrence context changes
- **WHEN** a typed or smell finding has changed owning context or a new ledger identity
- **THEN** budget migration does not grant that occurrence a legacy allowance
