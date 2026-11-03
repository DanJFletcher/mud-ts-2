import { useCallback } from "react";
import { equipmentItemIdForSlot } from "@mudd/contracts";
import type { GameSnapshot } from "@mudd/client-sdk";
import type { useInventoryController } from "../features/inventory/use-inventory-controller.js";
import type { useDialogueController } from "../features/dialogue/use-dialogue-controller.js";
import type { useCommerceController } from "../features/commerce/use-commerce-controller.js";
import type { useFishingController } from "../features/gathering/use-fishing-controller.js";
import type { useWoodcuttingController } from "../features/gathering/use-woodcutting-controller.js";
import { type ActionIntent, entityAvailable, sameIntentContext } from "./intents.js";
type Inventory = ReturnType<typeof useInventoryController>;
type Options = {
  snapshot: GameSnapshot | null;
  pending: boolean;
  listingIds: readonly string[];
  inventory: Inventory;
  talk: ReturnType<typeof useDialogueController>["talkToNpc"];
  shop: ReturnType<typeof useCommerceController>["browseMerchant"];
  buy: ReturnType<typeof useCommerceController>["purchaseMerchantListing"];
  fish: ReturnType<typeof useFishingController>["performFishingCast"];
  chop: ReturnType<typeof useWoodcuttingController>["performWoodcuttingStart"];
  move(id: string): Promise<void>;
  attack(id: string): Promise<void>;
  heal(id: string): Promise<void>;
  openDailyBoard(id: string): Promise<unknown>;
  addEntry(kind: "error" | "system", text: string): string;
};
/** Selected IDs are checked against the current view and never re-resolved by label. */
export function useActionDispatch(options: Options) {
  return useCallback(async (intent: ActionIntent) => {
    const { snapshot, pending, listingIds, inventory, addEntry } = options;
    if (pending) return;
    const refs = "item" in intent ? [intent.item, intent.target] : "target" in intent ? [intent.target] : [];
    if (!sameIntentContext(intent.context, snapshot) ||
        refs.some((ref) => !entityAvailable(ref, snapshot, listingIds)) ||
        (intent.kind === "unequip" && (!snapshot?.character || equipmentItemIdForSlot(snapshot.character.equipment, intent.slot) !== intent.itemId))) {
      addEntry("error", "That selection is no longer available. Choose it again.");
      return;
    }
    const object = intent.kind === "read"
      ? snapshot?.location?.objects.find((item) => item.id === intent.target.id) : undefined;
    if (intent.kind === "read" && (!object?.readable ||
      ("readAction" in intent.target && JSON.stringify(intent.target.readAction) !== JSON.stringify(object.readAction ?? null)) ||
      (object.readAction?.type === "daily-board" &&
        !snapshot?.dailyActivities?.boards.some((board) => board.id === object.readAction?.boardId)))) {
      addEntry("error", "That selection is no longer available. Choose it again.");
      return;
    }
    if (intent.display) addEntry("system", `> ${intent.display}`);
    switch (intent.kind) {
      case "look": return inventory.inspect(intent.target.kind === "room" ? undefined : intent.target.label, intent.target);
      case "take": return inventory.takeObject(intent.target.id, intent.target.label);
      case "drop": return inventory.dropObject(intent.target.id, intent.target.label);
      case "read":
        if (object?.readAction?.type === "daily-board") {
          await options.openDailyBoard(object.readAction.boardId);
          return;
        }
        return inventory.readObject(intent.target.id);
      case "read-board":
        await options.openDailyBoard(intent.target.id);
        return;
      case "equip": return inventory.changeEquipment("equip", intent.target.id);
      case "unequip": return inventory.changeEquipment("unequip", intent.slot);
      case "loot": return inventory.lootCorpse(intent.target.id, intent.target.label);
      case "extinguish": return inventory.extinguishCampfire(intent.target.id);
      case "put": return inventory.putObject(intent.item.id, intent.item.label, intent.target.id, intent.target.label);
      case "use": return inventory.performItemUse(intent.item.id, intent.target.id);
      case "talk": return options.talk(intent.target.id);
      case "shop": return options.shop(intent.target.id);
      case "buy": return options.buy(intent.target.id);
      case "go": return options.move(intent.target.id);
      case "fish": return options.fish(intent.target.id);
      case "chop": return options.chop(intent.item.id, intent.target.id);
      case "attack": return options.attack(intent.target.id);
      case "heal": return options.heal(intent.target.id);
    }
  }, [options]);
}
