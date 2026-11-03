import {
  MuddHttpClient,
  type GameSnapshot
} from "@mudd/client-sdk";
import {
  characterHasEquippedItem,
  FLEE_STAMINA_COST
} from "@mudd/contracts";
import {
  ClassAbilityList
} from "@mudd/ui";

import type { InteractionInbox } from "@mudd/contracts";
import type { Dispatch, SetStateAction } from "react";

export interface CombatPanelProps {
  combat: {
    visiblePvp: InteractionInbox["encounter"] | undefined;
    isPvpTurn: boolean;
    availableClassActions: NonNullable<NonNullable<GameSnapshot["character"]>["availableClassActions"]>;
    activeTeamCombat: NonNullable<Awaited<ReturnType<MuddHttpClient["getTeamCombatInfo"]>>["encounter"]> | undefined;
    isTeamCombatTurn: boolean;
    canFlee: boolean;
    visibleCombat: NonNullable<GameSnapshot["character"]>["combat"];
  };
  inventory: {
    quickInventory: NonNullable<GameSnapshot["character"]>["inventory"];
    snapshot: GameSnapshot;
    quickUseItems: NonNullable<GameSnapshot["character"]>["inventory"];
  };
  actions: {
    performPvpAction: (action: "attack" | "defend" | "flee" | "use-item", itemId?: string) => Promise<void>;
    performClassAbility: (abilityId: string) => Promise<void>;
    performCombatAction: (action: "attack" | "defend" | "flee" | "use-item", targetNpcId?: string, recordCommand?: boolean, itemId?: string) => Promise<void>;
  };
  view: {
    pending: string | null;
    combatUseMenuOpen: boolean;
    setCombatUseMenuOpen: Dispatch<SetStateAction<boolean>>;
  };
}
export function CombatPanel({ combat, inventory, actions, view }: CombatPanelProps) {
  const { visiblePvp, isPvpTurn, availableClassActions, activeTeamCombat, isTeamCombatTurn, canFlee, visibleCombat } = combat;
  const { quickInventory, snapshot, quickUseItems } = inventory;
  const { performPvpAction, performClassAbility, performCombatAction } = actions;
  const { pending, combatUseMenuOpen, setCombatUseMenuOpen } = view;
  return (visiblePvp ? (
    <section className="focused-terminal-combat" aria-label="Player combat">
      <div className="focused-terminal-combat__status" role="status" aria-live="polite">
        <strong>Round {visiblePvp.round} · Duel</strong>
        {visiblePvp.participants.map((participant) => (
          <span key={participant.characterId}>
            {participant.name} {participant.health}/{participant.maximumHealth}
          </span>
        ))}
        <span>{visiblePvp.lastNarration}</span>
      </div>
      {visiblePvp.status === "active" ? (
        isPvpTurn ? (
          <>
            <div className="focused-terminal-combat__actions" role="group" aria-label="Player combat actions">
              <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performPvpAction("attack")} disabled={pending !== null}>attack</button>
              <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performPvpAction("defend")} disabled={pending !== null}>defend</button>
              {quickInventory.some((item) =>
                item.consumable?.effect === "heal" &&
                !characterHasEquippedItem(snapshot.character!.equipment, item.id) &&
                (visiblePvp.participants.find((participant) => participant.characterId === snapshot.character?.characterId)?.health ?? 0) < (visiblePvp.participants.find((participant) => participant.characterId === snapshot.character?.characterId)?.maximumHealth ?? 0)
              ) && (
                  <div className="focused-terminal-combat__items">
                    {quickInventory.filter((item) => item.consumable?.effect === "heal").map((item) => (
                      <button key={item.id} type="button" className="focused-quick-command focused-combat-action" onClick={() => void performPvpAction("use-item", item.id)} disabled={pending !== null}>
                        use {item.label}
                      </button>
                    ))}
                  </div>
                )}
              <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performPvpAction("flee")} disabled={pending !== null}>flee</button>
            </div>
            <ClassAbilityList actions={availableClassActions} onUse={(abilityId) => void performClassAbility(abilityId)} disabled={pending !== null} label="Duel class abilities" />
          </>
        ) : <span role="status">Waiting for the other player’s turn.</span>
      ) : <span role="status">Saving combat outcomes…</span>}
    </section>
  ) : activeTeamCombat ? (
    <section className="focused-terminal-combat" aria-label="Cooperative combat">
      <div className="focused-terminal-combat__status" role="status" aria-live="polite">
        <strong>Round {activeTeamCombat.round} · Cooperative encounter</strong>
        <span>{activeTeamCombat.participants.map((participant) =>
          `${participant.displayName} ${participant.health}/${participant.maximumHealth}`,
        ).join(" · ")}</span>
        <span>{activeTeamCombat.lastNarration}</span>
      </div>
      {isTeamCombatTurn ? (
        <>
          <div className="focused-terminal-combat__actions" role="group" aria-label="Cooperative combat actions">
            <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performCombatAction("attack", undefined, true)} disabled={pending !== null}>attack</button>
            <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performCombatAction("defend", undefined, true)} disabled={pending !== null}>defend</button>
            {quickUseItems.some((item) => item.consumable?.effect === "heal") ? (
              <button type="button" className="focused-quick-command focused-combat-action" aria-expanded={combatUseMenuOpen} onClick={() => setCombatUseMenuOpen((open) => !open)} disabled={pending !== null}>use</button>
            ) : null}
            <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performCombatAction("flee", undefined, true)} disabled={pending !== null || !canFlee} title={canFlee ? undefined : `Need ${FLEE_STAMINA_COST} stamina to flee`}>flee</button>
          </div>
          <ClassAbilityList actions={availableClassActions} onUse={(abilityId) => void performClassAbility(abilityId)} disabled={pending !== null} label="Cooperative class abilities" />
        </>
      ) : <span role="status">Waiting for your party’s turn.</span>}
      {combatUseMenuOpen && isTeamCombatTurn ? (
        <div className="focused-terminal-combat__items" role="group" aria-label="Items available during cooperative combat">
          {quickUseItems.filter((item) => item.consumable?.effect === "heal").map((item) => (
            <button key={item.id} type="button" className="focused-quick-command focused-combat-action" onClick={() => {
              setCombatUseMenuOpen(false);
              void performCombatAction("use-item", undefined, true, item.id);
            }} disabled={pending !== null}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  ) : visibleCombat?.status === "active" ? (
    <section className="focused-terminal-combat" aria-label="Combat">
      <div className="focused-terminal-combat__status" role="status" aria-live="polite">
        <strong>Round {visibleCombat.round} · {visibleCombat.opponentName}</strong>
        <span>You {visibleCombat.playerHealth}/{visibleCombat.playerMaxHealth} · {visibleCombat.opponentName} {visibleCombat.opponentHealth}/{visibleCombat.opponentMaxHealth}</span>
      </div>
      <div className="focused-terminal-combat__actions" role="group" aria-label="Combat actions">
        <button
          type="button"
          className="focused-quick-command focused-combat-action"
          aria-label="Attack during active combat"
          onClick={() => void performCombatAction("attack", undefined, true)}
          disabled={pending !== null}
        >
          attack
        </button>
        <button
          type="button"
          className="focused-quick-command focused-combat-action"
          aria-label="Defend during active combat"
          onClick={() => void performCombatAction("defend", undefined, true)}
          disabled={pending !== null}
        >
          defend
        </button>
        {quickUseItems.some((item) => item.consumable?.effect === "heal") ? (
          <button
            type="button"
            className="focused-quick-command focused-combat-action"
            aria-expanded={combatUseMenuOpen}
            aria-controls="combat-usable-items"
            onClick={() => setCombatUseMenuOpen((open) => !open)}
            disabled={pending !== null}
          >
            use
          </button>
        ) : null}
        <button
          type="button"
          className="focused-quick-command focused-combat-action"
          aria-label="Flee from combat"
          onClick={() => void performCombatAction("flee", undefined, true)}
          disabled={pending !== null || !canFlee}
          title={canFlee ? undefined : `Need ${FLEE_STAMINA_COST} stamina to flee`}
        >
          flee
        </button>
      </div>
      <ClassAbilityList actions={availableClassActions} onUse={(abilityId) => void performClassAbility(abilityId)} disabled={pending !== null} label="Combat class abilities" />
      {combatUseMenuOpen ? (
        <div
          id="combat-usable-items"
          className="focused-terminal-combat__items"
          role="group"
          aria-label="Items available to use during combat"
        >
          {quickUseItems
            .filter((item) => item.consumable?.effect === "heal")
            .map((item) => (
              <button
                key={item.id}
                type="button"
                className="focused-quick-command focused-combat-action"
                aria-label={`Use ${item.label} during combat`}
                onClick={() => {
                  setCombatUseMenuOpen(false);
                  void performCombatAction("use-item", undefined, true, item.id);
                }}
                disabled={pending !== null}
              >
                {item.label}
              </button>
            ))}
        </div>
      ) : null}
    </section>
  ) : null);
}
