import { FLEE_STAMINA_COST } from "@mudd/contracts";

export const COMMAND_DEFINITIONS = {
  help: { canonical: "help", accepted: true, help: [
    "Usage: help [command]",
    "Show the command list or instructions for one command.",
  ], summary: "help [command] — List commands or show instructions for one." },
  party: { canonical: "party", accepted: true, help: [
    "Usage: party [help|info|list|create|join <id>|quests|quest start <id>|leave|close]",
    "Manage a public party of up to four players, start shared quests, and coordinate cooperative encounters.",
  ], summary: "party [help|info|list|create|join <id>|quests|quest start <id>|leave|close] — Manage your party and its quests." },
  quests: { canonical: "quests", accepted: true, help: [
    "Usage: quests | quests <number or choice>",
    "After talking to an NPC, list and select one of their dialogue choices.",
  ], summary: "quests [number or choice] — List or select a reply in the current NPC dialogue." },
  jobs: { canonical: "jobs", accepted: true, help: [
    "Usage: jobs [browse|accept <id>|deliver <id>]",
    "Browse today’s local bulletin, accept a posting, or deliver its carried supplies.",
  ], summary: "jobs [browse|accept <id>|deliver <id>] — Browse the local daily bulletin and fulfil postings." },
  gather: { canonical: "gather", accepted: true, help: [
    "Usage: gather <source-id or label>",
    "Collect a non-fish supply from a source in the current location. Use a fishing rod to fish.",
  ], summary: "gather <source> — Collect a local supply source; use a fishing rod to fish." },
  accept: { canonical: "accept", accepted: true, help: [
    "Usage: accept <request-id>",
    "Accept a pending player challenge addressed to your current character.",
  ] },
  decline: { canonical: "decline", accepted: true, help: [
    "Usage: decline <request-id>",
    "Decline a pending player challenge addressed to your current character.",
  ] },
  talk: { canonical: "talk", accepted: true, help: [
    "Usage: talk <npc> [about <topic>]",
    "Speak privately with someone here. Choose a reply or ask about a topic.",
  ], summary: "talk <npc> [about <topic>] — Speak privately with someone in the current room." },
  shop: { canonical: "shop", accepted: true, help: [
    "Usage: shop <merchant>",
    "Browse the current merchant’s character-specific stock.",
  ], summary: "shop <merchant> — Browse a merchant’s goods and your balance." },
  buy: { canonical: "buy", accepted: true, help: [
    "Usage: buy <item>",
    "Buy an item from a merchant catalog you have opened in this room.",
  ], summary: "buy <item> — Purchase an item from the open merchant catalog." },
  craft: { canonical: "craft", accepted: true, help: [
    "Usage: craft | craft <item> | craft <item> <1|2|3>",
    "Craft at a workbench. Choose 1 for one item, 2 for five, or 3 for ten. Crafting level and materials are checked by the server.",
  ], summary: "craft [item] [1|2|3] — List craftable items, choose a recipe, or craft 1, 5, or 10 at a workbench." },
  look: { canonical: "look", accepted: true, help: [
    "Usage: look | look [at] <object>",
    "Look describes the current room. Add an object to inspect it here or in your inventory.",
  ], summary: "look [at] <object> — Describe the room or inspect an object here or in your inventory." },
  go: { canonical: "go", accepted: true, help: [
    "Usage: go <direction>",
    "Travel through an available exit. Use the Go quick action to choose from current exits.",
  ], summary: "go <direction> — Travel through an available exit." },
  read: { canonical: "read", accepted: true, help: [
    "Usage: read <object> | read bulletin",
    "Read written text in this room or open its daily bulletin.",
  ], summary: "read <object> | read bulletin — Read room text or open the local daily bulletin." },
  extinguish: { canonical: "extinguish", accepted: true, help: [
    "Usage: extinguish <campfire>",
    "Put out a burning campfire in the current room.",
  ], summary: "extinguish <campfire> — Put out a burning campfire in the current room." },
  take: { canonical: "take", accepted: true, help: [
    "Usage: take <item> | take <item> <container> | take all",
    "Pick up an item in the current room or one of its containers; get is an alias.",
  ], summary: "take <item> | take <item> <container> | take all — Pick up items from the room or a container." },
  loot: { canonical: "loot", accepted: true, help: [
    "Usage: loot <corpse>",
    "Take all remaining items and currency from a corpse in this room.",
  ], summary: "loot <corpse> — Take all remaining items and currency from a corpse here." },
  get: { canonical: "take", accepted: true, help: [
    "Usage: get <item> | get <item> <container>",
    "Take an item from the room or the named container. Get is an alias of take.",
  ], summary: "get <item> | get <item> <container> — Take an item from the room or a container; alias of take." },
  put: { canonical: "put", accepted: true, help: [
    "Usage: put <item> <container>",
    "Store a carried item in a container here. Contents you store are saved for your character.",
  ], summary: "put <item> <container> — Store a carried item in a container here." },
  equip: { canonical: "equip", accepted: true, help: [
    "Usage: equip <item>",
    "Equip carried gear to its slot. Weapons change damage; armor changes defense.",
  ], summary: "equip <item> — Equip carried gear in its equipment slot." },
  unequip: { canonical: "unequip", accepted: true, help: [
    "Usage: unequip <slot>",
    "Remove the item from an equipment slot. Gear cannot be changed during combat.",
  ], summary: "unequip <slot> — Remove equipped gear from a slot." },
  use: { canonical: "use", accepted: true, help: [
    "Usage: use <item> on <target> | use <healing item> | use <fishing rod>",
    "Use an item on a room object, or restore health during or between encounters.",
  ], summary: "use <item> on <target> | use <healing item> | use <fishing rod> — Use a room item, restore health, or fish at a marked spot." },
  rest: { canonical: "rest", accepted: true, help: [
    "Usage: rest",
    "Rest for free in any room while out of combat. Standing restores each vital by 2% of its maximum every two seconds; resting restores 6%.",
  ], summary: "rest — Rest for free in any room while out of combat; recover health, stamina, and mana." },
  stand: { canonical: "stand", accepted: true, help: [
    "Usage: stand",
    "Leave the free resting posture so you can travel or begin combat.",
  ], summary: "stand — Leave the free resting posture." },
  inn: { canonical: "inn", accepted: true, help: [
    "Usage: inn rest",
    "Immediately restore missing health, stamina, and mana at this inn for its listed price.",
  ], summary: "inn rest — Immediately restore missing health, stamina, and mana for the inn’s listed price." },
  drop: { canonical: "drop", accepted: true, help: [
    "Usage: drop <item>",
    "Put down an item you carry in the current room.",
  ], summary: "drop <item> — Put down an item you carry." },
  attack: { canonical: "attack", accepted: true, help: [
    "Usage: attack <opponent> | attack",
    "Challenge a player in the same room, start a solo NPC fight, or attack during combat. Eligible online party members join NPC fights together.",
  ], summary: "attack <opponent> — Begin an encounter or attack during combat." },
  defend: { canonical: "defend", accepted: true, help: [
    "Usage: defend",
    "Guard against the opponent’s next strike during an active encounter.",
  ], summary: "defend — Guard against the opponent’s next strike." },
  flee: { canonical: "flee", accepted: true, help: [
    "Usage: flee",
    `End an active PvE encounter and return to the room. Costs ${FLEE_STAMINA_COST} stamina.`,
  ], summary: `flee — End an active PvE encounter; costs ${FLEE_STAMINA_COST} stamina.` },
  inspect: { canonical: "inspect", accepted: false, help: [
    "There is no separate inspect command.",
    "Use look at <object> to inspect something in the room or an item you carry.",
  ] },
} as const;
export type CommandTopic = keyof typeof COMMAND_DEFINITIONS;
const generalOrder = ["help","party","quests","jobs","gather","talk","shop","buy","craft","look","go","read","extinguish","get","take","loot","put","equip","unequip","use","rest","stand","inn","drop","attack","defend","flee"] as const;
export function generalCommandHelp(): readonly string[] {
  return ["Commands", ...generalOrder.map((key) => COMMAND_DEFINITIONS[key].summary), "Quick actions include available movement, item, loot, equipment, merchant, dialogue, and combat actions."];
}
export function getCommandHelp(topic: string): readonly string[] {
 const normalized = topic.trim().toLocaleLowerCase().replace(/\s+/g, " ");
 if (!normalized) return generalCommandHelp();
 const key = normalized === "look at" ? "look" : normalized;
 return Object.hasOwn(COMMAND_DEFINITIONS, key) ? COMMAND_DEFINITIONS[key as CommandTopic].help : [
   `No help is available for "${topic.trim()}".`, 'Try "help" for the command list.'];
}
export function parseCommandHeader(input: string) {
 const value = input.trim(); if (!value) return undefined;
 const [rawVerb, ...words] = value.split(/\s+/);
 const key = rawVerb.toLocaleLowerCase();
 const definition = Object.hasOwn(COMMAND_DEFINITIONS, key) ? COMMAND_DEFINITIONS[key as CommandTopic] : undefined;
 return { value, verb: definition?.accepted ? definition.canonical : key, target: words.join(" ").trim() };
}
