import {
  type GameSnapshot
} from "@mudd/client-sdk";
import {
  EQUIPMENT_SLOTS,
  equipmentItemIdForSlot
} from "@mudd/contracts";
import {
  Panel,
  Text
} from "@mudd/ui";

import type { ReactNode } from "react";
import type { Screen } from "../features/navigation/world-navigation.js";

export interface InventoryScreenProps {
  screen: Screen;
  infoTabs: ReactNode;
  snapshot: GameSnapshot | null;
  pending: string | null;
  isAnyCombatActive: boolean;
  changeEquipment: (action: "equip" | "unequip", itemOrSlot: string) => Promise<void>;
  inspectCarriedItem: (item: NonNullable<GameSnapshot["character"]>["inventory"][number]) => Promise<void>;
  inspectedCarriedItem: { id: string; label: string; description: string; } | undefined;
  inventoryInspectError: string;
  loading: boolean;
}
export function InventoryScreen({ screen, infoTabs, snapshot, pending, isAnyCombatActive, changeEquipment, inspectCarriedItem, inspectedCarriedItem, inventoryInspectError, loading }: InventoryScreenProps) {

  return (<div className="focused-screen" aria-label={screen === "items" ? "Items" : "Equipment"}>
    {infoTabs}
    <div className="focused-screen-heading">
      <div><div className="focused-kicker">Character inventory</div><h1 className="focused-screen-title">{screen === "items" ? "Items" : "Equipment"}</h1></div>
    </div>
    {snapshot ? (
      <Panel className="focused-card">
        {screen === "equipment" ? (
          <div className="focused-details">
            <div className="focused-detail focused-detail--wide">
              <span>Equipped</span>
              <div className="focused-equipment">
                {EQUIPMENT_SLOTS.map((slot) => {
                  const itemId = snapshot.character
                    ? equipmentItemIdForSlot(snapshot.character.equipment, slot)
                    : null;
                  const item = snapshot.character?.inventory.find((candidate) => candidate.id === itemId);
                  return (
                    <div className="focused-equipment-slot" key={slot}>
                      <span>{slot}</span>
                      <strong>{item?.label ?? "None"}</strong>
                      {item && (
                        <button type="button" className="focused-inventory-item" aria-label={`Unequip ${slot}`} disabled={pending !== null || isAnyCombatActive} onClick={() => void changeEquipment("unequip", slot)}>
                          Unequip
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="focused-detail focused-detail--wide">
              <span>Available gear</span>
              {snapshot.character?.inventory.some((item) => item.equipment) ? (
                <div className="focused-inventory">
                  {snapshot.character.inventory.filter((item) => item.equipment).map((item) => {
                    const isEquipped = Boolean(snapshot.character &&
                      item.equipment && equipmentItemIdForSlot(
                        snapshot.character.equipment,
                        item.equipment.slot,
                      ) === item.id);
                    return (
                      <div className="focused-inventory-entry" key={item.id}>
                        <span className="focused-inventory-label">{item.label}</span>
                        <button
                          type="button"
                          className="focused-inventory-item"
                          aria-label={`${isEquipped ? "Equipped" : "Equip"} ${item.label}`}
                          disabled={pending !== null || isAnyCombatActive || isEquipped}
                          onClick={() => void changeEquipment("equip", item.id)}
                        >
                          {isEquipped ? "Equipped" : `Equip ${item.equipment?.slot}`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : <strong>None</strong>}
            </div>
          </div>
        ) : (
          <>
            <div className="focused-detail focused-detail--wide">
              <span>Carried items</span>
              {snapshot.character?.inventory.length ? (
                <div className="focused-inventory focused-inventory--compact">
                  {snapshot.character.inventory.map((item) => (
                    <div className="focused-inventory-entry focused-inventory-entry--compact" key={item.id}>
                      <button
                        type="button"
                        className="focused-inventory-item focused-inventory-item--compact"
                        aria-label={`Inspect ${item.label}${item.stackable && (item.quantity ?? 1) > 1 ? ` quantity ${item.quantity}` : ""}${item.usesRemaining !== undefined ? `, ${item.usesRemaining} uses remaining` : ""}`}
                        disabled={pending !== null}
                        onClick={() => void inspectCarriedItem(item)}
                      >
                        <span className="focused-inventory-name">{item.label}</span>
                        <span className="focused-inventory-meta">
                          {item.stackable && (item.quantity ?? 1) > 1
                            ? `×${item.quantity}`
                            : item.usesRemaining !== undefined
                              ? `${item.usesRemaining} uses`
                              : <span aria-hidden="true">›</span>}
                        </span>
                      </button>
                      {item.equipment && (
                        <span className="focused-item-tag focused-item-tag--compact">
                          {equipmentItemIdForSlot(snapshot.character!.equipment, item.equipment.slot) === item.id ? "Equipped" : item.equipment.slot}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : <strong>None</strong>}
              {inspectedCarriedItem && snapshot.character?.inventory.some((item) => item.id === inspectedCarriedItem.id) && (
                <p className="focused-inventory-description" aria-live="polite">
                  <strong>{inspectedCarriedItem.label}</strong>
                  {inspectedCarriedItem.description}
                </p>
              )}
              {inventoryInspectError && <p className="focused-inventory-error" role="status">{inventoryInspectError}</p>}
            </div>
            {!snapshot.character && <p className="focused-note">Begin from Play to enter the world.</p>}
          </>
        )}
      </Panel>
    ) : (
      <Panel className="focused-card"><Text variant="muted">{loading ? "Character details are loading." : "Character details are unavailable."}</Text></Panel>
    )}
  </div>);
}
