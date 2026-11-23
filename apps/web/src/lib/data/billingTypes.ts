import type { BoostPackage, BoostStatus, PremiumPlan, PremiumState } from '@/lib/domain/premium';

/**
 * What the browser needs to take a payment. `test` is the local checkout (no money moves);
 * `razorpay` opens Razorpay Checkout with the subscription or order the server created.
 */
export type CheckoutIntent =
  | { mode: 'test'; intentId: string; amount: number; description: string }
  | {
      mode: 'razorpay';
      keyId: string;
      amount: number;
      description: string;
      subscriptionId?: string;
      orderId?: string;
      prefill: { email: string; name: string };
    };

export interface PremiumStatus {
  premium: PremiumState | null;
  /** Guest passes left this month (Max only). */
  passesLeft: number;
  /** Passes this member created, newest first. */
  passes: { code: string; createdAt: string; redeemed: boolean }[];
  /** Whether this account may buy (adults only). */
  canBuy: boolean;
}

export interface Wallpaper {
  id: string;
  title: string;
  /** Desktop 1920x1080 and phone 1080x1920 versions. */
  desktop: string;
  phone: string;
}

export interface BoostOrder {
  id: string;
  gameId: string;
  gameTitle: string;
  gameSlug: string;
  studioName: string;
  package: BoostPackage;
  amount: number;
  status: BoostStatus;
  /** Links to the posted Shorts and Reels. */
  shortUrls: string[];
  reelUrls: string[];
  /** Sponsored placement window, set when the order is paid. */
  startsAt: string | null;
  endsAt: string | null;
  heroUntil: string | null;
  notes: string;
  createdAt: string;
}

export interface PaymentRow {
  id: string;
  kind: 'premium' | 'boost' | 'verified';
  what: string;
  amount: number;
  status: 'paid' | 'pending' | 'failed' | 'refunded';
  provider: 'test' | 'razorpay';
  reference: string;
  who: string;
  createdAt: string;
}

export interface EmailRow {
  id: string;
  to: string;
  template: string;
  subject: string;
  status: 'queued' | 'sent' | 'saved' | 'failed';
  error: string | null;
  createdAt: string;
}

export type { BoostPackage, PremiumPlan };
