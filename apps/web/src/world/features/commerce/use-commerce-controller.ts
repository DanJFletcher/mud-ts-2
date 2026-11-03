import { findObjectMatches } from "../../commands/targets.js";
import { useCallback, useLayoutEffect, useState } from "react";
import type { MuddHttpClient } from "@mudd/client-sdk";
import { type ControllerOptions, roomContext } from "../controller-options.js";
import { useRequestScope } from "../../session/use-request-scope.js";

export function useCommerceController({
  client, snapshot, pending, beginForeground, finishForeground, reconcileCommand,
  setConnectionError, refreshGate, addEntry,
}: ControllerOptions) {
  const context = roomContext(snapshot);
  const scope = useRequestScope(context, refreshGate, client);
  const [activeMerchantCatalog, setActiveMerchantCatalog] = useState<Awaited<ReturnType<MuddHttpClient["getMerchantCatalog"]>> | null>(null);
  type Recipe = Awaited<ReturnType<MuddHttpClient["getCraftingCatalog"]>>["recipes"][number];
  const [activeCraftingPrompt, setActiveCraftingPrompt] = useState<Recipe | null>(null);
  useLayoutEffect(() => {
    setActiveMerchantCatalog(null);
    setActiveCraftingPrompt(null);
  }, [context]);
  const browseMerchant = useCallback(async (merchantNpcId: string) => {
    if (!snapshot?.character || pending) return;
    const execution = beginForeground("shop");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      const catalog = await client.getMerchantCatalog(snapshot.character.characterId, merchantNpcId);
      if (!accepts()) return;
      setActiveMerchantCatalog(catalog);
      addEntry("narration", `${catalog.merchantName} has the following goods for sale.`);
    } catch (error) {
      if (!accepts()) return;
      setActiveMerchantCatalog(null);
      addEntry("error", error instanceof Error ? error.message : "You cannot browse that merchant’s goods.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, pending, snapshot?.character, scope]);

  const purchaseMerchantListing = useCallback(async (listingId: string, recordCommand = false) => {
    if (!snapshot?.character || !snapshot.location || !activeMerchantCatalog || pending) return;
    const listing = activeMerchantCatalog.listings.find((candidate) => candidate.id === listingId);
    if (!listing) return;
    if (recordCommand) addEntry("system", `> buy ${listing.item.label.toLocaleLowerCase()}`);
    const execution = beginForeground("buy");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      const response = await client.purchaseMerchantListing(
        snapshot.character.characterId,
        activeMerchantCatalog.merchantNpcId,
        listing.id,
        snapshot.location.revision,
      );
      if (!accepts()) return;
      const [, nextCatalog] = await Promise.all([
        reconcileCommand(snapshot, response, undefined, accepts),
        client.getMerchantCatalog(snapshot.character.characterId, activeMerchantCatalog.merchantNpcId),
      ]);
      if (!accepts()) return;
      setActiveMerchantCatalog(nextCatalog);
      setConnectionError("");
      addEntry(
        "narration",
        `You buy the ${listing.item.label.toLocaleLowerCase()} for ${listing.price} ${nextCatalog.currency.name}${listing.price === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "The purchase could not be completed.");
    } finally {
      finishForeground(execution);
    }
  }, [activeMerchantCatalog, addEntry, beginForeground, client, finishForeground, pending, reconcileCommand, setConnectionError, snapshot, scope]);

  const performCrafting = useCallback(async (
    recipeId: string,
    outputLabel: string,
    quantity: 1 | 5 | 10,
    recordCommand = false,
  ) => {
    if (!snapshot?.character || pending) return false;
    if (recordCommand) {
      const choice = ([1, 5, 10] as const).indexOf(quantity) + 1;
      addEntry("system", `> craft ${outputLabel.toLocaleLowerCase()} ${choice}`);
    }
    const execution = beginForeground("craft");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      const response = await client.craft(
        snapshot.character.characterId,
        snapshot.character.revision,
        recipeId,
        quantity,
      );
      if (!accepts()) return;
      addEntry("narration", `You craft ${quantity} × ${outputLabel.toLocaleLowerCase()}.`);
      try {
        await reconcileCommand(snapshot, response, undefined, accepts);
      if (!accepts()) return;
      } catch {
        if (!accepts()) return;
        setConnectionError("Crafting succeeded, but the character view could not refresh.");
      }
      return true;
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "Crafting could not be completed.");
      return false;
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, pending, reconcileCommand, setConnectionError, snapshot, scope]);

  const craftingCommand = useCallback(async (rawTarget: string) => {
    if (!snapshot?.character) {
      addEntry("error", "Choose a character before crafting.");
      return;
    }
    const targetParts = rawTarget.trim().split(/\s+/).filter(Boolean);
    const lastPart = targetParts.at(-1);
    const selection = lastPart && /^\d+$/.test(lastPart) ? Number(lastPart) : undefined;
    if (selection !== undefined && (selection < 1 || selection > 3)) {
      addEntry("error", "Choose option 1, 2, or 3. These make 1, 5, or 10 items.");
      return;
    }
    const itemTarget = selection === undefined ? rawTarget.trim() : targetParts.slice(0, -1).join(" ");
    if (selection !== undefined && !itemTarget) {
      addEntry("error", "Name an item to craft before choosing a quantity.");
      return;
    }

    const accepts = scope.begin();
    if (!accepts) return;
    try {
      const catalog = await client.getCraftingCatalog(snapshot.character.characterId);
      if (!accepts()) return;
      if (!itemTarget) {
        if (catalog.recipes.length === 0) {
          addEntry("narration", "Nothing is craftable with your current materials and Crafting level.");
          return;
        }
        addEntry("narration", "You can craft:");
        catalog.recipes.forEach((recipe) => {
          addEntry("narration", `${recipe.outputLabel} — Crafting level ${recipe.requiredLevel}, ${recipe.experience} XP each`);
        });
        if (!catalog.atWorkbench) addEntry("narration", "Travel to a workbench to craft one of these items.");
        return;
      }
      if (!catalog.atWorkbench) {
        addEntry("error", "You need to be at a workbench to craft.");
        return;
      }
      const matches = findObjectMatches(itemTarget, catalog.recipes.map((recipe) => ({
        ...recipe, id: recipe.recipeId, label: recipe.outputLabel,
      })));
      if (matches.length === 0) {
        addEntry("error", `You cannot craft “${itemTarget}” with your current materials and Crafting level.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("narration", "Choose an item to craft:");
        matches.forEach((recipe) => addEntry("narration", recipe.outputLabel));
        return;
      }
      const recipe = matches[0]!;
      if (selection !== undefined) {
        const quantity = ([1, 5, 10] as const)[selection - 1]!;
        if (recipe.maxCraftable < quantity) {
          addEntry("error", `You have enough materials to craft at most ${recipe.maxCraftable}.`);
          return;
        }
        await performCrafting(recipe.recipeId, recipe.outputLabel, quantity);
      if (!accepts()) return;
        return;
      }

      addEntry("narration", "How many?");
      addEntry("narration", `1) ${recipe.outputLabel} x1`);
      addEntry("narration", `2) ${recipe.outputLabel} x5`);
      addEntry("narration", `3) ${recipe.outputLabel} x10`);
      setActiveCraftingPrompt(recipe);
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "Unable to read the available crafting recipes.");
    }
  }, [addEntry, client, performCrafting, snapshot?.character, scope]);

  const selectCraftingQuantity = useCallback(async (quantity: 1 | 5 | 10) => {
    if (!activeCraftingPrompt) return;
    const crafted = await performCrafting(
      activeCraftingPrompt.recipeId,
      activeCraftingPrompt.outputLabel,
      quantity,
      true,
    );
    if (crafted) setActiveCraftingPrompt(null);
  }, [activeCraftingPrompt, performCrafting]);


  return {
    activeMerchantCatalog, activeCraftingPrompt, browseMerchant, purchaseMerchantListing,
    craftingCommand, selectCraftingQuantity,
    closeMerchant: useCallback(() => { scope.invalidate(); setActiveMerchantCatalog(null); }, [scope]),
    closeCrafting: useCallback(() => { scope.invalidate(); setActiveCraftingPrompt(null); }, [scope]),
  };
}
