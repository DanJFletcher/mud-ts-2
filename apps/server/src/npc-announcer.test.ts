import { describe, expect, it, vi } from 'vitest';
import { createNpcRoomAnnouncer } from './npc-announcer.js';

describe('NPC room announcements', () => {
  it('publishes an announcement on room entry, observes a cooldown, then cycles the line', async () => {
    let currentTime = 1_000;
    const publish = vi.fn().mockResolvedValue(undefined);
    const announce = createNpcRoomAnnouncer(publish, 60_000, () => currentTime);
    const npc = {
      worldInstanceId: 'mudd-demo-instance',
      roomId: 'mossgate-clearing',
      npcId: 'mara-waykeeper',
      npcName: 'Mara',
      announcements: ['The north bridge is open.', 'The marker points east.'],
    } as const;

    await expect(announce(npc)).resolves.toBe(true);
    await expect(announce(npc)).resolves.toBe(false);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenLastCalledWith({
      worldInstanceId: npc.worldInstanceId,
      roomId: npc.roomId,
      npcId: npc.npcId,
      npcName: npc.npcName,
      text: 'The north bridge is open.',
    });

    currentTime += 60_001;
    await expect(announce(npc)).resolves.toBe(true);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith({
      worldInstanceId: npc.worldInstanceId,
      roomId: npc.roomId,
      npcId: npc.npcId,
      npcName: npc.npcName,
      text: 'The marker points east.',
    });
  });

  it('prevents duplicate messages while a room announcement is being stored', async () => {
    let finishPublishing: (() => void) | undefined;
    const publish = vi.fn(() => new Promise<void>((resolve) => {
      finishPublishing = resolve;
    }));
    const announce = createNpcRoomAnnouncer(publish);
    const npc = {
      worldInstanceId: 'mudd-demo-instance',
      roomId: 'mossgate-clearing',
      npcId: 'mara-waykeeper',
      npcName: 'Mara',
      announcements: ['The north bridge is open.'],
    } as const;

    const first = announce(npc);
    await Promise.resolve();
    await expect(announce(npc)).resolves.toBe(false);
    expect(publish).toHaveBeenCalledOnce();

    finishPublishing?.();
    await expect(first).resolves.toBe(true);
  });
});
