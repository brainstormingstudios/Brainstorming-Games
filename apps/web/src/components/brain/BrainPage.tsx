'use client';

import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Copy, Share2, Swords } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, Card, EmptyState, Skeleton, Switch, TextField, buttonClass, cn, useToast } from '@brainstorming/ui';
import { Link, useLocale } from '@/i18n/navigation';
import { localizePath } from '@/i18n/config';
import { requestLogin } from '@/lib/auth/loginPrompt';
import { SITE_URL } from '@/lib/config';
import { getRepo } from '@/lib/data';
import { SKILLS, computeBrainProfile, weeklyChange, type BrainProfile, type Skill } from '@/lib/domain/brain';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';
import { RadarChart } from './RadarChart';

/** One colour per skill for the learning-time bars (also named in the legend). */
export const SKILL_COLOUR: Record<Skill, string> = {
  memory: 'bg-[#a78bfa]',
  logic: 'bg-[#00c0f0]',
  speed: 'bg-[#f59e0b]',
  focus: 'bg-[#34d399]',
  strategy: 'bg-[#f472b6]',
};

export function useSkillLabels() {
  const t = useTranslations('brain');
  return Object.fromEntries(SKILLS.map((s) => [s, t(`skills.${s}.name`)])) as Record<Skill, string>;
}

function Change({ week, prev }: { week: number; prev: number }) {
  const t = useTranslations('brain');
  const pct = weeklyChange(week, prev);
  if (pct == null) return week > 0 ? <span className="text-xs font-bold text-success light:text-navy-950">{t('newThisWeek')}</span> : null;
  const up = pct >= 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-bold', up ? 'text-success light:text-navy-950' : 'text-fg-muted')}>
      {up ? <ArrowUp aria-hidden="true" className="size-3.5" /> : <ArrowDown aria-hidden="true" className="size-3.5" />}
      {t(up ? 'up' : 'down', { pct: Math.abs(pct) })}
    </span>
  );
}

/** Minutes per skill per day for the last 7 days: the parents' and teachers' view. */
export function LearningTime({ profile }: { profile: BrainProfile }) {
  const t = useTranslations('brain');
  const locale = useLocale();
  const labels = useSkillLabels();
  const max = Math.max(10, ...profile.days.map((d) => SKILLS.reduce((n, s) => n + d.minutes[s], 0)));
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="brain-learning-time">
      <div>
        <h2 className="text-xl font-semibold">{t('learningTitle')}</h2>
        <p className="text-sm text-fg-muted">{t('learningIntro', { minutes: Math.round(profile.weekMinutes) })}</p>
      </div>
      <div className="flex h-40 items-end gap-2" role="img" aria-label={t('learningChart', { minutes: Math.round(profile.weekMinutes) })}>
        {profile.days.map((d) => {
          const total = SKILLS.reduce((n, s) => n + d.minutes[s], 0);
          return (
            <div key={d.day} className="flex h-full flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 flex-col-reverse overflow-hidden rounded-t-md bg-surface-3">
                {SKILLS.map((s) =>
                  d.minutes[s] > 0 ? <div key={s} className={SKILL_COLOUR[s]} style={{ height: `${(d.minutes[s] / max) * 100}%` }} title={`${labels[s]}: ${Math.round(d.minutes[s])} min`} /> : null,
                )}
              </div>
              <span className="text-[11px] font-bold text-fg-muted">{new Date(`${d.day}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })}</span>
              <span className="text-[11px] text-fg-muted tabular-nums">{Math.round(total)}m</span>
            </div>
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-3 text-xs">
        {SKILLS.map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span className={cn('size-3 rounded-sm', SKILL_COLOUR[s])} />
            {labels[s]}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Challenge({ username }: { username: string | null }) {
  const t = useTranslations('brain');
  const toast = useToast();
  const locale = useLocale();
  const [other, setOther] = useState('');
  const link = username ? `${SITE_URL}/brain/compare/?u=${username}` : null;
  const go = (e: FormEvent) => {
    e.preventDefault();
    const name = other.trim().toLowerCase();
    if (/^[a-z0-9_]{3,20}$/.test(name)) window.location.assign(localizePath(`/brain/compare/?u=${name}`, locale));
  };
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="brain-challenge">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <Swords aria-hidden="true" className="size-5 text-primary" />
        {t('challengeTitle')}
      </h2>
      {link ? (
        <>
          <p className="text-sm text-fg-muted">{t('challengeIntro')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-control bg-surface-3 px-3 py-2 text-sm break-all" data-testid="brain-challenge-link">
              {link}
            </code>
            <Button size="sm" variant="secondary" icon={<Copy aria-hidden="true" className="size-4" />} onClick={() => void navigator.clipboard.writeText(link).then(() => toast(t('copied'), { tone: 'success' }))}>
              {t('copy')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={<Share2 aria-hidden="true" className="size-4" />}
              onClick={() => void (navigator.share ? navigator.share({ title: t('shareTitle'), text: t('shareText'), url: link }).catch(() => {}) : navigator.clipboard.writeText(link).then(() => toast(t('copied'), { tone: 'success' })))}
            >
              {t('share')}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-fg-muted">{t('challengeSignIn')}</p>
      )}
      <form onSubmit={go} className="flex flex-wrap items-end gap-2">
        <TextField label={t('compareWith')} className="min-w-48 flex-1" value={other} onChange={(e) => setOther(e.target.value)} placeholder="username" data-testid="brain-compare-input" />
        <Button type="submit" variant="outline" data-testid="brain-compare-go">
          {t('compare')}
        </Button>
      </form>
    </Card>
  );
}

/** "Your Brain Profile": what your games trained, as a radar chart, scores and learning time. */
export function BrainPage() {
  const t = useTranslations('brain');
  const { user, ready } = useSession();
  const labels = useSkillLabels();
  const data = useRepoQuery((repo) => repo.brain.mine(), [user?.id], { topics: ['history', 'session', 'catalogue'] });
  const report = useRepoQuery((repo) => repo.brain.reportEnabled(), [user?.id], { topics: ['profile', 'session'] });
  const profile = useMemo(() => (data.data ? computeBrainProfile(data.data.rows, data.data.skills) : null), [data.data]);

  if (!ready || !profile) return <div className="page"><Skeleton className="h-96 w-full" /></div>;

  return (
    <div className="page flex flex-col gap-5" data-testid="brain-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="max-w-2xl text-sm text-fg-muted">{t('intro')}</p>
        </div>
        {!user ? (
          <Button variant="outline" onClick={() => void requestLogin()}>
            {t('signInToKeep')}
          </Button>
        ) : null}
      </div>

      {profile.top == null ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyBody')}
          art="happy"
          action={
            <Link href="/originals" className={buttonClass({})}>
              {t('emptyCta')}
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
            <Card className="flex flex-col items-center gap-3 p-4">
              <div className="text-center">
                <p className="text-xs font-bold tracking-wide text-fg-muted uppercase">{t('brainScore')}</p>
                <p className="font-display text-5xl font-bold text-primary" data-testid="brain-score">
                  {profile.brainScore}
                </p>
                <Badge tone="glow" className="mt-1" data-testid="brain-type">
                  {t(`skills.${profile.top}.type`)}
                </Badge>
              </div>
              <RadarChart series={[{ label: t('you'), values: profile.scores, colorClass: 'text-primary' }]} labels={labels} />
            </Card>
            <ul className="grid content-start gap-3 sm:grid-cols-2">
              {SKILLS.map((s) => (
                <li key={s}>
                  <Card className="flex h-full flex-col gap-1 p-3" data-testid="brain-skill" data-skill={s}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{labels[s]}</span>
                      <span className="font-display text-2xl font-bold tabular-nums">{profile.scores[s]}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                      <div className={cn('h-full rounded-full', SKILL_COLOUR[s])} style={{ width: `${profile.scores[s]}%` }} />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
                      <span>{t('weekMinutes', { minutes: profile.week[s] > 0 && profile.week[s] < 1 ? '<1' : Math.round(profile.week[s]) })}</span>
                      <Change week={profile.week[s]} prev={profile.prevWeek[s]} />
                    </div>
                    <p className="text-xs text-fg-muted">{t(`skills.${s}.about`)}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
          <LearningTime profile={profile} />
        </>
      )}

      <Challenge username={user?.username ?? null} />

      {user ? (
        <Card className="p-4">
          <Switch
            label={t('reportLabel')}
            description={t('reportHint')}
            checked={report.data ?? true}
            onChange={(e) => {
              const on = e.target.checked;
              void getRepo().then((repo) => repo.brain.setReport(on));
            }}
            data-testid="brain-report-toggle"
          />
        </Card>
      ) : null}
      <p className="text-xs text-fg-muted">{t('howItWorks')}</p>
    </div>
  );
}
