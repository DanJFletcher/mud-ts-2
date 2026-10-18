/**
 * PROPOSED portable SDK shape adapted from CLIENTS_AND_REPLIT.md.
 * Local host and server transports implement the same interface.
 */
import type { CommandReceipt } from './protocol.js';
import type { CharacterProjection } from './character.js';
import type {
  LocationProjection,
  LocationDescribeQuery,
  ObjectReadQuery,
  ReadableObjectProjection,
} from './world.js';
import type { MoveCharacterCommand } from './movement.js';
import type {
  DropCharacterItemCommand,
  EquipCharacterItemCommand,
  UnequipCharacterItemCommand,
  UseCharacterItemCommand,
  ReadCharacterObjectCommand,
  TakeCharacterItemCommand,
} from './character.js';
import type { SayCommand } from './chat.js';
import type { CreateCharacterCommand } from './character.js';
import type { CombatActionCommand } from './combat.js';
import type { StreamNotification, SubscriptionRequest } from './stream.js';

export type ClientCommand =
  | MoveCharacterCommand
  | TakeCharacterItemCommand
  | DropCharacterItemCommand
  | EquipCharacterItemCommand
  | UnequipCharacterItemCommand
  | UseCharacterItemCommand
  | ReadCharacterObjectCommand
  | SayCommand
  | CreateCharacterCommand
  | CombatActionCommand;
export type ClientQuery = LocationDescribeQuery | ObjectReadQuery;
export type ConnectionMode = 'local' | 'remote';

export interface ConnectionOptions {
  readonly mode: ConnectionMode;
  readonly worldInstanceId: string;
  readonly endpoint?: string;
  readonly sessionToken?: string;
}

export type QueryResult<Q extends ClientQuery> =
  Q extends LocationDescribeQuery
    ? Readonly<{ ok: true; value: LocationProjection }> | Readonly<{ ok: false; code: string; message: string }>
    : Q extends ObjectReadQuery
      ? Readonly<{ ok: true; value: ReadableObjectProjection }> | Readonly<{ ok: false; code: string; message: string }>
      : never;

export type ProjectionListener = (notification: StreamNotification) => void;
export type Unsubscribe = () => void;

export interface MuddClient {
  connect(options: ConnectionOptions): Promise<void>;
  execute<C extends ClientCommand>(command: C): Promise<CommandReceipt>;
  query<Q extends ClientQuery>(query: Q): Promise<QueryResult<Q>>;
  subscribe(topic: SubscriptionRequest, listener: ProjectionListener): Unsubscribe;
  disconnect(): Promise<void>;
}

/** UI layer may define richer view models, but @mudd/ui never imports MuddClient. */
export type { CharacterProjection, LocationProjection };
