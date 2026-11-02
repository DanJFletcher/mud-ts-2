# Agent Instructions

## OpenSpec research delegation

When working on an OpenSpec change (propose, explore, or update), and before writing a proposal or design, spawn the `research` subagent if the change needs any of:

- Understanding code across more than ~3 files or more than one package
- Docs for a library or API you are not certain about
- Comparing implementation options

Give it one focused question per call. Use its findings in your artifacts and don't redo the deep reading yourself.
