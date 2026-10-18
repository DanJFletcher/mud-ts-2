type AnnouncementPublisher = (input: Readonly<{
  worldInstanceId: string;
  roomId: string;
  npcId: string;
  npcName: string;
  text: string;
}>) => Promise<unknown>;

export type RoomNpcAnnouncement = Readonly<{
  worldInstanceId: string;
  roomId: string;
  npcId: string;
  npcName: string;
  announcements: readonly string[];
}>;

export function createNpcRoomAnnouncer(
  publish: AnnouncementPublisher,
  cooldownMs = 120_000,
  now: () => number = Date.now,
) {
  const lastPublishedAt = new Map<string, number>();
  const nextAnnouncementIndex = new Map<string, number>();
  const inFlight = new Set<string>();

  return async (input: RoomNpcAnnouncement): Promise<boolean> => {
    if (!input.announcements.length) return false;

    const key = JSON.stringify([input.worldInstanceId, input.roomId, input.npcId]);
    if (inFlight.has(key)) return false;

    const currentTime = now();
    const lastTime = lastPublishedAt.get(key);
    if (lastTime !== undefined && currentTime - lastTime < cooldownMs) return false;

    const index = nextAnnouncementIndex.get(key) ?? 0;
    const text = input.announcements[index % input.announcements.length];
    if (!text) return false;

    inFlight.add(key);
    try {
      await publish({
        worldInstanceId: input.worldInstanceId,
        roomId: input.roomId,
        npcId: input.npcId,
        npcName: input.npcName,
        text,
      });
      lastPublishedAt.set(key, now());
      nextAnnouncementIndex.set(key, (index + 1) % input.announcements.length);
      return true;
    } finally {
      inFlight.delete(key);
    }
  };
}
