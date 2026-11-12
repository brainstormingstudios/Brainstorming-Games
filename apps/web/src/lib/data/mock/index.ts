import { PLAY_ORIGIN } from '@/lib/config';
import { emitTopic } from '../bus';
import { getAnonId, guestFavourites, guestHistory, guestRatings } from '../local';
import { RepoError, type AuthRepo, type EventsRepo, type PlayerRepo, type Repo } from '../repo';
import { mockAdmin } from './admin';
import { currentUserId, mockAuth } from './auth';
import { mockDev } from './dev';
import { mergeGuestSaves, mockQuests, mockSaves, mockScores } from './play';
import type { ControlRow, FaqItem, GameStatus, MediaAsset, Orientation, Platform } from '../types';
import { mockCatalogue, readCatalogueTables, statsFor } from './catalogue';
import {
  dayKey,
  mutateTable,
  newId,
  nowIso,
  readTable,
  resetMockDb,
  takeToken,
  type MockGame,
  type MockStudio,
  type MockVersion,
} from './db';

const voterKey = () => `anon:${getAnonId()}`;

const player: PlayerRepo = {
  async myRating(gameId) {
    return guestRatings.get(gameId);
  },
  async rate(gameId, value, reason = null) {
    if (!takeToken(`rate:${voterKey()}`, 20, 60_000)) throw new RepoError('rate_limited');
    const key = voterKey();
    mutateTable('ratings', (rows) => {
      const rest = rows.filter((r) => !(r.voterKey === key && r.gameId === gameId));
      if (value !== 0) {
        rest.push({ voterKey: key, gameId, value, reason: value === -1 ? reason : null, createdAt: nowIso() });
      }
      return rest;
    });
    guestRatings.set(gameId, value === 0 ? null : { value, reason: value === -1 ? reason : null });
    emitTopic('ratings');
    return statsFor(gameId, readCatalogueTables());
  },
  async favourites() {
    return guestFavourites.list();
  },
  async setFavourite(gameId, on) {
    guestFavourites.set(gameId, on);
    emitTopic('favourites');
  },
  async history() {
    return guestHistory.list();
  },
  async recordPlay(game, seconds, newSession) {
    guestHistory.record(game, seconds, newSession);
    emitTopic('history');
  },
  async clearHistory() {
    guestHistory.clear();
    emitTopic('history');
  },
  async sendFeedback(input) {
    if (!takeToken(`feedback:${voterKey()}`, 5, 600_000)) throw new RepoError('rate_limited');
    const message = input.message.trim().slice(0, 2000);
    if (message.length < 5) throw new RepoError('invalid', 'Message is too short');
    mutateTable('feedback', (rows) => {
      rows.push({ ...input, message, id: newId(), reporterKey: voterKey(), status: 'open', createdAt: nowIso() });
    });
    emitTopic('dev-games');
  },
};

const events: EventsRepo = {
  async ingest(batch, context) {
    if (batch.length === 0) return;
    if (!takeToken(`events:${context.anonId}`, 120, 60_000)) throw new RepoError('rate_limited');
    const playsByGame = new Map<string, number>();
    mutateTable('events', (rows) => {
      for (const e of batch.slice(0, 50)) {
        rows.push({
          id: newId(),
          anonId: context.anonId,
          userId: currentUserId(),
          sessionId: e.sessionId,
          gameId: e.gameId,
          versionId: e.versionId,
          type: e.type,
          ts: e.ts,
          payload: e.payload,
          country: null,
          device: context.device,
          refStudio: context.refStudio,
        });
        if (e.type === 'play_click' && e.gameId) {
          playsByGame.set(e.gameId, (playsByGame.get(e.gameId) ?? 0) + 1);
        }
      }
    });
    if (playsByGame.size > 0) {
      const today = dayKey();
      const cutoff = dayKey(new Date(Date.now() - 30 * 86_400_000));
      mutateTable('gameStats', (rows) => {
        for (const [gameId, n] of playsByGame) {
          let row = rows.find((r) => r.gameId === gameId);
          if (!row) {
            row = { gameId, plays: 0, playsByDay: {} };
            rows.push(row);
          }
          row.plays += n;
          row.playsByDay[today] = (row.playsByDay[today] ?? 0) + n;
          for (const day of Object.keys(row.playsByDay)) if (day < cutoff) delete row.playsByDay[day];
        }
      });
      emitTopic('catalogue');
    }
  },
  ingestOnUnload(batch, context) {
    // localStorage writes are synchronous, so the normal path is already unload-safe.
    void this.ingest(batch, context).catch(() => {});
  },
};

/** Input for adding a published game straight into the mock database (tests and local demos). */
export interface MockGameInput {
  slug: string;
  title: string;
  shortDescription?: string;
  descriptionMd?: string;
  howToPlayMd?: string;
  featuresMd?: string;
  tipsMd?: string;
  controls?: ControlRow[];
  faq?: FaqItem[];
  category?: string;
  tags?: string[];
  orientation?: Orientation;
  platforms?: Platform[];
  engine?: string | null;
  isMultiplayer?: boolean;
  schoolSafe?: boolean;
  sizeBytes?: number;
  status?: GameStatus;
  /** Folder of the build on the play origin, e.g. `sdk-probe/1`. */
  storagePrefix?: string;
  entryFile?: string;
  usesSdk?: boolean;
  version?: string;
  studio?: { slug: string; name: string; country?: string | null; isFirstParty?: boolean };
  media?: MediaAsset[];
}

function ensureStudio(input: NonNullable<MockGameInput['studio']>): MockStudio {
  let studio = readTable('studios').find((s) => s.slug === input.slug);
  if (studio) return studio;
  studio = {
    id: newId(),
    ownerId: null,
    slug: input.slug,
    name: input.name,
    bio: '',
    avatarUrl: null,
    country: input.country ?? null,
    contactEmail: null,
    links: [],
    verified: false,
    isFirstParty: input.isFirstParty ?? false,
    level: 'rookie',
    suspendedAt: null,
    termsVersion: null,
    termsAcceptedAt: null,
    guardianName: null,
    createdAt: nowIso(),
  };
  const created = studio;
  mutateTable('studios', (rows) => {
    rows.push(created);
  });
  return created;
}

/** Developer and test helpers, exposed as `window.__bgMock` in mock mode only. */
export const mockTools = {
  playOrigin: PLAY_ORIGIN,
  /** Adds a game (public by default) and returns its id. An existing slug is replaced. */
  addGame(input: MockGameInput): string {
    const studio = ensureStudio(input.studio ?? { slug: 'test-studio', name: 'Test Studio' });
    const now = nowIso();
    const id = newId();
    const versionId = newId();
    const status = input.status ?? 'spark';
    const version: MockVersion = {
      id: versionId,
      gameId: id,
      version: input.version ?? '1',
      storagePrefix: input.storagePrefix ?? `${id}/1`,
      fileCount: 1,
      totalBytes: input.sizeBytes ?? 20_000,
      entryFile: input.entryFile ?? 'index.html',
      usesSdk: input.usesSdk ?? false,
      preQaReport: null,
      qaStatus: 'approved',
      qaNotes: null,
      previewToken: newId(),
      createdAt: now,
    };
    const game: MockGame = {
      id,
      studioId: studio.id,
      slug: input.slug,
      title: input.title,
      shortDescription: input.shortDescription ?? '',
      descriptionMd: input.descriptionMd ?? '',
      howToPlayMd: input.howToPlayMd ?? '',
      controls: input.controls ?? [],
      faq: input.faq ?? [],
      featuresMd: input.featuresMd ?? '',
      tipsMd: input.tipsMd ?? '',
      category: input.category ?? 'arcade',
      tags: input.tags ?? [],
      orientation: input.orientation ?? 'landscape',
      platforms: input.platforms ?? ['desktop', 'mobile', 'tablet'],
      engine: input.engine ?? null,
      isMultiplayer: input.isMultiplayer ?? false,
      hasProgress: false,
      schoolSafe: input.schoolSafe ?? false,
      sizeBytes: input.sizeBytes ?? 20_000,
      initialLoadBytes: null,
      status,
      sparkStartedAt: status === 'spark' ? now : null,
      riseStartedAt: status === 'rise' || status === 'featured' ? now : null,
      exclusiveUntil: null,
      currentVersionId: versionId,
      maxScorePerSec: null,
      createdAt: now,
      releasedAt: now,
      updatedAt: now,
    };
    const old = readTable('games').find((g) => g.slug === input.slug);
    if (old) this.removeGame(old.id);
    mutateTable('games', (rows) => {
      rows.push(game);
    });
    mutateTable('versions', (rows) => {
      rows.push(version);
    });
    if (input.media?.length) {
      mutateTable('media', (rows) => {
        for (const m of input.media!) rows.push({ ...m, id: newId(), gameId: id, isActive: true, createdAt: now });
      });
    }
    emitTopic('catalogue');
    return id;
  },
  removeGame(gameId: string): void {
    mutateTable('games', (rows) => rows.filter((g) => g.id !== gameId));
    mutateTable('versions', (rows) => rows.filter((v) => v.gameId !== gameId));
    mutateTable('media', (rows) => rows.filter((m) => m.gameId !== gameId));
    mutateTable('ratings', (rows) => rows.filter((r) => r.gameId !== gameId));
    mutateTable('gameStats', (rows) => rows.filter((s) => s.gameId !== gameId));
    emitTopic('catalogue');
  },
  /** Clears every mock table. Guest data (favourites, history) is separate and kept. */
  reset(): void {
    resetMockDb();
    emitTopic('catalogue');
  },
  tables: readTable,
};

export type MockTools = typeof mockTools;

declare global {
  interface Window {
    __bgMock?: MockTools;
  }
}

/** Guest saves move into the account the first time a player signs in. */
const auth: AuthRepo = {
  ...mockAuth,
  async signInWithEmail(email, next) {
    const result = await mockAuth.signInWithEmail(email, next);
    const id = currentUserId();
    if (id) mergeGuestSaves(id);
    return result;
  },
  async signInWithProvider(provider, next) {
    await mockAuth.signInWithProvider(provider, next);
    const id = currentUserId();
    if (id) mergeGuestSaves(id);
  },
};

export function createMockRepo(): Repo {
  if (typeof window !== 'undefined') window.__bgMock = mockTools;
  return {
    mode: 'mock',
    catalogue: mockCatalogue,
    player,
    events,
    auth,
    saves: mockSaves,
    scores: mockScores,
    quests: mockQuests,
    dev: mockDev,
    admin: mockAdmin,
  };
}
