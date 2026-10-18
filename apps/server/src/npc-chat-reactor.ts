import type { NpcRoomChatReactionDefinition } from '@mudd/contracts';
import type { RoomChatMessage } from './room-chat-service.js';

type NpcRoomChatReactionInput = Readonly<{
  worldInstanceId: string;
  roomId: string;
  npcId: string;
  npcName: string;
  playerMessage: string;
  reactions: readonly NpcRoomChatReactionDefinition[];
}>;

type ReactionPublisher = (input: Readonly<{
  worldInstanceId: string;
  roomId: string;
  npcId: string;
  npcName: string;
  text: string;
}>) => Promise<RoomChatMessage>;

function normalizeWords(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function findReactionResponse(
  message: string,
  reactions: readonly NpcRoomChatReactionDefinition[],
): string | undefined {
  const normalizedMessage = normalizeWords(message);
  if (!normalizedMessage) return undefined;
  const paddedMessage = ` ${normalizedMessage} `;

  return reactions.find((reaction) =>
    reaction.keywords.some((keyword) => {
      const normalizedKeyword = normalizeWords(keyword);
      return normalizedKeyword.length > 0 && paddedMessage.includes(` ${normalizedKeyword} `);
    }),
  )?.response;
}

export function createNpcRoomChatReactor(
  publish: ReactionPublisher,
  cooldownMs = 30_000,
  now: () => number = Date.now,
) {
  const lastPublishedAt = new Map<string, number>();
  const inFlight = new Set<string>();

  return async (input: NpcRoomChatReactionInput): Promise<RoomChatMessage | undefined> => {
    const response = findReactionResponse(input.playerMessage, input.reactions);
    if (!response) return undefined;

    const key = JSON.stringify([input.worldInstanceId, input.roomId, input.npcId]);
    if (inFlight.has(key)) return undefined;

    const currentTime = now();
    const lastTime = lastPublishedAt.get(key);
    if (lastTime !== undefined && currentTime - lastTime < cooldownMs) return undefined;

    inFlight.add(key);
    try {
      const message = await publish({
        worldInstanceId: input.worldInstanceId,
        roomId: input.roomId,
        npcId: input.npcId,
        npcName: input.npcName,
        text: response,
      });
      lastPublishedAt.set(key, now());
      return message;
    } finally {
      inFlight.delete(key);
    }
  };
}
