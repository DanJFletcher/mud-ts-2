# TypeScript Refactoring Field Guide

Use these examples to identify when a structural change reduces a real maintenance cost. They are patterns, not rules to apply mechanically.

## Extract checks without changing error precedence

**Helps when:** multiple callers enforce the same domain rule and can otherwise drift.

**Leave it alone when:** the checks only look alike but represent independent policies, or the extraction hides which error is returned first.

**Verify:** find callers, capture public results when multiple checks fail, then run the same tests after extraction. Keep check order explicit when it is observable.

```ts
function validateTransfer(source: Account, target: Account): void {
  if (source.isFrozen) throw new FrozenAccountError();
  if (source.balance < 1) throw new InsufficientFundsError();
  if (target.isClosed) throw new ClosedAccountError();
}
```

If a helper is introduced, it must preserve which error wins for inputs that violate multiple conditions. Fowler's [Extract Function](https://refactoring.com/catalog/extractFunction.html) entry describes the structural refactoring; behavior preservation remains the caller's responsibility.

## Move a shared domain decision to its owner

**Helps when:** several command handlers independently enforce the same permission policy and can return inconsistent results.

**Leave it alone when:** callers have similar conditionals but different authority, lifecycle, or rejection behavior.

**Verify:** enumerate all callers and assert both allowed behavior and existing rejection behavior; avoid replacing distinct rules with one broad helper.

This follows the distinction between a concrete [code smell](https://refactoring.guru/refactoring/smells) and a change that merely reduces repeated text.

## Use a parameter object only for a cohesive concept

**Helps when:** several parameters travel together as one meaningful concept and callers repeatedly construct that same group.

**Leave it alone when:** the object is only a bag of unrelated values or is introduced to evade a parameter-count rule.

**Verify:** inspect call sites for clearer naming and ensure the new shape does not expand the accepted input contract unintentionally.

Fowler's [Introduce Parameter Object](https://refactoring.com/catalog/introduceParameterObject.html) is a useful catalog reference, not a mandate to wrap every argument list.

## Preserve exhaustive discriminated-union handling

**Helps when:** a value has a closed set of variants and each variant has distinct behavior.

**Leave it alone when:** replacing an exhaustive switch with a generic map would obscure side effects, error behavior, or compile-time exhaustiveness.

**Verify:** make sure each discriminant is handled and the compiler exposes a newly added variant as work to do.

```ts
type Result =
  | { kind: "success"; value: string }
  | { kind: "failure"; reason: string };

function describe(result: Result): string {
  switch (result.kind) {
    case "success":
      return result.value;
    case "failure":
      return result.reason;
  }
}
```

TypeScript's [narrowing handbook](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions) documents this pattern. Exhaustive branching is often clearer than introducing a Strategy hierarchy for a small, closed union.

## Replace a flag only when the modes have separate policies

**Helps when:** a boolean parameter selects substantially different behavior and the call site does not explain which mode is intended.

**Leave it alone when:** the flag is a simple optional behavior and named call sites remain clear. Do not create wrappers or classes solely to remove a boolean.

**Verify:** compare every call site and mode, including defaults and errors; preserve behavior for callers that omit the option.

Martin Fowler's [Flag Argument](https://martinfowler.com/bliki/FlagArgument.html) discussion can prompt review, but whether to split an API depends on its domain and callers.

## Choose a discriminated union or Strategy by variability

**Prefer a discriminated union when:** variants are closed, local, and easy to handle exhaustively.

**Consider Strategy when:** behaviors are independently composed, supplied at runtime, or have enough policy and collaborators to merit separate owners.

**Leave it alone when:** the new abstraction would only move a few straightforward branches without clarifying ownership.

**Verify:** check whether adding a new behavior should force compile-time handling in one place or allow a runtime-pluggable implementation. Consult the TypeScript narrowing guide and the [Strategy pattern](https://refactoring.guru/design-patterns/strategy) description.

## Treat casts as trust-boundary decisions

**Helps when:** data crosses an external or persistence boundary and unchecked assumptions can produce invalid domain state.

**Do not silently replace a legacy cast with validation:** validation may reject records that callers previously accepted, which is a compatibility change rather than a behavior-preserving refactor.

**Verify:** characterize legacy inputs and their current behavior first. Propose new validation as a separately scoped behavior change with explicit migration and rejection tests.

TypeScript's static type assertions do not perform runtime checks; see the handbook's [type assertions](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions) section.

## Further reading

- [TypeScript Handbook: narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [TypeScript Handbook: type assertions](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions)
- [Refactoring.Guru: code smells](https://refactoring.guru/refactoring/smells)
- [Refactoring.Guru: design patterns](https://refactoring.guru/design-patterns)
- [Martin Fowler's refactoring catalog](https://refactoring.com/catalog/)
- [TypeScript code-smell exercises](https://github.com/publiosilva/code-smells-ts-hands-on)
