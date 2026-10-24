---
name: Timed gameplay actions
description: Event-sourced design for player actions that progress over time and include random outcomes.
---

Persist an active timed action and its server timestamp/progress in the character stream. Derive due intervals from server time, resolve their random outcomes on the server, and record each interval's result plus the terminal outcome in events. Clients may schedule progress commands and resume from the character projection, but must not own clocks or gameplay rolls.

**Why:** Browser timers pause, drift, and disappear on disconnect. Persisted progress allows deterministic replay, idempotent retries, reconnect recovery, and authoritative outcomes without holding an HTTP request open for the whole action.

**How to apply:** Use this pattern for fishing and future timed actions. Keep the duration and interval rules in world/character data, validate commands against the current character state, and make interruption an explicit recorded outcome.
