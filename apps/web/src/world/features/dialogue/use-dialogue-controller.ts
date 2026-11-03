import { useCallback, useState } from "react";
import type { MuddHttpClient, GameSnapshot } from "@mudd/client-sdk";
import { type ControllerOptions, roomContext } from "../controller-options.js";
import { useRequestScope } from "../../session/use-request-scope.js";

export function useDialogueController({
  client, snapshot, pending, beginForeground, finishForeground, reconcileCommand,
  setSnapshot, setConnectionError, refreshGate, addEntry, rememberCompletedQuestObjectives,
}: ControllerOptions & { rememberCompletedQuestObjectives(snapshot: GameSnapshot): void }) {
  const scope = useRequestScope(roomContext(snapshot), refreshGate, client);
  const [activeDialogue, setActiveDialogue] = useState<Awaited<ReturnType<MuddHttpClient["talk"]>> | null>(null);
  const [dialogueModalOpen, setDialogueModalOpen] = useState(false);
  const talkToNpc = useCallback(async (npcId: string, topic?: string) => {
    if (!snapshot?.character || pending) return;
    const execution = beginForeground("talk");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      const character = snapshot.character;
      let dialogue = await client.talk(character.characterId, npcId, topic);
      if (!accepts()) return;
      const progress = character.npcProgress.find((entry) => entry.npcId === npcId);
      if (!topic && dialogue.choices.length === 0 && progress?.lastChoiceId) {
        const response = await client.restartNpcDialogue(character.characterId, npcId, character.revision);
      if (!accepts()) return;
        await reconcileCommand(snapshot, response, undefined, accepts);
      if (!accepts()) return;
        setConnectionError("");
        dialogue = await client.talk(character.characterId, npcId);
      if (!accepts()) return;
      }
      addEntry("narration", `${dialogue.npcName}: ${dialogue.text}`);
      setActiveDialogue(dialogue);
      setDialogueModalOpen((isOpen) => isOpen || dialogue.choices.length > 0);
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "That person does not answer.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, pending, reconcileCommand, setConnectionError, snapshot, scope]);

  const closeNpcDialogue = useCallback(async () => {
    const dialogue = activeDialogue;
    scope.invalidate();
    setDialogueModalOpen(false);
    const character = snapshot?.character;
    if (!dialogue || !character || pending) return;
    const progress = character.npcProgress.find((entry) => entry.npcId === dialogue.npcId);
    if (!progress?.lastChoiceId) return;

    setActiveDialogue(null);
    const execution = beginForeground("talk");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      await client.restartNpcDialogue(
        character.characterId,
        dialogue.npcId,
        character.revision,
      );
      if (!accepts()) return;
      const nextSnapshot = await client.getGame();
      if (!accepts()) return;
      setSnapshot(nextSnapshot);
      setConnectionError("");
      try {
        const nextDialogue = await client.talk(character.characterId, dialogue.npcId);
        if (!accepts()) return;
        setActiveDialogue(nextDialogue);
      } catch {
        if (accepts()) setActiveDialogue(null);
      }
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "The conversation could not be restarted.");
    } finally {
      finishForeground(execution);
    }
  }, [activeDialogue, addEntry, beginForeground, client, finishForeground, pending, setConnectionError, setSnapshot, snapshot?.character, scope]);

  const chooseDialogueReply = useCallback(async (choiceId: string, announceChoice = true) => {
    if (!snapshot?.character || !activeDialogue || pending) return;
    const choice = activeDialogue.choices.find((candidate) => candidate.id === choiceId);
    if (!choice) return;

    const execution = beginForeground("talk");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    if (announceChoice) addEntry("system", `> ${choice.label}`);
    try {
      const response = await client.chooseNpcDialogue(
        snapshot.character.characterId,
        activeDialogue.npcId,
        choice.id,
        snapshot.character.revision,
      );
      if (!accepts()) return;
      const [reconciliation, dialogue] = await Promise.all([
        reconcileCommand(snapshot, response, undefined, accepts),
        client.talk(snapshot.character.characterId, activeDialogue.npcId),
      ]);
      if (!accepts()) return;
      const nextSnapshot = reconciliation.snapshot;
      rememberCompletedQuestObjectives(nextSnapshot);
      setConnectionError("");
      setActiveDialogue(dialogue);
      setDialogueModalOpen((isOpen) => isOpen || dialogue.choices.length > 0);
      addEntry("narration", `${dialogue.npcName}: ${dialogue.text}`);
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "That reply is no longer available.");
    } finally {
      finishForeground(execution);
    }
  }, [activeDialogue, addEntry, beginForeground, client, finishForeground, pending, reconcileCommand, rememberCompletedQuestObjectives, setConnectionError, snapshot, scope]);


  return {
    activeDialogue, dialogueModalOpen, talkToNpc, chooseDialogueReply, closeNpcDialogue,
    dismissForTravel: useCallback(() => {
      scope.invalidate();
      if (!dialogueModalOpen) setActiveDialogue(null);
    }, [dialogueModalOpen, scope]),
  };
}
