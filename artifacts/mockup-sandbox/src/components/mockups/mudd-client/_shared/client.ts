// Local-only preview adapter. The production client remains unchanged.
export interface RoomExit {
  id: string;
  label: string;
  direction?: string;
  available: boolean;
}

export interface ReadableObject {
  id: string;
  label: string;
  description: string;
}

export interface LocationProjection {
  worldInstanceId: string;
  locationId: string;
  title: string;
  description: string;
  revision: number;
  exits: RoomExit[];
  objects: ReadableObject[];
}

export interface GameSnapshot {
  player: { id: string; displayName: string };
  character?: {
    characterId: string;
    worldInstanceId: string;
    name: string;
    locationId: string;
    revision: number;
  };
  location?: LocationProjection;
}

interface PreviewRoom {
  id: string;
  title: string;
  description: string;
  readables?: Array<ReadableObject & { text: string }>;
  exits: (RoomExit & { target: string })[];
}

const rooms: PreviewRoom[] = [
  {
    id: 'mossgate-clearing',
    title: 'Mossgate Clearing',
    description: 'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east.',
    readables: [
      {
        id: 'mossgate-marker',
        label: 'Weathered marker',
        description: 'A weathered stone marker, its carved arrow worn but still pointing east.',
        text: 'OLD BELL TOWER — EAST',
      },
    ],
    exits: [
      { id: 'clearing-to-bridge', target: 'glasswater-bridge', label: 'North to Glasswater Bridge', direction: 'north', available: true },
      { id: 'clearing-to-tower', target: 'bell-tower', label: 'East to the Old Bell Tower', direction: 'east', available: true },
    ],
  },
  {
    id: 'glasswater-bridge',
    title: 'Glasswater Bridge',
    description: 'A low stone bridge crosses clear water. Reeds stir below it, and the path returns south or bends east toward a dark roofline.',
    exits: [
      { id: 'bridge-to-clearing', target: 'mossgate-clearing', label: 'South to Mossgate Clearing', direction: 'south', available: true },
      { id: 'bridge-to-tower', target: 'bell-tower', label: 'East to the Old Bell Tower', direction: 'east', available: true },
    ],
  },
  {
    id: 'bell-tower',
    title: 'Old Bell Tower',
    description: 'The roofless tower stands quiet above the trees. Its cracked bell hangs still; paths lead west to the clearing and north to the bridge.',
    exits: [
      { id: 'tower-to-clearing', target: 'mossgate-clearing', label: 'West to Mossgate Clearing', direction: 'west', available: true },
      { id: 'tower-to-bridge', target: 'glasswater-bridge', label: 'North to Glasswater Bridge', direction: 'north', available: true },
    ],
  },
];

export class MuddHttpClient {
  private locationId = 'mossgate-clearing';
  private revision = 1;
  private name = 'Rowan';
  private worldInstanceId: string;

  constructor(options: { worldInstanceId: string }) {
    this.worldInstanceId = options.worldInstanceId;
  }

  async getGame(): Promise<GameSnapshot> {
    return {
      player: { id: 'guest-preview', displayName: 'Guest' },
      character: {
        characterId: 'rowan-preview',
        worldInstanceId: this.worldInstanceId,
        name: this.name,
        locationId: this.locationId,
        revision: this.revision,
      },
      location: this.describe(),
    };
  }

  async createCharacter(name: string) {
    this.name = name;
    return { receipt: { ok: true as const, newAggregateVersion: this.revision } };
  }

  async look(_characterId: string): Promise<LocationProjection> {
    return this.describe();
  }

  async read(_characterId: string, objectId: string) {
    const room = rooms.find((item) => item.id === this.locationId);
    const readable = room?.readables?.find((item) => item.id === objectId);
    if (!readable) throw new Error('That object is not readable from here.');
    return { id: readable.id, label: readable.label, text: readable.text };
  }

  async move(_characterId: string, exitId: string, expectedVersion: number) {
    if (expectedVersion !== this.revision) throw new Error('Location changed. Try again.');
    const room = rooms.find((item) => item.id === this.locationId)!;
    const exit = room.exits.find((item) => item.id === exitId);
    if (!exit) throw new Error('That exit is not available here.');
    this.locationId = exit.target;
    this.revision += 1;
    return { receipt: { ok: true as const, newAggregateVersion: this.revision } };
  }

  private describe(): LocationProjection {
    const room = rooms.find((item) => item.id === this.locationId)!;
    return {
      worldInstanceId: this.worldInstanceId,
      locationId: room.id,
      title: room.title,
      description: room.description,
      revision: this.revision,
      exits: room.exits.map(({ target: _target, ...exit }) => exit),
      objects: (room.readables ?? []).map(({ id, label, description }) => ({ id, label, description })),
    };
  }
}
