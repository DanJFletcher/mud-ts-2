import {
  type GameSnapshot
} from "@mudd/client-sdk";
import {
  Panel,
  Text
} from "@mudd/ui";

import type { ReactNode } from "react";

export interface VitalsScreenProps {
  infoTabs: ReactNode;
  snapshot: GameSnapshot | null;
  loading: boolean;
}
export function VitalsScreen({ infoTabs, snapshot, loading }: VitalsScreenProps) {

  return (<div className="focused-screen" aria-label="Vitals">
    {infoTabs}
    <div className="focused-screen-heading">
      <div><div className="focused-kicker">Character</div><h1 className="focused-screen-title">Vitals</h1></div>
    </div>
    {snapshot ? (
      <Panel className="focused-card">
        <div className="focused-identity">
          <span className="focused-avatar" aria-hidden="true">{(snapshot.character?.name || snapshot.player.displayName).trim().charAt(0).toUpperCase() || "G"}</span>
          <div>
            <h2 className="focused-identity-name">{snapshot.character?.name || "Guest"}</h2>
            <p className="focused-identity-label">{snapshot.player.displayName} · Account</p>
          </div>
        </div>
        <div className="focused-vitals">
          {[
            { label: "Health", resource: snapshot.character?.health },
            { label: "Stamina", resource: snapshot.character?.resources.stamina },
            { label: "Mana", resource: snapshot.character?.resources.mana },
          ].map(({ label, resource }) => (
            <div className="focused-vital" key={label}>
              <div className="focused-vital-heading">
                <span>{label}</span>
                <strong>{resource ? `${resource.current}/${resource.maximum}` : "Unavailable"}</strong>
              </div>
              {resource && (
                <div
                  className="focused-vital-meter"
                  role="meter"
                  aria-label={`Character ${label.toLocaleLowerCase()}`}
                  aria-valuemin={0}
                  aria-valuemax={resource.maximum}
                  aria-valuenow={resource.current}
                >
                  <span style={{
                    width: `${Math.max(0, Math.min(100, (resource.current / resource.maximum) * 100))}%`,
                  }} />
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="focused-details">
          <div className="focused-detail"><span>Posture</span><strong>{snapshot.character?.staminaRecovery.posture === "resting" ? "Resting · 6% of each vital every two seconds" : "Standing · 2% of each vital every two seconds"}</strong></div>
          <div className="focused-detail"><span>Standing</span><strong>{snapshot.character?.health?.current === 0 ? "Down" : snapshot.character ? "Alive" : "Not started"}</strong></div>
          <div className="focused-detail"><span>Wallet</span><strong>
            {snapshot.character?.wallet && snapshot.currency
              ? `${snapshot.character.wallet.balance} ${snapshot.currency.name}${snapshot.character.wallet.balance === 1 ? "" : "s"}`
              : "—"}
          </strong></div>
          <div className="focused-detail focused-detail--wide"><span>Current location</span><strong>{snapshot.location?.title || "—"}</strong></div>
          <div className="focused-detail focused-detail--wide">
            <span>Advancement</span>
            <strong>
              {snapshot.character?.advancement
                ? `Level ${snapshot.character.advancement.level} · ${snapshot.character.advancement.experience} XP`
                : "No combat victories yet"}
            </strong>
          </div>
        </div>
        {snapshot.character && !snapshot.character.health && <p className="focused-note">Health has not been initialized for this character yet.</p>}
        {!snapshot.character && <p className="focused-note">Begin from Play to enter the world.</p>}
      </Panel>
    ) : (
      <Panel className="focused-card"><Text variant="muted">{loading ? "Traveler details are loading." : "Traveler details are unavailable."}</Text></Panel>
    )}
  </div>);
}
