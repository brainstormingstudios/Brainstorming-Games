'use client';

import { useTranslations } from 'next-intl';
import { Check, Flame, Lock, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  ConfettiBurst,
  MascotAvatar,
  ProgressBar,
  Skeleton,
  Tabs,
  buttonClass,
  cn,
  type AvatarCosmetics,
} from '@brainstorming/ui';
import { Link, useLocale } from '@/i18n/navigation';
import { requestLogin } from '@/lib/auth/loginPrompt';
import { getRepo } from '@/lib/data';
import type { LockerItem, QuestView } from '@/lib/data/repo';
import { pointsForLevel } from '@/lib/domain/progression';
import { formatDate } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';
import { RequireUser, useAction } from './common';

function QuestCard({ q }: { q: QuestView }) {
  const t = useTranslations('quests');
  return (
    <Card className={cn('flex flex-col gap-2 p-4', q.completed && 'border-success/60')} data-testid="quest" data-progress={q.progress}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">{q.title}</h3>
          <p className="text-sm text-fg-muted">{q.description}</p>
        </div>
        <Badge tone={q.completed ? 'success' : 'glow'}>{q.completed ? <Check aria-hidden="true" className="size-3.5" /> : null}{q.completed ? t('done') : t('reward', { points: q.reward })}</Badge>
      </div>
      <ProgressBar value={q.progress} max={q.target} label={q.title} tone={q.completed ? 'success' : 'glow'} />
      <p className="text-xs font-bold text-fg-muted">{t('progress', { progress: q.progress, target: q.target })}</p>
    </Card>
  );
}

export function QuestsPage() {
  const t = useTranslations('quests');
  const tp = useTranslations('player');
  const ta = useTranslations('auth');
  const locale = useLocale();
  const { user } = useSession();
  const summary = useRepoQuery((repo) => repo.quests.mine(locale), [locale, user?.id], { topics: ['quests', 'points', 'session'] });
  const ledger = useRepoQuery((repo) => repo.quests.ledger(), [user?.id], { topics: ['points'] });
  if (!summary.data) return <Skeleton className="h-96 w-full" />;
  const s = summary.data;
  const next = pointsForLevel(s.level + 1);
  return (
    <div className="flex flex-col gap-6" data-testid="quests-page">
      <header>
        <h1 className="text-3xl font-bold sm:text-4xl">{t('title')}</h1>
        <p className="mt-2 max-w-2xl text-fg-muted">{t('intro')}</p>
      </header>
      {user?.username ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs font-bold tracking-wide text-fg-muted uppercase">{tp('level', { level: s.level })}</p>
            <p className="font-display text-3xl font-bold text-glow" data-testid="brain-points">{tp('points', { count: s.brainPoints })}</p>
            <ProgressBar className="mt-2" value={s.lifetimePoints - pointsForLevel(s.level)} max={next - pointsForLevel(s.level)} label={t('levelProgress', { points: s.lifetimePoints, next, level: s.level + 1 })} />
            <p className="mt-1 text-xs text-fg-muted">{t('levelProgress', { points: s.lifetimePoints, next, level: s.level + 1 })}</p>
          </Card>
          <Card className="p-4 md:col-span-2">
            <p className="flex items-center gap-2 font-display text-xl font-semibold">
              <Flame aria-hidden="true" className="size-6 text-warning" />
              {t('streakTitle')}: {tp('streak', { count: s.streakDays })}
            </p>
            <p className="mt-1 text-sm text-fg-muted">{s.playedToday ? t('streakToday') : t('streakNotYet')}</p>
            <p className="mt-1 text-xs text-fg-muted">{t('streakBody')}</p>
          </Card>
        </div>
      ) : (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">{t('guestBody')}</p>
          <Button onClick={() => void requestLogin()}>{ta('logIn')}</Button>
        </Card>
      )}
      {(['daily', 'weekly'] as const).map((period) => (
        <section key={period} aria-labelledby={`q-${period}`}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={`q-${period}`} className="text-xl font-semibold">
              {t(period)}
            </h2>
            <span className="text-xs text-fg-muted">{period === 'daily' ? t('resetsDaily') : t('resetsWeekly')}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {s.quests.filter((q) => q.period === period).map((q) => (
              <QuestCard key={q.code} q={q} />
            ))}
          </div>
        </section>
      ))}
      {user?.username ? (
        <section aria-labelledby="ledger">
          <h2 id="ledger" className="mb-2 text-xl font-semibold">
            {t('history')}
          </h2>
          {(ledger.data ?? []).length === 0 ? (
            <p className="text-sm text-fg-muted">{t('noHistory')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
              {(ledger.data ?? []).slice(0, 20).map((l, i) => (
                <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>{t.has(`reasons.${l.reason}` as 'reasons.quest') ? t(`reasons.${l.reason}` as 'reasons.quest') : l.reason}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-fg-muted">{formatDate(l.createdAt, locale)}</span>
                    <span className={cn('font-extrabold', l.delta > 0 ? 'text-success' : 'text-fg-muted')}>{l.delta > 0 ? `+${l.delta}` : l.delta}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

const SLOTS: LockerItem['slot'][] = ['picture', 'colour', 'hat', 'glasses', 'headphones', 'glow', 'frame'];

/** Center-crops a photo to a 256 px square .webp (about 20 KB), so uploads stay small and private details in the file are dropped. */
async function squarePicture(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/webp', 0.85));
}

export function LockerPage() {
  return <RequireUser>{() => <Locker />}</RequireUser>;
}

function Locker() {
  const t = useTranslations('locker');
  const tp = useTranslations('player');
  const tq = useTranslations('quests');
  const locale = useLocale();
  const act = useAction();
  const { user } = useSession();
  const items = useRepoQuery((repo) => repo.locker.items(locale), [locale, user?.id], { topics: ['points', 'profile', 'session'] });
  const [slot, setSlot] = useState<string>('colour');
  const [look, setLook] = useState<AvatarCosmetics>({});
  const [burst, setBurst] = useState(0);
  // Try-on: hovering (or tapping) an item shows it on the big mascot before it is unlocked.
  const [tryOn, setTryOn] = useState<{ slot: string; code: string } | null>(null);
  const [mood, setMood] = useState<'happy' | 'wow' | 'sad'>('happy');
  useEffect(() => setLook(user?.avatar ?? {}), [user?.avatar]);
  const bySlot = useMemo(() => {
    const m = new Map<string, LockerItem[]>();
    for (const i of items.data ?? []) m.set(i.slot, [...(m.get(i.slot) ?? []), i]);
    return m;
  }, [items.data]);
  if (!user || !items.data) return <Skeleton className="h-96 w-full" />;
  const save = (next: AvatarCosmetics) => {
    setLook(next);
    setTryOn(null);
    void act(async () => (await getRepo()).locker.equip(next), t('saved'));
  };
  // Trying on a mascot item shows the mascot even while a profile picture is worn.
  const shown: AvatarCosmetics = tryOn
    ? tryOn.slot === 'picture'
      ? { picture: tryOn.code }
      : { ...look, picture: undefined, pictureUrl: undefined, [tryOn.slot]: tryOn.code }
    : look;
  // A random look from the items this player owns (each slot may also stay empty).
  const shuffle = () => {
    const next: AvatarCosmetics = {};
    for (const s of SLOTS.filter((x) => x !== 'picture')) {
      const owned = (bySlot.get(s) ?? []).filter((i) => i.owned);
      const pick = owned[Math.floor(Math.random() * (owned.length + (s === 'colour' ? 0 : 1)))];
      if (pick) (next as Record<string, string>)[s] = pick.code;
    }
    save(next);
    setBurst((b) => b + 1);
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[280px_minmax(0,1fr)]" data-testid="locker-page">
      <Card className="relative flex h-fit flex-col items-center gap-2 p-5 lg:sticky lg:top-20">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-center text-sm text-fg-muted">{t('intro')}</p>
        <div className="relative">
          <MascotAvatar size={200} cosmetics={shown} mood={mood} animated label={t('preview')} />
          {burst ? <ConfettiBurst key={burst} /> : null}
        </div>
        <p className="min-h-5 text-xs font-bold text-glow" aria-live="polite" data-testid="locker-tryon">
          {tryOn ? t('tryingOn') : null}
        </p>
        <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label={t('moodLabel')}>
          {(['happy', 'wow', 'sad'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mood === m}
              onClick={() => setMood(m)}
              className={cn('h-9 rounded-full border border-border px-3 text-xs font-bold transition-colors', mood === m ? 'border-glow bg-glow/15 text-glow' : 'hover:bg-surface-2')}
            >
              {t(`mood.${m}`)}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" icon={<Shuffle aria-hidden="true" className="size-4" />} onClick={shuffle} data-testid="locker-shuffle">
          {t('shuffle')}
        </Button>
        <p className="font-display text-lg font-bold text-glow">{tp('points', { count: user.brainPoints })}</p>
      </Card>
      <Tabs
        label={t('title')}
        value={slot}
        onChange={setSlot}
        items={SLOTS.map((s) => ({
          id: s,
          label: t(`slots.${s}`),
          content: (
            <>
            {s === 'picture' ? (
              <Card className="mb-3 flex flex-wrap items-center gap-3 p-3 text-sm" data-testid="picture-upload">
                <span className="min-w-48 flex-1 text-fg-muted">{user.isMinor ? t('uploadAdults') : t('uploadHint')}</span>
                {look.picture ? (
                  <Button size="sm" variant="ghost" onClick={() => save({ ...look, picture: '', pictureUrl: undefined })}>
                    {t('useMascot')}
                  </Button>
                ) : null}
                {!user.isMinor ? (
                  <label className={buttonClass({ size: 'sm' })}>
                    {t('upload')}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      data-testid="picture-input"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        void act(async () => (await getRepo()).locker.uploadPicture(await squarePicture(file)), t('uploaded'));
                      }}
                    />
                  </label>
                ) : null}
              </Card>
            ) : null}
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {(bySlot.get(s) ?? []).map((item) => {
                const equipped = look[s] === item.code;
                const locked = !item.owned && (user.level < item.minLevel || user.brainPoints < item.cost);
                return (
                  <li key={item.id}>
                    <Card
                      className={cn('flex flex-col items-center gap-2 p-3 text-center transition-transform hover:-translate-y-0.5', equipped && 'ring-2 ring-glow', tryOn?.code === item.code && tryOn.slot === s && !equipped && 'ring-2 ring-primary/60')}
                      data-testid="locker-item"
                      onPointerEnter={(e) => e.pointerType === 'mouse' && setTryOn({ slot: s, code: item.code })}
                      onPointerLeave={(e) => e.pointerType === 'mouse' && setTryOn(null)}
                    >
                      <button
                        type="button"
                        className="rounded-full"
                        aria-label={t('tryOn', { name: item.name })}
                        onClick={() => setTryOn((cur) => (cur?.code === item.code && cur.slot === s ? null : { slot: s, code: item.code }))}
                      >
                        <MascotAvatar size={96} cosmetics={s === 'picture' ? { picture: item.code } : { ...look, picture: undefined, pictureUrl: undefined, [s]: item.code }} />
                      </button>
                      <p className="text-sm font-bold">{item.name}</p>
                      {item.owned ? (
                        <Button size="sm" variant={equipped ? 'outline' : 'primary'} onClick={() => save(equipped ? { ...look, [s]: '' } : { ...look, [s]: item.code })}>
                          {equipped ? t('unequip') : t('equip')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={locked}
                          icon={locked ? <Lock aria-hidden="true" className="size-3.5" /> : undefined}
                          onClick={() =>
                            void act(async () => {
                              await (await getRepo()).locker.unlock(item.id);
                              setBurst((b) => b + 1);
                            }, t('unlocked'))
                          }
                        >
                          {user.level < item.minLevel ? t('needsLevel', { level: item.minLevel }) : user.brainPoints < item.cost ? t('notEnough', { cost: item.cost }) : item.cost ? t('unlock', { cost: item.cost }) : t('free')}
                        </Button>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
            </>
          ),
        }))}
      />
      <Link href="/quests" className={buttonClass({ variant: 'ghost', className: 'lg:col-start-2' })}>
        {tq('title')}
      </Link>
    </div>
  );
}
