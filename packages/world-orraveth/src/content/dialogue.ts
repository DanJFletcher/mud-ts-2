import type { NpcDailyJobResponseDefinition, NpcDefinition, WorldPackContent } from '@mudd/contracts';

type LocationContent = WorldPackContent['locationContent'][string];
type NpcInput = NonNullable<LocationContent['npcs']>[number];
type ChoiceInput = NonNullable<NpcInput['dialogue']>['choices'][number];
type FollowupQuestion = Pick<ChoiceInput, 'id' | 'label' | 'response' | 'requiresProgressFlagIds' | 'hideAfterProgressFlagIds'>;

export interface SmallTalkOptions {
  npcId: string;
  identity: string;
  activity: string;
  town: { key: string; name: string; response: string };
  additionalQuestions?: FollowupQuestion[];
  /** Omitted means hide after the town question; [] means never hide. */
  hideInitialChoicesAfterProgressFlagIds?: string[];
  requireInitialChoicesAfterProgressFlagIds?: string[];
}

export function smallTalkChoices({
  npcId, identity, activity, town, additionalQuestions = [],
  hideInitialChoicesAfterProgressFlagIds, requireInitialChoicesAfterProgressFlagIds = [],
}: SmallTalkOptions): ChoiceInput[] {
  const townFlag = `${npcId}-asked-about-town`;
  const initialVisibility = {
    hideAfterProgressFlagIds: hideInitialChoicesAfterProgressFlagIds ?? [townFlag],
    ...(requireInitialChoicesAfterProgressFlagIds.length
      ? { requiresProgressFlagIds: requireInitialChoicesAfterProgressFlagIds } : {}),
  };
  return [
    { id: `${npcId}-who-are-you`, label: 'Who are you?', response: identity,
      progressFlagId: `${npcId}-asked-who`, ...initialVisibility },
    { id: `${npcId}-what-are-you-doing`, label: 'What are you doing?', response: activity,
      progressFlagId: `${npcId}-asked-activity`, ...initialVisibility },
    { id: `${npcId}-about-${town.key}`, label: `What is ${town.name} like?`, response: town.response,
      progressFlagId: townFlag, ...initialVisibility },
    ...additionalQuestions.map(({ id, label, response, requiresProgressFlagIds, hideAfterProgressFlagIds }) => {
      const required = [...new Set([
        ...(requiresProgressFlagIds ?? [townFlag]), ...requireInitialChoicesAfterProgressFlagIds,
      ])];
      return {
        id: `${npcId}-${id}`, label, response, progressFlagId: `${npcId}-asked-${id}`,
        ...(required.length ? { requiresProgressFlagIds: required } : {}),
        ...(hideAfterProgressFlagIds?.length ? { hideAfterProgressFlagIds } : {}),
      };
    }),
  ];
}

export function bulletinResponses(
  jobIds: string[], active: string, completed: string,
): NpcDailyJobResponseDefinition[] {
  return jobIds.flatMap((jobId) => [
    { boardId: 'bellwold-notice-board', jobId, status: 'active' as const, response: active },
    { boardId: 'bellwold-notice-board', jobId, status: 'completed' as const, response: completed },
  ]);
}

export function bulletinTopic(dailyJobResponses: NpcDailyJobResponseDefinition[]): NpcDefinition['topics'][number] {
  return {
    id: 'bulletin-jobs', keywords: ['job', 'jobs', 'bulletin', 'notice'],
    response: '“Check the South Common bulletin board for today’s jobs. Accept and deliver there.”',
    dailyJobResponses,
  };
}
