import {
  type GameSnapshot
} from "@mudd/client-sdk";
import {
  Button,
  ClassChoice,
  Panel,
  Text
} from "@mudd/ui";

import type { InteractionInbox } from "@mudd/contracts";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { ClassCatalogSummary } from "./view-types.js";

export interface StatsScreenProps {
  infoTabs: ReactNode;
  snapshot: GameSnapshot | null;
  currentCharacterClass: NonNullable<GameSnapshot["character"]>["characterClass"];
  classCatalogError: string | undefined;
  isAnyCombatActive: boolean;
  visiblePvp: InteractionInbox["encounter"] | undefined;
  classCatalog: ClassCatalogSummary | undefined;
  classChoiceId: string;
  setClassChoiceId: Dispatch<SetStateAction<string>>;
  setConfirmClassAdoption: Dispatch<SetStateAction<boolean>>;
  pending: string | null;
  confirmClassAdoption: boolean;
  adoptCharacterClass: () => Promise<void>;
  loading: boolean;
}
export function StatsScreen({ infoTabs, snapshot, currentCharacterClass, classCatalogError, isAnyCombatActive, visiblePvp, classCatalog, classChoiceId, setClassChoiceId, setConfirmClassAdoption, pending, confirmClassAdoption, adoptCharacterClass, loading }: StatsScreenProps) {

  return (<div className="focused-screen" aria-label="Stats">
    {infoTabs}
    <div className="focused-screen-heading">
      <div><div className="focused-kicker">Character progression</div><h1 className="focused-screen-title">Stats</h1></div>
    </div>
    {snapshot ? (
      <Panel className="focused-card">
        <div className="focused-identity focused-stats-identity">
          <span className="focused-avatar" aria-hidden="true">{(snapshot.character?.name || snapshot.player.displayName).trim().charAt(0).toUpperCase() || "G"}</span>
          <div>
            <h2 className="focused-identity-name">{snapshot.character?.name || "Guest"}</h2>
            <p className="focused-identity-label">
              {`Level ${snapshot.character?.advancement?.level ?? 1}`}
            </p>
          </div>
        </div>
        {currentCharacterClass ? (
          <section className="focused-stat-section" aria-labelledby="character-class-title">
            <h2 id="character-class-title">Class · {currentCharacterClass.label}</h2>
            <p className="focused-note">{currentCharacterClass.description}</p>
            <div className="focused-detail focused-detail--wide">
              <span>Starting action</span>
              <strong>{currentCharacterClass.coreAction.label}</strong>
              <p>{currentCharacterClass.coreAction.description}</p>
            </div>
          </section>
        ) : classCatalogError ? <p role="alert" className="focused-note">{classCatalogError}</p> : !isAnyCombatActive && !visiblePvp && classCatalog?.classes.length ? (
          <section className="focused-stat-section" aria-labelledby="class-adoption-title">
            <h2 id="class-adoption-title">Choose your class</h2>
            <p className="focused-note">This character predates class choices. You may adopt one class once, while outside combat. This choice is permanent.</p>
            <ClassChoice
              classes={classCatalog.classes}
              value={classChoiceId || undefined}
              onChange={(nextClassId) => {
                setClassChoiceId(nextClassId);
                setConfirmClassAdoption(false);
              }}
              disabled={pending !== null}
              name="legacy-class-adoption"
            />
            {confirmClassAdoption && (
              <p className="focused-note" role="status">
                Confirm this class for {snapshot.character?.name ?? "your character"}. It cannot be changed later.
              </p>
            )}
            <Button
              type="button"
              disabled={!classChoiceId || pending !== null}
              onClick={() => void adoptCharacterClass()}
            >
              {pending === "combat" ? "Saving…" : confirmClassAdoption ? "Confirm permanent choice" : "Adopt this class"}
            </Button>
          </section>
        ) : null}
        <section className="focused-stat-section" aria-labelledby="primary-stats-title">
          <h2 id="primary-stats-title">Stats</h2>
          <div className="focused-stat-grid">
            <div className="focused-stat"><span>Strength</span><strong>{snapshot.stats?.attributes.strength ?? "—"}</strong></div>
            <div className="focused-stat"><span>Intelligence</span><strong>{snapshot.stats?.attributes.intelligence ?? "—"}</strong></div>
            <div className="focused-stat"><span>Constitution</span><strong>{snapshot.stats?.attributes.constitution ?? "—"}</strong></div>
            <div className="focused-stat"><span>Dexterity</span><strong>{snapshot.stats?.attributes.dexterity ?? "—"}</strong></div>
          </div>
        </section>
        <section className="focused-stat-section" aria-labelledby="skills-title">
          <h2 id="skills-title">Skills</h2>
          <div className="focused-stat-grid">
            <div className="focused-stat">
              <span>Woodcutting</span>
              <strong>
                Level {snapshot.character?.woodcutting?.level ?? 1} · {snapshot.character?.woodcutting?.experience ?? 0} XP
              </strong>
            </div>
            <div className="focused-stat">
              <span>Crafting</span>
              <strong>
                Level {snapshot.character?.crafting?.level ?? 1} · {((snapshot.character?.crafting?.experienceHundredths ?? 0) / 100).toFixed(2).replace(/\.?0+$/, "")} XP
              </strong>
            </div>
          </div>
        </section>
        <section className="focused-stat-section" aria-labelledby="derived-stats-title">
          <h2 id="derived-stats-title">Attributes</h2>
          <div className="focused-stat-grid">
            <div className="focused-stat"><span>Attack Power</span><strong>{snapshot.stats?.attackPower ?? "—"}</strong></div>
            <div className="focused-stat"><span>Spell Power</span><strong>{snapshot.stats?.spellPower ?? "—"}</strong></div>
            <div className="focused-stat"><span>Damage</span><strong>{snapshot.stats?.damage ?? "—"}</strong></div>
            <div className="focused-stat"><span>Crit Chance</span><strong>{snapshot.stats ? `${snapshot.stats.critChancePercent.toFixed(1)}%` : "—"}</strong></div>
            <div className="focused-stat"><span>Health Regen</span><strong>{snapshot.stats?.healthRegen ?? "—"}</strong></div>
            <div className="focused-stat"><span>Mana Regen</span><strong>{snapshot.stats?.manaRegen ?? "—"}</strong></div>
            <div className="focused-stat"><span>Stamina Regen</span><strong>{snapshot.stats?.staminaRegen ?? "—"}</strong></div>
            <div className="focused-stat"><span>Armor</span><strong>{snapshot.stats ? `${snapshot.stats.armorPercent.toFixed(1)}%` : "—"}</strong></div>
            <div className="focused-stat"><span>Resilience</span><strong>{snapshot.stats ? `${snapshot.stats.resiliencePercent.toFixed(1)}%` : "—"}</strong></div>
            <div className="focused-stat"><span>Dodge</span><strong>{snapshot.stats ? `${snapshot.stats.dodgePercent.toFixed(1)}%` : "—"}</strong></div>
          </div>
        </section>
        <section className="focused-stat-section" aria-labelledby="other-stats-title">
          <h2 id="other-stats-title">Other</h2>
          <div className="focused-stat-grid">
            <div className="focused-stat"><span>Exp</span><strong>{snapshot.character?.advancement?.experience ?? 0}</strong></div>
            <div className="focused-stat"><span>{snapshot.currency?.name ?? "Gold"}</span><strong>{snapshot.character?.wallet?.balance ?? 0}</strong></div>
            <div className="focused-stat"><span>Glory</span><strong>{snapshot.character?.honors?.glory ?? 0}</strong></div>
            <div className="focused-stat"><span>Medals</span><strong>{snapshot.character?.honors?.medals ?? 0}</strong></div>
          </div>
        </section>
        <p className="focused-note">Strength, Constitution, weapons, and armor affect current combat. Spell power, regeneration, critical, avoidance, Glory, and Medals are tracked for future systems.</p>
        {!snapshot.character && <p className="focused-note">Begin from Play to enter the world.</p>}
      </Panel>
    ) : (
      <Panel className="focused-card"><Text variant="muted">{loading ? "Character details are loading." : "Character details are unavailable."}</Text></Panel>
    )}
  </div>);
}
