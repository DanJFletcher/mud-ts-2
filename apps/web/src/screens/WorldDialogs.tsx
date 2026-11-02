import {
  CraftingQuantityDialog,
  InteractionOptionsDialog,
  NpcDialogueDialog,
  type ActivityLogTarget
} from "@mudd/ui";
import type { Dispatch, SetStateAction } from "react";
import { type EntityRef, type IntentContext } from "../commands/intents.js";
import type { useCommerceController } from "../features/commerce/use-commerce-controller.js";
import type { useDialogueController } from "../features/dialogue/use-dialogue-controller.js";
import { getNpcFarewellLabel } from "../npc-farewell.js";

export interface WorldDialogsProps {
  interaction: {
    activeInteractionTarget: (ActivityLogTarget & { context?: IntentContext; entityKind?: EntityRef["kind"] ;}) | null;
    performTerminalTargetAction: (target: ActivityLogTarget & { context?: IntentContext; entityKind?: EntityRef["kind"]; }, actionId: string) => void;
    setActiveInteractionTarget: Dispatch<SetStateAction<(ActivityLogTarget & { context?: IntentContext; entityKind?: EntityRef["kind"] ;}) | null>>;
  };
  crafting: {
    activeCraftingPrompt: ReturnType<typeof useCommerceController>["activeCraftingPrompt"];
    selectCraftingQuantity: (quantity: 1 | 5 | 10) => Promise<void>;
    closeCrafting: () => void;
  };
  dialogue: {
    dialogueModalOpen: boolean;
    activeDialogue: ReturnType<typeof useDialogueController>["activeDialogue"];
    chooseDialogueReply: (choiceId: string, announceChoice?: boolean) => Promise<void>;
    closeNpcDialogue: () => Promise<void>;
  };
  view: {
    pending: string | null;
  };
}
export function WorldDialogs({ interaction, crafting, dialogue, view }: WorldDialogsProps) {
  const { activeInteractionTarget, performTerminalTargetAction, setActiveInteractionTarget } = interaction;
  const { activeCraftingPrompt, selectCraftingQuantity, closeCrafting } = crafting;
  const { dialogueModalOpen, activeDialogue, chooseDialogueReply, closeNpcDialogue } = dialogue;
  const { pending } = view;
  return (<>
    {activeInteractionTarget && (
      <InteractionOptionsDialog
        targetLabel={activeInteractionTarget.label}
        title={activeInteractionTarget.actionDialogTitle}
        options={activeInteractionTarget.actions ?? [{ id: "look", label: "Look" }]}
        busy={pending !== null}
        onSelect={(actionId) => performTerminalTargetAction(activeInteractionTarget, actionId)}
        onClose={() => setActiveInteractionTarget(null)}
      />
    )}
    {activeCraftingPrompt && (
      <CraftingQuantityDialog
        itemLabel={activeCraftingPrompt.outputLabel}
        choices={([1, 5, 10] as const).map((quantity) => ({
          quantity,
          disabled: quantity > activeCraftingPrompt.maxCraftable,
        }))}
        busy={pending !== null}
        onSelect={(quantity) => void selectCraftingQuantity(quantity)}
        onClose={closeCrafting}
      />
    )}
    {dialogueModalOpen && activeDialogue ? (
      <NpcDialogueDialog
        npcName={activeDialogue.npcName}
        dialogue={activeDialogue.text}
        choices={activeDialogue.choices}
        farewellLabel={getNpcFarewellLabel(activeDialogue.npcId)}
        busy={pending === "talk"}
        onSelect={(choiceId) => void chooseDialogueReply(choiceId)}
        onClose={() => void closeNpcDialogue()}
      />
    ) : null}
  </>);
}
