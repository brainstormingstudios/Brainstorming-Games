import type { CreatorGameLine, Currency } from '@/lib/domain/revenue';
import type { PayoutMethod } from './repo';

/**
 * The creator program: YouTubers, Reels makers and streamers who share games with their own link
 * (`?cr=handle`) and earn 10% of the net ad revenue from the players they bring.
 */
export type CreatorStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export type ChannelKind = 'youtube' | 'instagram' | 'twitch' | 'other';

export interface CreatorChannel {
  kind: ChannelKind;
  url: string;
}

export interface Creator {
  id: string;
  userId: string;
  /** Lower-case, 3 to 24 letters, numbers or underscores. Used in links: `?cr=handle`. */
  handle: string;
  displayName: string;
  channels: CreatorChannel[];
  /** In their own words: who watches them and what they make. */
  about: string;
  status: CreatorStatus;
  reviewNote: string | null;
  createdAt: string;
  approvedAt: string | null;
}

export interface CreatorApplyInput {
  handle: string;
  displayName: string;
  channels: CreatorChannel[];
  about: string;
  /** The applicant accepted the Creator Agreement. */
  agreed: boolean;
}

export interface CreatorGameStat {
  gameId: string;
  slug: string;
  title: string;
  visitors: number;
  plays: number;
  adImpressions: number;
}

export interface CreatorStats {
  days: number;
  /** Browsers that arrived through the creator's links. */
  visitors: number;
  plays: number;
  adImpressions: number;
  games: CreatorGameStat[];
}

export interface CreatorMonthRow {
  creatorId: string;
  handle: string;
  month: string;
  currency: Currency;
  earned: number;
  carryIn: number;
  payoutDue: number;
  status: 'finalised' | 'rolled_over' | 'paid';
  games: CreatorGameLine[];
}

export interface CreatorPayoutRow {
  id: string;
  creatorId: string;
  handle: string;
  amount: number;
  currency: Currency;
  method: PayoutMethod;
  reference: string;
  months: string[];
  paidAt: string;
}

export interface AdminCreatorRow extends Creator {
  username: string | null;
  email: string | null;
}

export const CREATOR_HANDLE = /^[a-z0-9_]{3,24}$/;
export const CREATOR_SHARE_PCT = 10;
