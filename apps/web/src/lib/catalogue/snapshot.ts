import raw from '@/generated/catalogue.json';
import {
  DEFAULT_SITE_CONFIG,
  type CatalogueSnapshot,
  type GameDetail,
  type GameSummary,
  type SiteConfig,
  type StudioDetail,
} from '@/lib/data/types';

/**
 * The catalogue as it was when this build started (written by scripts/build-catalogue.ts).
 * Import this from server components only: it can be large, and the client gets just the slices
 * a page passes down as props.
 */
const snapshot = raw as unknown as CatalogueSnapshot;

export const snapshotGeneratedAt = snapshot.generatedAt;

export function snapshotGames(): GameDetail[] {
  return snapshot.games ?? [];
}

/** Drops the long-form fields so lists passed to the client stay small. */
export function toSummary(game: GameDetail): GameSummary {
  const {
    descriptionMd: _d,
    howToPlayMd: _h,
    controls: _c,
    faq: _f,
    featuresMd: _fe,
    tipsMd: _t,
    engine: _e,
    hasProgress: _hp,
    exclusiveUntil: _x,
    createdAt: _ca,
    devlogs: _dl,
    ...summary
  } = game;
  return summary;
}

let summaries: GameSummary[] | null = null;

export function snapshotSummaries(): GameSummary[] {
  return (summaries ??= snapshotGames().map(toSummary));
}

export function snapshotGame(slug: string): GameDetail | null {
  return snapshotGames().find((g) => g.slug === slug) ?? null;
}

export function snapshotStudios(): StudioDetail[] {
  return snapshot.studios ?? [];
}

export function snapshotStudio(slug: string): StudioDetail | null {
  return snapshotStudios().find((s) => s.slug === slug) ?? null;
}

export function snapshotConfig(): SiteConfig {
  return { ...DEFAULT_SITE_CONFIG, ...(snapshot.config ?? {}) };
}
