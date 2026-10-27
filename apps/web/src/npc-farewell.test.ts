import { describe, expect, it } from "vitest";
import { getNpcFarewellLabel } from "./npc-farewell.js";

describe("getNpcFarewellLabel", () => {
  it("keeps an NPC's farewell stable while allowing different NPCs to use different wording", () => {
    const orinFarewell = getNpcFarewellLabel("orin-vale");

    expect(getNpcFarewellLabel("orin-vale")).toBe(orinFarewell);
    expect(orinFarewell).toBe("I should get going");
    expect(getNpcFarewellLabel("mara-waykeeper")).not.toBe(orinFarewell);
  });
});
