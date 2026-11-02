import { describe, expect, it } from "vitest";
import { COMMAND_DEFINITIONS, generalCommandHelp, getCommandHelp, parseCommandHeader } from "./metadata.js";
describe("command metadata and headers", () => {
  it.each(Object.entries(COMMAND_DEFINITIONS))("keeps %s help and dispatch metadata together", (verb, definition) => {
    expect(getCommandHelp(verb)).toBe(definition.help);
    expect(parseCommandHeader(verb)?.verb).toBe(definition.canonical);
    if (definition.accepted) expect(definition.help[0]).toMatch(/^Usage:/);
  });
  it("normalizes aliases while preserving entered command text and multiword targets", () => {
    expect(parseCommandHeader(" GET   Loose stone  ")).toEqual({
      value: "GET   Loose stone", verb: "take", target: "Loose stone",
    });
    expect(getCommandHelp(" GET ")).toContain("Usage: get <item> | get <item> <container>");
    expect(getCommandHelp("look   at")).toBe(getCommandHelp("look"));
  });
  it("derives general help from the command definitions and keeps unsupported topics explicit", () => {
    expect(getCommandHelp("")).toEqual(generalCommandHelp());
    for (const line of generalCommandHelp().slice(1, -1)) {
      const verb = line.split(/[ <]/)[0]!;
      expect(Object.hasOwn(COMMAND_DEFINITIONS, verb)).toBe(true);
      expect(parseCommandHeader(verb)).toBeDefined();
    }
    expect(getCommandHelp("inspect")).toContain("There is no separate inspect command.");
    expect(parseCommandHeader(" ")).toBeUndefined();
    expect(getCommandHelp("missing")[0]).toBe('No help is available for "missing".');
  });
});
