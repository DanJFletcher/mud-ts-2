import type { GameSnapshot } from "@mudd/client-sdk";
import { characterHasEquippedItem, equipmentItemIdForSlot } from "@mudd/contracts";

export function readableObjectsForQuickActions(snapshot: GameSnapshot | null | undefined) {
  const bulletin = snapshot?.dailyActivities?.boards[0];
  const aliases = ["bulletin", "bulletin board", "daily bulletin", "daily bulletin board", "notice", "notice board"];
  return (snapshot?.location?.objects ?? []).filter((object) => {
    if (!object.readable) return false;
    if (!bulletin) return true;
    const label = object.label.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    const boardName = bulletin.name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    return label !== boardName && !aliases.includes(label);
  });
}
export function selectItemActions(snapshot: GameSnapshot | null) {
  const inventory = snapshot?.character?.inventory ?? [];
  const equipment = snapshot?.character?.equipment;
  const objects = snapshot?.location?.objects ?? [];
  return {
    droppable: inventory.filter((item) => item.questBound !== true &&
      (!equipment || !characterHasEquippedItem(equipment, item.id))),
    equipable: inventory.filter((item) => item.equipment &&
      (!equipment || equipmentItemIdForSlot(equipment, item.equipment.slot) !== item.id)),
    readable: readableObjectsForQuickActions(snapshot),
    takeable: objects.filter((item) => item.takeable),
    lootable: objects.filter((corpse) => corpse.containerKind === "corpse" &&
      objects.some((item) => item.containerId === corpse.id && item.takeable)),
  };
}
export function selectUsableAxes(
  snapshot: GameSnapshot | null,
  items: NonNullable<GameSnapshot["character"]>["inventory"],
) {
  const level = snapshot?.character?.woodcutting?.level ?? 1;
  return items.filter((item) => item.woodcuttingAxe && level >= item.woodcuttingAxe.requiredLevel);
}
