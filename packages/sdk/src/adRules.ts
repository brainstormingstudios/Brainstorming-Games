import type { AdSkipReason } from './protocol';

/**
 * The in-game ad rules. One implementation, used by the SDK in the local environment and by the
 * host page in production, so a game can never get around them.
 *
 *   midgame   at most one every 3 minutes per player, never in the first 60 s of gameplay
 *   rewarded  the reward fires only when the ad finishes; never two in a row (gameplay has to
 *             start again between them)
 *   banners   at most 2 at once, and only while gameplay is stopped
 *   Spark     every ad call is refused during a Spark Launch
 */
export const AD_RULES = {
  midgameCooldownMs: 180_000,
  midgameMinGameplayMs: 60_000,
  rewardedMinGapMs: 30_000,
  maxBanners: 2,
} as const;

export interface AdRulesOptions {
  spark: boolean;
  enabled: boolean;
  now?: () => number;
  /** When the player last saw a midgame ad (any game), e.g. restored from storage. */
  lastMidgameAt?: number;
}

export class AdRules {
  private readonly now: () => number;
  private gameplayMs = 0;
  private gameplaySince: number | null = null;
  private lastMidgameAt: number;
  private lastRewardedAt = Number.NEGATIVE_INFINITY;
  private gameplaySinceRewarded = true;
  private readonly banners = new Set<string>();
  private adActive = false;
  /** True once the game has reported gameplay through the SDK. */
  usedGameplayEvents = false;

  constructor(private readonly options: AdRulesOptions) {
    this.now = options.now ?? (() => Date.now());
    this.lastMidgameAt = options.lastMidgameAt ?? Number.NEGATIVE_INFINITY;
  }

  get playing(): boolean {
    return this.gameplaySince !== null;
  }

  get busy(): boolean {
    return this.adActive;
  }

  get lastMidgame(): number {
    return this.lastMidgameAt;
  }

  /** Milliseconds of gameplay so far in this session. */
  gameplayTime(): number {
    return this.gameplayMs + (this.gameplaySince === null ? 0 : this.now() - this.gameplaySince);
  }

  gameplayStart(): void {
    this.usedGameplayEvents = true;
    if (this.gameplaySince === null) this.gameplaySince = this.now();
    this.gameplaySinceRewarded = true;
  }

  gameplayStop(): void {
    this.usedGameplayEvents = true;
    if (this.gameplaySince !== null) {
      this.gameplayMs += this.now() - this.gameplaySince;
      this.gameplaySince = null;
    }
  }

  private common(): AdSkipReason | null {
    if (this.options.spark) return 'spark';
    if (!this.options.enabled) return 'disabled';
    if (this.adActive) return 'busy';
    return null;
  }

  checkMidgame(): AdSkipReason | null {
    const base = this.common();
    if (base) return base;
    // Too early in the session and too soon after the last one both answer "cooldown".
    if (this.gameplayTime() < AD_RULES.midgameMinGameplayMs) return 'cooldown';
    if (this.now() - this.lastMidgameAt < AD_RULES.midgameCooldownMs) return 'cooldown';
    return null;
  }

  checkRewarded(): AdSkipReason | null {
    const base = this.common();
    if (base) return base;
    if (!this.gameplaySinceRewarded || this.now() - this.lastRewardedAt < AD_RULES.rewardedMinGapMs) return 'chained';
    return null;
  }

  checkBanner(containerId: string): AdSkipReason | null {
    if (this.options.spark) return 'spark';
    if (!this.options.enabled) return 'disabled';
    if (this.playing) return 'gameplay-active';
    if (!this.banners.has(containerId) && this.banners.size >= AD_RULES.maxBanners) return 'limit';
    return null;
  }

  adStarted(): void {
    this.adActive = true;
  }

  midgameDone(): void {
    this.adActive = false;
    this.lastMidgameAt = this.now();
  }

  rewardedDone(): void {
    this.adActive = false;
    this.lastRewardedAt = this.now();
    this.gameplaySinceRewarded = false;
  }

  adFailed(): void {
    this.adActive = false;
  }

  bannerShown(containerId: string): void {
    this.banners.add(containerId);
  }

  bannerHidden(containerId: string): void {
    this.banners.delete(containerId);
  }

  /** Banners must go when gameplay resumes. Returns the ids to hide. */
  bannersToHide(): string[] {
    const ids = [...this.banners];
    this.banners.clear();
    return ids;
  }
}
