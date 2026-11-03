import {
  MuddHttpClient,
  type GameSnapshot
} from "@mudd/client-sdk";
import {
  EQUIPMENT_SLOTS,
  equipmentItemIdForSlot
} from "@mudd/contracts";
import { entityRef, intentContext, type ActionIntent, type EntityRef } from "../commands/intents.js";
import type { useCommerceController } from "../features/commerce/use-commerce-controller.js";
import { readableObjectsForQuickActions, selectItemActions } from "../features/inventory/action-selectors.js";

import type { Dispatch, SetStateAction } from "react";
import type { QuickAction, QuickMode } from "./view-types.js";

export interface QuickCommandsProps {
  selection: {
    quickCommandMode: QuickMode;
    quickUseTargetIsTree: boolean;
    setQuickCommandMode: Dispatch<SetStateAction<QuickMode>>;
    setQuickUseItemId: Dispatch<SetStateAction<string | null>>;
    quickUseItemId: string | null;
    setQuickCommandPage: Dispatch<SetStateAction<number>>;
  };
  targets: {
    itemActions: ReturnType<typeof selectItemActions>;
    quickDirections: { id: string; target: string; label: string ;}[];
    quickLookTargets: { id: string; label: string; kind: "object" | "npc" ;}[];
    quickLootableCorpses: NonNullable<GameSnapshot["location"]>["objects"];
    quickTakeableObjects: NonNullable<GameSnapshot["location"]>["objects"];
    quickUseItems: NonNullable<GameSnapshot["character"]>["inventory"];
    challengeableNpcs: NonNullable<NonNullable<GameSnapshot["location"]>["npcs"]>;
    quickShopNpcs: NonNullable<NonNullable<GameSnapshot["location"]>["npcs"]>;
    activeMerchantCatalog: ReturnType<typeof useCommerceController>["activeMerchantCatalog"];
    quickBuyListings: Awaited<ReturnType<MuddHttpClient["getMerchantCatalog"]>>["listings"];
  };
  pagination: {
    visibleQuickCommandPage: number;
    visibleQuickCommandItems: QuickAction[];
    quickCommandPages: QuickAction[][];
  };
  actions: {
    submitEntityAction: (kind: Exclude<ActionIntent["kind"], "put" | "use" | "chop" | "unequip">, id: string, label: string, targetKind: EntityRef["kind"], display?: string) => void;
    submitQuickCommand: (rawCommand: string | ActionIntent) => void;
    performFishingCast: (rodItemId: string) => Promise<void>;
  };
  view: {
    quickReturnLabel: "Return to quick commands";
    pending: string | null;
    snapshot: GameSnapshot;
    isAnyCombatActive: boolean;
  };
}
export function QuickCommands({ selection, targets, pagination, actions, view }: QuickCommandsProps) {
  const { quickCommandMode, quickUseTargetIsTree, setQuickCommandMode, setQuickUseItemId, quickUseItemId, setQuickCommandPage } = selection;
  const { itemActions, quickDirections, quickLookTargets, quickLootableCorpses, quickTakeableObjects, quickUseItems, challengeableNpcs, quickShopNpcs, activeMerchantCatalog, quickBuyListings } = targets;
  const { visibleQuickCommandPage, visibleQuickCommandItems, quickCommandPages } = pagination;
  const { submitEntityAction, submitQuickCommand, performFishingCast } = actions;
  const { quickReturnLabel, pending, snapshot, isAnyCombatActive } = view;
  if (!snapshot.location) return null;
  return (<section className="focused-quick-commands" aria-label="Quick commands">
    {quickCommandMode !== "quick" && (
      <span className="focused-quick-commands__label" aria-hidden="true">
        {quickCommandMode === "choose-exit" ? "Choose destination"
          : quickCommandMode === "look" ? "Look"
            : quickCommandMode === "read" ? "Read"
              : quickCommandMode === "drop" ? "Drop"
                : quickCommandMode === "take" ? "Take"
                  : quickCommandMode === "loot" ? "Loot"
                    : quickCommandMode === "attack" ? "Attack"
                      : quickCommandMode === "equip" ? "Equip"
                        : quickCommandMode === "unequip" ? "Unequip"
                          : quickCommandMode === "shop" ? "Shop"
                            : quickCommandMode === "buy" ? "Buy"
                              : quickCommandMode === "talk" ? "Talk"
                                : quickCommandMode === "use-target" && quickUseTargetIsTree ? "Choose tree"
                                  : quickCommandMode === "use" || quickCommandMode === "use-target" ? "Use" : ""}
      </span>
    )}
    <div
      className="focused-quick-commands__actions"
      role="group"
      aria-label={
        quickCommandMode === "quick"
          ? `Quick commands, page ${visibleQuickCommandPage}`
          : quickCommandMode === "choose-exit" ? "Choose a destination"
            : quickCommandMode === "look" ? "Things to look at"
              : quickCommandMode === "read" ? "Readable objects"
                : quickCommandMode === "drop" ? "Items to drop"
                  : quickCommandMode === "loot" ? "Corpses to loot"
                    : quickCommandMode === "talk" ? "People here"
                      : quickCommandMode === "attack" ? "Available opponents"
                        : quickCommandMode === "equip" ? "Gear to equip"
                          : quickCommandMode === "unequip" ? "Equipped gear"
                            : quickCommandMode === "shop" ? "Merchants here"
                              : quickCommandMode === "buy" ? "Items to buy"
                                : quickCommandMode === "use" ? "Items to use"
                                  : quickCommandMode === "use-target"
                                    ? quickUseTargetIsTree ? "Choose a tree" : "Use target"
                                    : "Items to take"
      }
    >
      {quickCommandMode === "equip" ? (
        <>
          <button type="button" className="focused-quick-command focused-quick-command--back" onClick={() => setQuickCommandMode("quick")} aria-label={quickReturnLabel} disabled={pending !== null}>‹</button>
          {itemActions.equipable
            .map((item) => (
              <button key={item.id} type="button" className="focused-quick-command" onClick={() => submitEntityAction("equip", item.id, item.label, "inventory")} aria-label={`Equip ${item.label}`} disabled={pending !== null}>{item.label.toLocaleLowerCase()}</button>
            ))}
        </>
      ) : quickCommandMode === "unequip" ? (
        <>
          <button type="button" className="focused-quick-command focused-quick-command--back" onClick={() => setQuickCommandMode("quick")} aria-label={quickReturnLabel} disabled={pending !== null}>‹</button>
          {EQUIPMENT_SLOTS.filter((slot) =>
            equipmentItemIdForSlot(snapshot.character!.equipment, slot),
          ).map((slot) => (
            <button key={slot} type="button" className="focused-quick-command" onClick={() => submitQuickCommand({ kind: "unequip", slot, itemId: equipmentItemIdForSlot(snapshot.character!.equipment, slot)!, context: intentContext(snapshot), display: `unequip ${slot}` })} aria-label={`Unequip ${slot}`} disabled={pending !== null}>{slot}</button>
          ))}
        </>
      ) : quickCommandMode === "choose-exit" ? (
        <>
          <button
            type="button"
            className="focused-quick-command focused-quick-command--back"
            onClick={() => setQuickCommandMode("quick")}
            aria-label="Return to quick commands"
            disabled={pending !== null}
          >
            ‹
          </button>
          {quickDirections.length ? quickDirections.map((direction) => (
            <button
              key={direction.target}
              type="button"
              className="focused-quick-command"
              onClick={() => submitEntityAction("go", direction.id, direction.target, "exit")}
              aria-label={direction.label}
              disabled={pending !== null}
            >
              {direction.label}
            </button>
          )) : <span className="focused-quick-commands__empty">No open directions</span>}
        </>
      ) : quickCommandMode === "look" ? (
        <>
          <button
            type="button"
            className="focused-quick-command focused-quick-command--back"
            onClick={() => setQuickCommandMode("quick")}
            aria-label="Return to quick commands"
            disabled={pending !== null}
          >
            ‹
          </button>
          <button
            type="button"
            className="focused-quick-command"
            onClick={() => submitQuickCommand("look")}
            aria-label="Look around"
            disabled={pending !== null}
          >
            room
          </button>
          {quickLookTargets.map((target) => (
            <button
              key={target.id}
              type="button"
              className="focused-quick-command"
              onClick={() => submitEntityAction("look", target.id, target.label, target.kind, `look at ${target.label}`)}
              aria-label={`Look at ${target.label}`}
              disabled={pending !== null}
            >
              {target.label.toLocaleLowerCase()}
            </button>
          ))}
        </>
      ) : quickCommandMode === "read" ? (
        <>
          <button
            type="button"
            className="focused-quick-command focused-quick-command--back"
            onClick={() => setQuickCommandMode("quick")}
            aria-label="Return to quick commands"
            disabled={pending !== null}
          >
            ‹
          </button>
          {snapshot?.dailyActivities?.boards[0] ||
            (snapshot?.location?.objects ?? []).some((object) => object.readable) ? (
            <>
              {(snapshot.dailyActivities?.boards ?? []).map((board) => (
                <button key={board.id} type="button" className="focused-quick-command"
                  onClick={() => submitQuickCommand({ kind: "read-board", context: intentContext(snapshot),
                    target: entityRef(board.id, board.name, "board"), display: "read " + board.name })}
                  aria-label={snapshot.dailyActivities!.boards.length === 1 ? "Read bulletin" : "Read " + board.name}
                  disabled={pending !== null}>
                  {snapshot.dailyActivities!.boards.length === 1 ? "bulletin" : board.name}
                </button>
              ))}
              {readableObjectsForQuickActions(snapshot).map((object) => (
                <button
                  key={object.id}
                  type="button"
                  className="focused-quick-command"
                  onClick={() => submitEntityAction("read", object.id, object.label, "object")}
                  aria-label={`Read ${object.label}`}
                  disabled={pending !== null}
                >
                  {object.label.toLocaleLowerCase()}
                </button>
              ))}
            </>
          ) : <span className="focused-quick-commands__empty">Nothing readable here</span>}
        </>
      ) : quickCommandMode === "drop" ? (
        <>
          <button
            type="button"
            className="focused-quick-command focused-quick-command--back"
            onClick={() => setQuickCommandMode("quick")}
            aria-label="Return to quick commands"
            disabled={pending !== null}
          >
            ‹
          </button>
          {itemActions.droppable.length ? (
            itemActions.droppable.map((item) => (
              <button
                key={item.id}
                type="button"
                className="focused-quick-command"
                onClick={() => submitEntityAction("drop", item.id, item.label, "inventory")}
                aria-label={`Drop ${item.label}`}
                disabled={pending !== null}
              >
                {item.label.toLocaleLowerCase()}
              </button>
            ))
          ) : <span className="focused-quick-commands__empty">Nothing to drop</span>}
        </>
      ) : quickCommandMode === "loot" ? (
        <>
          <button
            type="button"
            className="focused-quick-command focused-quick-command--back"
            onClick={() => setQuickCommandMode("quick")}
            aria-label={quickReturnLabel}
            disabled={pending !== null}
          >
            ‹
          </button>
          {quickLootableCorpses.length ? (
            quickLootableCorpses.map((corpse) => (
              <button
                key={corpse.id}
                type="button"
                className="focused-quick-command"
                onClick={() => submitEntityAction("loot", corpse.id, corpse.label, "object")}
                aria-label={`Loot ${corpse.label}`}
                disabled={pending !== null}
              >
                {corpse.label.toLocaleLowerCase()}
              </button>
            ))
          ) : <span className="focused-quick-commands__empty">No lootable corpses here</span>}
        </>
      ) : quickCommandMode === "take" ? (
        <>
          <button
            type="button"
            className="focused-quick-command focused-quick-command--back"
            onClick={() => setQuickCommandMode("quick")}
            aria-label={quickReturnLabel}
            disabled={pending !== null}
          >
            ‹
          </button>
          {quickTakeableObjects.length ? (
            <>
              <button
                type="button"
                className="focused-quick-command"
                onClick={() => submitQuickCommand("take all")}
                aria-label="Take all available items"
                disabled={pending !== null}
              >
                all
              </button>
              {quickTakeableObjects.map((object) => (
                <button
                  key={object.id}
                  type="button"
                  className="focused-quick-command"
                  onClick={() => submitEntityAction("take", object.id, object.label, "object")}
                  aria-label={`Take ${object.label}`}
                  disabled={pending !== null}
                >
                  {object.label.toLocaleLowerCase()}
                </button>
              ))}
            </>
          ) : <span className="focused-quick-commands__empty">Nothing to take here</span>}
        </>
      ) : quickCommandMode === "use" ? (
        <>
          <button
            type="button"
            className="focused-quick-command focused-quick-command--back"
            onClick={() => setQuickCommandMode("quick")}
            aria-label={quickReturnLabel}
            disabled={pending !== null}
          >
            ‹
          </button>
          {quickUseItems.length ? (
            quickUseItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="focused-quick-command"
                onClick={() => {
                  if (item.fishingRod) {
                    void performFishingCast(item.id);
                  } else if (item.woodcuttingAxe) {
                    setQuickUseItemId(item.id);
                    setQuickCommandMode("use-target");
                  } else if (item.consumable?.effect === "heal") {
                    submitEntityAction(item.fishingRod ? "fish" : "heal", item.id, item.label, "inventory", `use ${item.label}`);
                  } else {
                    setQuickUseItemId(item.id);
                    setQuickCommandMode("use-target");
                  }
                }}
                aria-label={item.fishingRod
                  ? `Use ${item.label} to fish at ${snapshot?.availableFishingSpots?.[0]?.label ?? "this spot"}`
                  : item.woodcuttingAxe
                    ? `Choose a tree for ${item.label}`
                    : item.consumable?.effect === "heal"
                      ? `Use ${item.label}${isAnyCombatActive ? " during combat" : ""}`
                      : `Choose ${item.label} to use`}
                disabled={pending !== null}
              >
                {item.label.toLocaleLowerCase()}
              </button>
            ))
          ) : <span className="focused-quick-commands__empty">
            Nothing to use
          </span>}
        </>
      ) : quickCommandMode === "use-target" ? (
        <>
          <button
            type="button"
            className="focused-quick-command focused-quick-command--back"
            onClick={() => setQuickCommandMode("use")}
            aria-label="Return to items to use"
            disabled={pending !== null}
          >
            ‹
          </button>
          {(() => {
            const item = snapshot.character?.inventory.find((candidate) => candidate.id === quickUseItemId);
            const targets = item?.woodcuttingAxe
              ? snapshot.availableWoodcuttingTrees ?? []
              : (snapshot.location.objects ?? []).filter((object) => !object.readable && !object.takeable);
            return item && targets.length ? targets.map((target) => (
              <button
                key={target.id}
                type="button"
                className="focused-quick-command"
                onClick={() => submitQuickCommand({
                  kind: item.woodcuttingAxe ? "chop" : "use", context: intentContext(snapshot),
                  item: entityRef(item.id, item.label, "inventory"),
                  target: entityRef(target.id, target.label, item.woodcuttingAxe ? "tree" : "object"),
                  display: item.woodcuttingAxe ? `use ${item.label} ${target.label}`
                    : `use ${item.label} on ${target.label}`,
                })}
                aria-label={`Use ${item.label} on ${target.label}`}
                disabled={pending !== null}
              >
                {target.label.toLocaleLowerCase()}
              </button>
            )) : <span className="focused-quick-commands__empty">
              {item?.woodcuttingAxe
                ? "No trees here"
                : item ? "No usable targets here" : "Choose an item to use"}
            </span>;
          })()}
        </>
      ) : quickCommandMode === "attack" ? (
        <>
          <button
            type="button"
            className="focused-quick-command focused-quick-command--back"
            onClick={() => setQuickCommandMode("quick")}
            aria-label="Return to quick commands"
            disabled={pending !== null}
          >
            ‹
          </button>
          {challengeableNpcs.length ? challengeableNpcs.map((npc) => (
            <button
              key={npc.id}
              type="button"
              className="focused-quick-command"
              onClick={() => submitEntityAction("attack", npc.id, npc.name, "npc")}
              aria-label={`Attack ${npc.name}`}
              disabled={pending !== null}
            >
              {npc.name}
            </button>
          )) : <span className="focused-quick-commands__empty">No available opponents</span>}
        </>
      ) : quickCommandMode === "talk" ? (
        <>
          <button
            type="button"
            className="focused-quick-command focused-quick-command--back"
            onClick={() => setQuickCommandMode("quick")}
            aria-label={quickReturnLabel}
            disabled={pending !== null}
          >
            ‹
          </button>
          {(snapshot.location.npcs ?? []).length ? (
            (snapshot.location.npcs ?? []).map((npc) => (
              <button
                key={npc.id}
                type="button"
                className="focused-quick-command"
                onClick={() => submitEntityAction("talk", npc.id, npc.name, "npc")}
                aria-label={`Talk to ${npc.name}`}
                disabled={pending !== null}
              >
                {npc.name}
              </button>
            ))
          ) : <span className="focused-quick-commands__empty">No one to talk to here</span>}
        </>
      ) : quickCommandMode === "shop" ? (
        <>
          <button
            type="button"
            className="focused-quick-command focused-quick-command--back"
            onClick={() => setQuickCommandMode("quick")}
            aria-label={quickReturnLabel}
            disabled={pending !== null}
          >
            ‹
          </button>
          {quickShopNpcs.length ? quickShopNpcs.map((npc) => (
            <button
              key={npc.id}
              type="button"
              className="focused-quick-command"
              onClick={() => submitEntityAction("shop", npc.id, npc.name, "npc")}
              aria-label={`Shop with ${npc.name}`}
              disabled={pending !== null}
            >
              {npc.name}
            </button>
          )) : <span className="focused-quick-commands__empty">No merchants here</span>}
        </>
      ) : quickCommandMode === "buy" ? (
        <>
          <button
            type="button"
            className="focused-quick-command focused-quick-command--back"
            onClick={() => setQuickCommandMode("quick")}
            aria-label={quickReturnLabel}
            disabled={pending !== null}
          >
            ‹
          </button>
          {activeMerchantCatalog ? (
            quickBuyListings.length ? quickBuyListings.map((listing) => (
              <button
                key={listing.id}
                type="button"
                className="focused-quick-command"
                onClick={() => submitEntityAction("buy", listing.id, listing.item.label, "listing")}
                aria-label={`Buy ${listing.item.label}`}
                disabled={pending !== null}
              >
                {listing.item.label}
              </button>
            )) : <span className="focused-quick-commands__empty">Nothing left to buy</span>
          ) : (
            <>
              <span className="focused-quick-commands__empty">Open a merchant catalog first</span>
              <button
                type="button"
                className="focused-quick-command"
                onClick={() => setQuickCommandMode("shop")}
                disabled={pending !== null}
              >
                shop <span aria-hidden="true">›</span>
              </button>
            </>
          )}
        </>
      ) : quickCommandMode === "quick" ? (
        <>
          {visibleQuickCommandPage > 1 && (
            <button
              type="button"
              className="focused-quick-command focused-quick-command--back"
              onClick={() => setQuickCommandPage(visibleQuickCommandPage - 1)}
              aria-label={`Show quick actions page ${visibleQuickCommandPage - 1}`}
              disabled={pending !== null}
            >
              ‹
            </button>
          )}
          {visibleQuickCommandItems.map((action) => (
            <button
              key={action.id}
              type="button"
              className="focused-quick-command"
              onClick={action.onSelect}
              aria-label={action.ariaLabel}
              disabled={pending !== null || action.disabled}
            >
              {action.label}{action.opensMenu && <span aria-hidden="true"> ›</span>}
            </button>
          ))}
          {visibleQuickCommandPage < quickCommandPages.length && (
            <button
              type="button"
              className="focused-quick-command focused-quick-command--next"
              onClick={() => setQuickCommandPage(visibleQuickCommandPage + 1)}
              aria-label={`Show quick actions page ${visibleQuickCommandPage + 1}`}
              disabled={pending !== null}
            >
              ›
            </button>
          )}
        </>
      ) : null}
    </div>
  </section>);
}
