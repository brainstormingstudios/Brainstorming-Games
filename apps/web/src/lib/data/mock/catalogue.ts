import { applyQuery } from '@/lib/catalogue/listings';
import { searchGames } from '@/lib/catalogue/search';
import { bayesianRating10, isVoteInWindow } from '@/lib/domain/rating';
import type { CatalogueRepo } from '../repo';
import {
  PUBLIC_STATUSES,
  type GameDetail,
  type GameStats,
  type GameSummary,
  type MediaAsset,
  type MediaKind,
  type StudioDetail,
} from '../types';
import {
  readSiteConfig,
  readTable,
  type MockGame,
  type MockMedia,
  type MockStudio,
  type MockTables,
} from './db';

/** One consistent read of the tables a catalogue query joins. */
export interface CatalogueTables {
  studios: MockTables['studios'];
  games: MockTables['games'];
  versions: MockTables['versions'];
  media: MockTables['media'];
  ratings: MockTables['ratings'];
  gameStats: MockTables['gameStats'];
}

export function readCatalogueTables(): CatalogueTables {
  return {
    studios: readTable('studios'),
    games: readTable('games'),
    versions: readTable('versions'),
    media: readTable('media'),
    ratings: readTable('ratings'),
    gameStats: readTable('gameStats'),
  };
}

export function statsFor(gameId: string, t: Pick<CatalogueTables, 'ratings' | 'gameStats'>): GameStats {
  const now = new Date();
  let likes = 0;
  let dislikes = 0;
  for (const r of t.ratings) {
    if (r.gameId !== gameId || !isVoteInWindow(r.createdAt, now)) continue;
    if (r.value === 1) likes++;
    else dislikes++;
  }
  const row = t.gameStats.find((s) => s.gameId === gameId);
  let plays7d = 0;
  if (row) {
    const cutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    for (const [day, n] of Object.entries(row.playsByDay)) if (day >= cutoff) plays7d += n;
  }
  return {
    plays: row?.plays ?? 0,
    plays7d,
    rating10: bayesianRating10(likes, dislikes),
    votes: likes + dislikes,
    likes,
    dislikes,
  };
}

const toAsset = (m: MockMedia): MediaAsset => ({
  kind: m.kind,
  url: m.url,
  widths: m.widths,
  width: m.width,
  height: m.height,
  placeholder: m.placeholder,
  variantLabel: m.variantLabel,
});

export function toStudioRef(s: MockStudio) {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    country: s.country,
    isFirstParty: s.isFirstParty,
    verified: s.verified,
  };
}

const UNKNOWN_STUDIO = {
  id: '',
  slug: 'unknown',
  name: 'Unknown studio',
  country: null,
  isFirstParty: false,
  verified: false,
};

export function toSummary(game: MockGame, t: CatalogueTables): GameSummary {
  const studio = t.studios.find((s) => s.id === game.studioId);
  const version = t.versions.find((v) => v.id === game.currentVersionId) ?? null;
  const media = t.media.filter((m) => m.gameId === game.id && m.isActive);
  const first = (kind: MediaKind) => {
    const all = media.filter((m) => m.kind === kind);
    const main = all.find((m) => m.variantLabel == null || m.variantLabel === 'A') ?? all[0];
    return main ? toAsset(main) : null;
  };
  return {
    id: game.id,
    slug: game.slug,
    title: game.title,
    shortDescription: game.shortDescription,
    category: game.category,
    tags: game.tags,
    orientation: game.orientation,
    platforms: game.platforms,
    isMultiplayer: game.isMultiplayer,
    sizeBytes: game.sizeBytes,
    initialLoadBytes: game.initialLoadBytes,
    status: game.status,
    schoolSafe: game.schoolSafe,
    releasedAt: game.releasedAt,
    updatedAt: game.updatedAt,
    sparkStartedAt: game.sparkStartedAt,
    studio: studio ? toStudioRef(studio) : UNKNOWN_STUDIO,
    cover: first('cover_landscape'),
    coverPortrait: first('cover_portrait'),
    coverSquare: first('cover_square'),
    preview: first('preview_landscape'),
    previewPortrait: first('preview_portrait'),
    coverVariants: media
      .filter((m) => m.kind === 'cover_landscape' && m.variantLabel != null)
      .map(toAsset),
    stats: statsFor(game.id, t),
    versionId: version?.id ?? null,
    version: version?.version ?? null,
    playPath: version ? `${version.storagePrefix}/${version.entryFile}` : null,
    usesSdk: version?.usesSdk ?? false,
  };
}

export function toDetail(game: MockGame, t: CatalogueTables): GameDetail {
  return {
    ...toSummary(game, t),
    descriptionMd: game.descriptionMd,
    howToPlayMd: game.howToPlayMd,
    controls: game.controls,
    faq: game.faq,
    featuresMd: game.featuresMd,
    tipsMd: game.tipsMd,
    engine: game.engine,
    hasProgress: game.hasProgress,
    exclusiveUntil: game.exclusiveUntil,
    createdAt: game.createdAt,
    devlogs: [],
  };
}

export function toStudioDetail(s: MockStudio): StudioDetail {
  return {
    ...toStudioRef(s),
    bio: s.bio,
    avatarUrl: s.avatarUrl,
    links: s.links,
    level: s.level,
    followers: readTable('followers').filter((f) => f.studioId === s.id).length,
    createdAt: s.createdAt,
  };
}

/** All games a player can see, as summaries. Suspended studios are hidden. */
export function publicSummaries(t: CatalogueTables = readCatalogueTables()): GameSummary[] {
  const suspended = new Set(t.studios.filter((s) => s.suspendedAt).map((s) => s.id));
  return t.games
    .filter((g) => PUBLIC_STATUSES.includes(g.status) && !suspended.has(g.studioId))
    .map((g) => toSummary(g, t));
}

export const mockCatalogue: CatalogueRepo = {
  async list(query = {}) {
    const t = readCatalogueTables();
    if (query.changedSince) {
      // Include games that stopped being public so pre-rendered lists can drop them.
      const since = query.changedSince;
      const changed = t.games.filter((g) => g.updatedAt > since).map((g) => toSummary(g, t));
      return { items: changed, total: changed.length };
    }
    return applyQuery(publicSummaries(t), query);
  },
  async get(slug) {
    const t = readCatalogueTables();
    const game = t.games.find((g) => g.slug === slug && PUBLIC_STATUSES.includes(g.status));
    return game ? toDetail(game, t) : null;
  },
  async byIds(ids) {
    const all = new Map(publicSummaries().map((g) => [g.id, g]));
    return ids.map((id) => all.get(id)).filter((g): g is GameSummary => g != null);
  },
  async studio(slug) {
    const s = readTable('studios').find((x) => x.slug === slug && !x.suspendedAt);
    return s ? toStudioDetail(s) : null;
  },
  async search(text, limit = 24) {
    return searchGames(text, publicSummaries()).slice(0, limit);
  },
  async siteConfig() {
    return readSiteConfig();
  },
};
