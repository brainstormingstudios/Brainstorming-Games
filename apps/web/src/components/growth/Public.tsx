'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BellPlus, BellRing, CalendarDays, Flag, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Dialog, EmptyState, SelectField, Skeleton, TextAreaField, buttonClass, chipClass, cn } from '@brainstorming/ui';
import { GameTile } from '@/components/catalogue/GameTile';
import { useAction } from '@/components/player/common';
import { NotFoundView } from '@/components/shell/NotFoundView';
import { Link, useLocale } from '@/i18n/navigation';
import { requestLogin } from '@/lib/auth/loginPrompt';
import { getRepo } from '@/lib/data';
import { jamIsOpen, jamPhase, type Jam, type ReportInput } from '@/lib/data/growthTypes';
import type { GameSummary } from '@/lib/data/types';
import { Markdown } from '@/lib/domain/markdown';
import { formatDate, gameHref } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';

/** Follow a studio to hear about its devlogs. Guests are asked to log in first. */
export function FollowButton({ studioId }: { studioId: string }) {
  const t = useTranslations('growth');
  const { user } = useSession();
  const act = useAction();
  const following = useRepoQuery((repo) => repo.growth.following(studioId), [studioId, user?.id], { topics: ['studio', 'session'] });
  const on = following.data ?? false;
  return (
    <Button
      variant={on ? 'secondary' : 'primary'}
      aria-pressed={on}
      data-testid="follow-button"
      icon={on ? <BellRing aria-hidden="true" className="size-4" /> : <BellPlus aria-hidden="true" className="size-4" />}
      onClick={() => {
        if (!user?.username) return void requestLogin();
        void act(async () => (await getRepo()).growth.setFollowing(studioId, !on), on ? t('unfollowed') : t('followed'));
      }}
    >
      {on ? t('following') : t('follow')}
    </Button>
  );
}

/** A report dialog for studios, devlogs and players. Reports go to the moderation queue. */
export function ReportLink({ target, className }: { target: Omit<ReportInput, 'reason'>; className?: string }) {
  const t = useTranslations('growth');
  const tc = useTranslations('common');
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const ok = await act(async () => {
      await (await getRepo()).growth.report({ ...target, reason });
      return true;
    }, t('reportSent'));
    setBusy(false);
    if (ok) {
      setOpen(false);
      setReason('');
    }
  };
  return (
    <>
      <button
        type="button"
        data-testid="report-link"
        onClick={() => setOpen(true)}
        className={cn('inline-flex items-center gap-1 text-sm font-bold text-fg-muted hover:text-fg', className)}
      >
        <Flag aria-hidden="true" className="size-4" />
        {t('report')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('reportTitle')}
        description={t('reportIntro')}
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button loading={busy} disabled={reason.trim().length < 5} onClick={() => void send()} data-testid="report-send">
              {t('reportSend')}
            </Button>
          </>
        }
      >
        <TextAreaField label={t('reportReason')} rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="report-reason" />
      </Dialog>
    </>
  );
}

/** Published devlogs: the whole site's (blog), one studio's or one game's. Renders nothing when empty unless `emptyTitle` is set. */
export function DevlogFeed({ studioSlug, gameId, heading, emptyTitle, limit = 30 }: { studioSlug?: string; gameId?: string; heading?: string; emptyTitle?: string; limit?: number }) {
  const t = useTranslations('growth');
  const locale = useLocale();
  const feed = useRepoQuery((repo) => repo.growth.devlogFeed({ studioSlug, gameId, limit }), [studioSlug, gameId, limit], { topics: ['devlogs'] });
  const posts = feed.data ?? [];
  if (feed.loading && !feed.data) return emptyTitle ? <Skeleton className="h-40 w-full" /> : null;
  if (posts.length === 0) return emptyTitle ? <EmptyState title={emptyTitle} description={t('blogEmptyBody')} size="sm" /> : null;
  return (
    <section aria-label={heading ?? t('devlogs')} className="mt-7" data-testid="devlog-feed">
      {heading ? <h2 className="mb-3 text-xl font-semibold sm:text-2xl">{heading}</h2> : null}
      <div className="flex flex-col gap-3">
        {posts.map((post) => (
          <article key={post.id} className="rounded-card border border-border bg-surface p-4" data-testid="devlog-post">
            <h3 className="font-display text-lg font-semibold">{post.title}</h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
              <span>{formatDate(post.publishedAt, locale)}</span>
              {!studioSlug ? (
                <Link href={`/studio/${post.studioSlug}`} hard className="font-bold text-link underline underline-offset-4">
                  {post.studioName}
                </Link>
              ) : null}
              {post.gameSlug && !gameId ? (
                <Link href={gameHref(post.gameSlug)} hard className="font-bold text-link underline underline-offset-4">
                  {post.gameTitle}
                </Link>
              ) : null}
              <ReportLink target={{ kind: 'devlog', targetType: 'devlog', targetId: post.id }} className="ml-auto" />
            </p>
            <div className="prose-bg mt-2 text-sm">
              <Markdown source={post.bodyMd} baseHeading={4} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function BlogPage() {
  const t = useTranslations('growth');
  return (
    <div className="page max-w-3xl!" data-testid="blog-page">
      <h1 className="text-3xl font-bold sm:text-4xl">{t('blogTitle')}</h1>
      <p className="mt-1.5 text-fg-muted">{t('blogIntro')}</p>
      <DevlogFeed emptyTitle={t('blogEmpty')} limit={50} />
    </div>
  );
}

const PHASE_TONE = { upcoming: 'warning', open: 'success', ended: 'neutral' } as const;

function JamDates({ jam }: { jam: Jam }) {
  const locale = useLocale();
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
      <CalendarDays aria-hidden="true" className="size-4" />
      {formatDate(jam.startsAt, locale)} – {formatDate(jam.endsAt, locale)}
    </span>
  );
}

export function JamsPage() {
  const t = useTranslations('growth');
  const jams = useRepoQuery((repo) => repo.growth.jams(), [], { topics: ['jams'] });
  return (
    <div className="page" data-testid="jams-page">
      <h1 className="text-3xl font-bold sm:text-4xl">{t('jamsTitle')}</h1>
      <p className="mt-1.5 max-w-2xl text-fg-muted">{t('jamsIntro')}</p>
      <div className="mt-6">
        {jams.loading && !jams.data ? (
          <Skeleton className="h-40 w-full" />
        ) : (jams.data ?? []).length === 0 ? (
          <EmptyState title={t('jamsEmpty')} description={t('jamsEmptyBody')} />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {(jams.data ?? []).map((jam) => {
              const phase = jamPhase(jam);
              return (
                <li key={jam.id}>
                  <Link href={`/jams/view?slug=${jam.slug}`} className="block" data-testid="jam-card">
                    <Card interactive className="flex h-full flex-col gap-2 p-4">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-xl font-semibold">{jam.title}</span>
                        <Badge tone={PHASE_TONE[phase]}>{t(`phase.${phase}`)}</Badge>
                      </span>
                      {jam.theme ? <span className="text-sm font-bold">{t('theme', { theme: jam.theme })}</span> : null}
                      <JamDates jam={jam} />
                      <span className="text-sm text-fg-muted">{t('entries', { count: jam.entries })}</span>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Lets a studio owner enter one of their games while the jam is open. */
function JamEntryForm({ jamId, entered }: { jamId: string; entered: Set<string> }) {
  const t = useTranslations('growth');
  const { user } = useSession();
  const act = useAction();
  const games = useRepoQuery(
    async (repo) => (user?.username && (await repo.dev.myStudio()) ? repo.dev.myGames() : []),
    [user?.id, user?.username],
    { topics: ['dev-games', 'studio'] },
  );
  const [gameId, setGameId] = useState('');
  const mine = games.data ?? [];
  const free = mine.filter((g) => !entered.has(g.id));
  const joined = mine.filter((g) => entered.has(g.id));
  return (
    <Card className="mt-5 flex flex-col gap-3 p-4" data-testid="jam-entry-form">
      <h2 className="font-display text-lg font-semibold">{t('enterTitle')}</h2>
      {mine.length === 0 ? (
        <>
          <p className="text-sm text-fg-muted">{t('enterNeedsGame')}</p>
          <Link href="/dev" className={cn(buttonClass({ variant: 'secondary' }), 'self-start')}>
            {t('openPortal')}
          </Link>
        </>
      ) : (
        <>
          {free.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <SelectField
                label={t('enterGame')}
                className="min-w-56"
                value={gameId || free[0]!.id}
                onChange={(e) => setGameId(e.target.value)}
                options={free.map((g) => ({ value: g.id, label: g.title }))}
                data-testid="jam-game-select"
              />
              <Button onClick={() => void act(async () => (await getRepo()).growth.enterJam(jamId, gameId || free[0]!.id), t('entered'))} data-testid="jam-enter">
                {t('enter')}
              </Button>
            </div>
          ) : null}
          {joined.map((g) => (
            <p key={g.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="success">{t('yourEntry')}</Badge>
              <span className="font-bold">{g.title}</span>
              <button type="button" className={chipClass(false)} onClick={() => void act(async () => (await getRepo()).growth.leaveJam(jamId, g.id), t('withdrawn'))}>
                {t('withdraw')}
              </button>
            </p>
          ))}
        </>
      )}
    </Card>
  );
}

export function JamPage() {
  const t = useTranslations('growth');
  const slug = useSearchParams().get('slug') ?? '';
  const jam = useRepoQuery((repo) => repo.growth.jam(slug), [slug], { topics: ['jams', 'catalogue'] });
  const j = jam.data;
  if (!j) return jam.loading ? <Skeleton className="mx-auto mt-8 h-64 w-full max-w-4xl" /> : <NotFoundView title={t('jamNotFound')} />;
  const phase = jamPhase(j);
  const visible = j.entryList.filter((e): e is typeof e & { game: GameSummary } => e.game != null);
  const hidden = j.entryList.length - visible.length;
  return (
    <div className="page" data-testid="jam-page">
      <Link href="/jams" className="text-sm font-bold text-fg-muted hover:text-fg">
        ← {t('jamsTitle')}
      </Link>
      <header className="mt-2 rounded-card border border-border bg-surface p-5">
        <h1 className="flex flex-wrap items-center gap-2 text-3xl font-bold">
          {j.title}
          <Badge tone={PHASE_TONE[phase]}>{t(`phase.${phase}`)}</Badge>
        </h1>
        {j.theme ? <p className="mt-1 font-bold">{t('theme', { theme: j.theme })}</p> : null}
        <p className="mt-1">
          <JamDates jam={j} />
        </p>
        {j.descriptionMd ? (
          <div className="prose-bg mt-3 max-w-3xl text-sm">
            <Markdown source={j.descriptionMd} baseHeading={2} />
          </div>
        ) : null}
      </header>
      {jamIsOpen(j) ? <JamEntryForm jamId={j.id} entered={new Set(j.entryList.map((e) => e.gameId))} /> : null}
      <section aria-labelledby="jam-entries" className="mt-7">
        <h2 id="jam-entries" className="mb-3 text-xl font-semibold sm:text-2xl">
          {t('entriesTitle')} <span className="text-base font-semibold text-fg-muted">{t('entries', { count: j.entryList.length })}</span>
        </h2>
        {visible.length === 0 ? (
          <EmptyState title={t('noEntries')} description={hidden > 0 ? t('entriesInReview', { count: hidden }) : t('noEntriesBody')} size="sm" />
        ) : (
          <>
            <ul className="game-grid">
              {visible.map((e) => (
                <li key={e.gameId} data-testid="jam-entry">
                  {e.rank != null ? (
                    <span className="mb-1 inline-flex items-center gap-1 text-sm font-extrabold text-glow">
                      <Trophy aria-hidden="true" className="size-4" />
                      {t('rank', { rank: e.rank })}
                    </span>
                  ) : null}
                  <GameTile game={e.game} />
                  <span className="block truncate px-1 text-xs text-fg-muted">{e.studioName}</span>
                </li>
              ))}
            </ul>
            {hidden > 0 ? <p className="mt-3 text-sm text-fg-muted">{t('entriesInReview', { count: hidden })}</p> : null}
          </>
        )}
      </section>
    </div>
  );
}

const SCALE = [1, 2, 3, 4, 5] as const;

/**
 * The three-question playtest survey. Shown under a Spark game to signed-in players who joined
 * the playtest panel in their settings and have not answered for this game yet.
 */
export function PlaytestCard({ game }: { game: Pick<GameSummary, 'id' | 'status' | 'title'> }) {
  const t = useTranslations('growth');
  const { user } = useSession();
  const act = useAction();
  const eligible = Boolean(user?.username && user.playtestOptIn && game.status === 'spark');
  const answered = useRepoQuery((repo) => repo.growth.playtestAnswered(game.id), [game.id, user?.id], { enabled: eligible });
  const [fun, setFun] = useState(0);
  const [clarity, setClarity] = useState(0);
  const [again, setAgain] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  if (!eligible || answered.data !== false || done) return null;
  const scale = (label: string, low: string, high: string, value: number, set: (n: number) => void, id: string) => (
    <fieldset>
      <legend className="text-sm font-bold">{label}</legend>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-fg-muted">{low}</span>
        {SCALE.map((n) => (
          <button key={n} type="button" aria-pressed={value === n} className={chipClass(value === n)} onClick={() => set(n)} data-testid={`playtest-${id}-${n}`}>
            {n}
          </button>
        ))}
        <span className="text-xs text-fg-muted">{high}</span>
      </div>
    </fieldset>
  );
  return (
    <Card className="mt-3 flex flex-col gap-3 border-glow/50 p-4" data-testid="playtest-card">
      <div>
        <h2 className="font-display text-lg font-semibold">{t('playtestTitle')}</h2>
        <p className="text-sm text-fg-muted">{t('playtestIntro', { title: game.title })}</p>
      </div>
      {scale(t('playtestFun'), t('playtestFunLow'), t('playtestFunHigh'), fun, setFun, 'fun')}
      {scale(t('playtestClarity'), t('playtestClarityLow'), t('playtestClarityHigh'), clarity, setClarity, 'clarity')}
      <fieldset>
        <legend className="text-sm font-bold">{t('playtestAgain')}</legend>
        <div className="mt-1.5 flex gap-1.5">
          <button type="button" aria-pressed={again === true} className={chipClass(again === true)} onClick={() => setAgain(true)} data-testid="playtest-again-yes">
            {t('yes')}
          </button>
          <button type="button" aria-pressed={again === false} className={chipClass(again === false)} onClick={() => setAgain(false)}>
            {t('no')}
          </button>
        </div>
      </fieldset>
      <Button
        className="self-start"
        disabled={!fun || !clarity || again == null}
        data-testid="playtest-send"
        onClick={() =>
          void act(async () => {
            await (await getRepo()).growth.submitPlaytest(game.id, { fun, clarity, playAgain: again === true });
            setDone(true);
          }, t('playtestThanks'))
        }
      >
        {t('playtestSend')}
      </Button>
    </Card>
  );
}
