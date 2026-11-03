# Session operations

[session-contract.ts](./session-contract.ts) defines only the snapshot setters, command reconciliation and refresh-gate operations consumed by common controller options and gathering controllers. The [hook](./use-game-session.ts) satisfies it structurally at its existing controller call sites, checked by TypeScript. Specialized travel and social controller options retain their existing hook-derived types; this move does not rewrite their APIs.

The contract extraction changes no session lifecycle, client injection, command identity, projection selection, action epoch or travel-feedback behavior. The hook, reconciliation helpers, refresh gate and request/foreground lifecycle modules live here together. Broader controller and screen API changes remain outside this change.
