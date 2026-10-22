---
name: World-pack authoring types
description: Distinguishes authored Zod input shapes from normalized runtime world-pack types.
---

When schema defaults make authored fields optional, content should be typed with the schema's input type and parsed into the normalized runtime type. Keep runtime consumers on the parsed output shape.

**Why:** Zod defaults permit concise authored data but make defaulted fields required in inferred output types; typing authoring literals as output rejects valid omitted defaults.

**How to apply:** For world packs and similar authored content, expose a `z.input` authoring type, validate with the schema at load time, and use the `z.infer` type after parsing.
