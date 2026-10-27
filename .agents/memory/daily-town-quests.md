---
name: Daily town quests
description: User requirements for resident bulletin-board jobs and per-character daily availability.
---

Towns can have bulletin boards where residents post small quests, such as requests for deer hide, freshly caught fish, or a bundle of firewood. Quests refresh daily and completing them awards gold and experience points. Each character can complete every daily job once.

**Why:** The user requested daily town quests and explicitly chose independent per-character completion rather than one globally claimable job.

**How to apply:** Do not let another character's completion exhaust a posting for everyone, or replace character completion limits with account-wide limits. Specific reset times and expiration policies are not user-confirmed requirements.

For implementation-policy decisions, consult [the daily-jobs ADR](../../docs/adr/0032-daily-town-jobs.md).
The initial reset and collection policies are deliberate defaults, not additional user requirements.

Stackable quest supplies count units, not inventory slots. Fully consumed stacks are recorded by item ID and replay must read their pre-event quantity; partial stacks carry an explicit consumed-unit count.

**Why:** A Pine Logs posting failed at delivery when a three-log stack was counted as one supply during event replay.

**How to apply:** When changing daily supply consumption or replay, test both fully consumed and partially consumed stacks and preserve exact remaining quantities.
