import {
  type GameSnapshot
} from "@mudd/client-sdk";
import {
  characterHasEquippedItem
} from "@mudd/contracts";
import {
  ActivityHistoryWindow,
  DisclosureButton,
  type ActivityEntry
} from "@mudd/ui";

import type { Dispatch, ReactNode, SetStateAction } from "react";

function dailyCycleResetDate(cycle: string): string {
  const cycleStart = Date.parse(`${cycle}T00:00:00.000Z`);
  if (!Number.isFinite(cycleStart)) return cycle;
  return new Date(cycleStart + 86_400_000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
export interface FieldNotesScreenProps {
  infoTabs: ReactNode;
  entries: readonly ActivityEntry[];
  snapshot: GameSnapshot | null;
  collapsedQuestGroups: { active: boolean; completed: boolean ;};
  setCollapsedQuestGroups: Dispatch<SetStateAction<{ active: boolean; completed: boolean ;}>>;
  collapsedQuestCards: Set<string>;
  setCollapsedQuestCards: Dispatch<SetStateAction<Set<string>>>;
}
export function FieldNotesScreen({ infoTabs, entries, snapshot, collapsedQuestGroups, setCollapsedQuestGroups, collapsedQuestCards, setCollapsedQuestCards }: FieldNotesScreenProps) {

  return (<div className="focused-screen" aria-label="Field notes">
    {infoTabs}
    <div className="focused-screen-heading">
      <div><div className="focused-kicker">Progress and session history</div><h1 className="focused-screen-title">Field notes</h1></div>
      <span className="focused-coordinate">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
    </div>
    <div className="focused-notes-layout">
      <section className="focused-quest-journal" aria-labelledby="quest-journal-title">
        <h2 id="quest-journal-title">Quest journal</h2>
        {(["active", "completed"] as const).map((status) => {
          const quests = snapshot?.questJournal?.filter((quest) => quest.status === status) ?? [];
          const heading = status === "active" ? "Current quests" : "Completed quests";
          const emptyMessage = status === "active" ? "No current quests." : "No completed quests yet.";
          const collapsed = collapsedQuestGroups[status];
          return (
            <div className="focused-quest-group" key={status}>
              <h3 className="focused-quest-group-title">
                <DisclosureButton
                  controls={`quest-group-${status}`}
                  expanded={!collapsed}
                  className="focused-quest-group-toggle"
                  onClick={() => setCollapsedQuestGroups((current) => ({ ...current, [status]: !current[status] }))}
                >
                  {heading}
                </DisclosureButton>
              </h3>
              <div className="focused-quest-group-content" hidden={collapsed} id={`quest-group-${status}`}>
                {quests.length ? (
                  <div className="focused-quest-list">
                    {quests.map((quest) => {
                      const collapsed = collapsedQuestCards.has(quest.questId);
                      const detailsId = `quest-details-${quest.questId}`;
                      return (
                        <article className="focused-quest-card" key={quest.questId}>
                          <h4 className="focused-quest-item-heading">
                            <DisclosureButton
                              controls={detailsId}
                              expanded={!collapsed}
                              className="focused-quest-toggle"
                              onClick={() => setCollapsedQuestCards((current) => {
                                const next = new Set(current);
                                if (collapsed) next.delete(quest.questId);
                                else next.add(quest.questId);
                                return next;
                              })}
                            >
                              <span className="focused-quest-title">{quest.title}</span>
                              <span className={`focused-quest-status focused-quest-status--${quest.status}`}>
                                {quest.status === "completed" ? "Completed" : "Active"}
                              </span>
                            </DisclosureButton>
                          </h4>
                          <div className="focused-quest-content" hidden={collapsed} id={detailsId}>
                            <p className="focused-quest-summary">{quest.summary}</p>
                            <ol className="focused-quest-objectives">
                              {quest.objectives.map((objective) => (
                                <li
                                  className={objective.completed ? "focused-quest-objective focused-quest-objective--complete" : "focused-quest-objective"}
                                  key={objective.id}
                                >
                                  <span aria-hidden="true">{objective.completed ? "✓" : "○"}</span>
                                  <span>{objective.label}</span>
                                </li>
                              ))}
                            </ol>
                            {quest.branch ? (
                              <div className="focused-quest-branch">
                                <p className="focused-quest-summary">
                                  <strong>{quest.outcome ? "Outcome: " : "Current path: "}</strong>
                                  {quest.outcome ? quest.outcome.label : quest.branch.label}
                                </p>
                                {quest.outcome ? <p className="focused-quest-summary">{quest.outcome.summary}</p> : null}
                                {quest.decisions?.length ? (
                                  <p className="focused-quest-summary">
                                    <strong>Your decisions: </strong>
                                    {quest.decisions.map((decision) => decision.label).join("; ")}
                                  </p>
                                ) : null}
                                {quest.availableChoices?.length ? (
                                  <>
                                    <p className="focused-quest-summary"><strong>Decisions you can make now:</strong></p>
                                    <ul className="focused-quest-objectives">
                                      {quest.availableChoices.map((choice) => (
                                        <li className="focused-quest-objective" key={choice.choiceId}>
                                          <span>{choice.label}{choice.npcName ? ` — speak with ${choice.npcName}` : ""}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </>
                                ) : null}
                                {quest.worldOutcomes?.map((outcome) => (
                                  <p className="focused-quest-summary" key={outcome.key}>
                                    <strong>Settled in this world: </strong>{outcome.label}
                                  </p>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="focused-quest-empty">{emptyMessage}</p>
                )}
              </div>
            </div>
          );
        })}
      </section>
      <section className="focused-quest-journal focused-daily-journal" aria-labelledby="daily-journal-title">
        <h2 id="daily-journal-title">Daily postings</h2>
        {(() => {
          const character = snapshot?.character;
          const jobs = character?.dailyJobs ?? [];
          const today = new Date().toISOString().slice(0, 10);
          if (!jobs.length) return <p className="focused-quest-empty">No daily postings accepted yet.</p>;
          return (
            <ul className="focused-daily-journal__list">
              {jobs.map((job) => {
                const expired = job.cycle < today && job.status === "active";
                const status = expired ? "Expired" : job.status === "completed" ? "Completed" : "Active";
                const carriedCount = job.details
                  ? (character?.inventory ?? []).filter((item) =>
                    item.typeId === job.details!.supplyTypeId &&
                    item.questBound !== true &&
                    (!character?.equipment || !characterHasEquippedItem(character.equipment, item.id))
                  ).length
                  : 0;
                return (
                  <li className="focused-daily-journal__item" key={`${job.boardId}:${job.cycle}:${job.jobId}`}>
                    <span className="focused-daily-journal__description">
                      {job.title}
                      <small>{job.cycle}{job.details ? ` · resets ${dailyCycleResetDate(job.cycle)}` : ""}</small>
                      {job.details && (
                        <>
                          <small>Posted by {job.details.poster}</small>
                          {job.status === "active" && (
                            <small>Bring {job.details.quantity} {job.details.supplyTypeId} · carried {carriedCount}/{job.details.quantity}</small>
                          )}
                          <small>Reward: {job.details.gold} gold · {job.details.experience} XP</small>
                        </>
                      )}
                    </span>
                    <span className={`focused-quest-status focused-quest-status--${expired ? "expired" : job.status}`}>{status}</span>
                  </li>
                );
              })}
            </ul>
          );
        })()}
      </section>
      <div className="focused-log">
        {entries.length ? (
          <ActivityHistoryWindow entries={entries} reverse label="Field notes" />
        ) : (
          <p className="focused-feedback focused-feedback--empty">No activity this session. Actions and command results will appear here.</p>
        )}
      </div>
    </div>
  </div>);
}
