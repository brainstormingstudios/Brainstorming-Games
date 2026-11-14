/**
 * The wire protocol between a game (inside the play-origin iframe) and the Brainstorming Games
 * page that frames it. Messages travel through `postMessage` only; the host validates every one
 * with the zod schemas in `host.ts` and checks its origin and source window.
 */

export const PROTOCOL = 'bg-sdk';
export const PROTOCOL_VERSION = 1;
export const SDK_VERSION = '1.0.0';

export type Environment = 'local' | 'brainstorming' | 'disabled';

export interface GameSettings {
  /** The player muted the site, or an ad is playing. */
  muteAudio: boolean;
  /** Chat must be hidden (minors without consent, school-safe mode). */
  disableChat: boolean;
  /** The player asked for low-data mode: prefer smaller assets. */
  lowData: boolean;
  /** School-safe mode is on. */
  schoolSafe: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  muteAudio: false,
  disableChat: false,
  lowData: false,
  schoolSafe: false,
};

export interface BgUser {
  id: string;
  username: string;
  avatarUrl: string | null;
}

export type AdSkipReason =
  | 'premium'
  | 'cooldown'
  | 'spark'
  | 'disabled'
  | 'chained'
  | 'busy'
  | 'gameplay-active'
  | 'limit'
  | 'error'
  | 'unavailable';

export interface AdResult {
  shown: boolean;
  reason?: AdSkipReason;
}

export interface RewardedResult {
  rewarded: boolean;
  reason?: AdSkipReason;
}

export interface RoomInfo {
  roomId: string;
  isJoinable: boolean;
  inviteParams?: Record<string, string>;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
  isMe: boolean;
}

export interface LeaderboardTop {
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}

export type GameEventName = 'loading_start' | 'loading_stop' | 'gameplay_start' | 'gameplay_stop';

export interface HelloResult {
  gameId: string;
  versionId: string | null;
  settings: GameSettings;
  user: BgUser | null;
  /** Invite parameters the player arrived with (from an invite link or a party). */
  inviteParams: Record<string, string>;
  /** Public URL of the game page, used to build invite links. */
  gameUrl: string;
  /** The game is in its Basic Launch: every ad call is refused. */
  spark: boolean;
  /** A private preview: the host shows a debug panel. */
  preview: boolean;
}

/** Every request a game can make, with its parameters and result. */
export interface Methods {
  hello: { params: { version: string }; result: HelloResult };
  'game.event': { params: { name: GameEventName }; result: null };
  'game.celebrate': { params: Record<string, never>; result: null };
  'game.progress': { params: { pct: number }; result: null };
  'game.context': { params: { context: Record<string, unknown> | null }; result: null };
  'game.room': { params: RoomInfo; result: null };
  'ad.midgame': { params: Record<string, never>; result: AdResult };
  'ad.rewarded': { params: Record<string, never>; result: RewardedResult };
  'ad.banner': {
    params: { containerId: string; size: string; rect: { x: number; y: number; width: number; height: number } };
    result: AdResult;
  };
  'ad.hideBanner': { params: { containerId: string }; result: null };
  'ad.adblock': { params: Record<string, never>; result: boolean };
  'user.get': { params: Record<string, never>; result: BgUser | null };
  'user.token': { params: Record<string, never>; result: string | null };
  'user.login': { params: Record<string, never>; result: BgUser | null };
  'data.get': { params: { key: string }; result: unknown };
  'data.set': { params: { key: string; value: unknown }; result: null };
  'data.remove': { params: { key: string }; result: null };
  'lb.submit': { params: { board: string; score: number }; result: { accepted: boolean } };
  'lb.top': { params: { board: string; limit: number; friends: boolean }; result: LeaderboardTop };
  'quests.track': { params: { event: string; value: number }; result: null };
}

export type MethodName = keyof Methods;

/** Events the host pushes to the game. */
export interface HostEvents {
  settings: GameSettings;
  auth: BgUser | null;
  /** An ad started (pause and mute) or finished (resume). */
  'ad-state': { playing: boolean };
}

export type HostEventName = keyof HostEvents;

export interface RequestMessage {
  p: typeof PROTOCOL;
  v: typeof PROTOCOL_VERSION;
  kind: 'req';
  id: number;
  method: MethodName;
  params: unknown;
}

export interface ResponseMessage {
  p: typeof PROTOCOL;
  v: typeof PROTOCOL_VERSION;
  kind: 'res';
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface EventMessage {
  p: typeof PROTOCOL;
  v: typeof PROTOCOL_VERSION;
  kind: 'evt';
  name: HostEventName;
  data: unknown;
}

export type Message = RequestMessage | ResponseMessage | EventMessage;

export function isProtocolMessage(data: unknown): data is Message {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { p?: unknown }).p === PROTOCOL &&
    (data as { v?: unknown }).v === PROTOCOL_VERSION
  );
}
