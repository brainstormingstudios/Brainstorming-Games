'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import {
  Bug,
  Copy,
  Heart,
  Maximize,
  MessageCircle,
  Minimize,
  PartyPopper,
  RectangleHorizontal,
  Send,
  Share2,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  IconButton,
  SelectField,
  TextAreaField,
  buttonClass,
  chipClass,
  cn,
  useToast,
} from '@brainstorming/ui';
import { getRepo, RepoError } from '@/lib/data';
import { getDeviceClass } from '@/lib/data/local';
import {
  DISLIKE_REASONS,
  FEEDBACK_CATEGORIES,
  type DislikeReason,
  type FeedbackCategory,
  type GameStats,
  type GameSummary,
  type MyRating,
} from '@/lib/data/types';
import { formatCount } from '@/lib/format';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { setPrefs, usePrefs } from '@/lib/prefs';
import { useLocale } from '@/i18n/navigation';
import { localizePath } from '@/i18n/config';

const ClipButton = dynamic(() => import('@/components/growth/ClipButton').then((m) => m.ClipButton), { ssr: false });

export interface GameToolbarProps {
  game: GameSummary;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Latest SDK game context, attached to bug reports. */
  getContext?: () => Record<string, unknown> | null;
  onStats?: (stats: GameStats) => void;
}

export function GameToolbar({ game, fullscreen, onToggleFullscreen, getContext, onStats }: GameToolbarProps) {
  const t = useTranslations('game');
  const tc = useTranslations('common');
  const toast = useToast();
  const locale = useLocale();
  const { theatre, schoolSafe } = usePrefs();
  const [stats, setStats] = useState(game.stats);
  const [mine, setMine] = useState<MyRating | null>(null);
  const [askReason, setAskReason] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setStats(game.stats), [game.stats]);

  const rating = useRepoQuery((repo) => repo.player.myRating(game.id), [game.id], { topics: ['ratings'] });
  useEffect(() => {
    if (rating.data !== undefined) setMine(rating.data);
  }, [rating.data]);

  const favs = useRepoQuery((repo) => repo.player.favourites(), [], { topics: ['favourites'] });
  const isFav = favs.data?.includes(game.id) ?? false;

  const fail = (err: unknown) =>
    toast(err instanceof RepoError && err.code === 'rate_limited' ? tc('rateLimited') : tc('errorBody'), {
      tone: 'error',
    });

  const vote = async (value: 1 | -1, reason: DislikeReason | null = null) => {
    if (busy) return;
    setBusy(true);
    // Voting the same way again takes the vote back.
    const next = mine?.value === value && reason === null ? 0 : value;
    try {
      const repo = await getRepo();
      const updated = await repo.player.rate(game.id, next, reason);
      setStats(updated);
      onStats?.(updated);
      setMine(next === 0 ? null : { value: next, reason });
      setAskReason(next === -1 && reason === null);
      if (reason) toast(t('thanksFeedback'), { tone: 'success' });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const toggleFav = async () => {
    try {
      const repo = await getRepo();
      await repo.player.setFavourite(game.id, !isFav);
      toast(isFav ? t('favouriteRemoved') : t('favouriteAdded'), { tone: 'success' });
    } catch (err) {
      fail(err);
    }
  };

  const share = async () => {
    const data = { title: game.title, text: t('shareText', { title: game.title }), url: window.location.href };
    if (navigator.share && getDeviceClass() !== 'desktop') {
      try {
        await navigator.share(data);
        return;
      } catch {
        // cancelled: fall through to the dialog
      }
    }
    setShareOpen(true);
  };

  const pill = 'flex h-11 items-center gap-2 rounded-control px-3 text-sm font-bold transition-colors hover:bg-surface-2';

  return (
    <div role="toolbar" aria-label={t('toolbar')} data-testid="game-toolbar" className="mt-3">
      <div className="flex flex-wrap items-center gap-1 rounded-card border border-border bg-surface px-2 py-1.5">
        <button
          type="button"
          aria-pressed={mine?.value === 1}
          aria-label={`${t('like')} (${t('likeCount', { count: stats.likes })})`}
          data-testid="like-button"
          onClick={() => void vote(1)}
          className={cn(pill, mine?.value === 1 && 'bg-primary text-primary-fg hover:bg-primary')}
        >
          <ThumbsUp aria-hidden="true" className="size-5" />
          <span data-testid="like-count">{formatCount(stats.likes, locale)}</span>
        </button>
        <button
          type="button"
          aria-pressed={mine?.value === -1}
          aria-label={`${t('dislike')} (${t('dislikeCount', { count: stats.dislikes })})`}
          data-testid="dislike-button"
          onClick={() => void vote(-1)}
          className={cn(pill, mine?.value === -1 && 'bg-surface-2')}
        >
          <ThumbsDown aria-hidden="true" className="size-5" />
          <span data-testid="dislike-count">{formatCount(stats.dislikes, locale)}</span>
        </button>
        <IconButton
          label={isFav ? t('unfavourite') : t('favourite')}
          aria-pressed={isFav}
          data-testid="favourite-button"
          onClick={() => void toggleFav()}
        >
          <Heart aria-hidden="true" className={cn('size-5', isFav && 'fill-danger text-danger')} />
        </IconButton>
        <IconButton label={t('share')} data-testid="share-button" onClick={() => void share()}>
          <Share2 aria-hidden="true" className="size-5" />
        </IconButton>
        {!schoolSafe ? <ClipButton title={game.title} /> : null}
        {!schoolSafe ? (
          <IconButton
            label={t('invite')}
            data-testid="party-button"
            onClick={() =>
              void getRepo()
                .then((repo) => repo.party.create(game.id))
                .then((party) => window.location.assign(localizePath(`/party/${party.code}`, locale)))
                .catch(fail)
            }
          >
            <PartyPopper aria-hidden="true" className="size-5" />
          </IconButton>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <IconButton label={t('report')} data-testid="report-button" onClick={() => setReportOpen(true)}>
            <Bug aria-hidden="true" className="size-5" />
          </IconButton>
          <IconButton
            label={theatre ? t('exitTheatre') : t('theatre')}
            aria-pressed={theatre}
            active={theatre}
            className="hidden xl:inline-flex"
            data-testid="theatre-button"
            onClick={() => setPrefs({ theatre: !theatre })}
          >
            <RectangleHorizontal aria-hidden="true" className="size-5" />
          </IconButton>
          <IconButton
            label={fullscreen ? t('exitFullscreen') : t('fullscreen')}
            data-testid="fullscreen-button"
            onClick={onToggleFullscreen}
          >
            {fullscreen ? (
              <Minimize aria-hidden="true" className="size-5" />
            ) : (
              <Maximize aria-hidden="true" className="size-5" />
            )}
          </IconButton>
        </span>
      </div>

      {askReason ? (
        <div
          data-testid="dislike-reasons"
          className="mt-2 animate-pop-in rounded-card border border-border bg-surface-3 px-3 py-2.5"
        >
          <p className="mb-2 text-sm font-bold">{t('dislikeWhy')}</p>
          <div className="flex flex-wrap gap-2">
            {DISLIKE_REASONS.map((reason) => (
              <button key={reason} type="button" className={chipClass(false)} onClick={() => void vote(-1, reason)}>
                {t(`reasons.${reason}`)}
              </button>
            ))}
            <button type="button" className={chipClass(false, 'border-transparent')} onClick={() => setAskReason(false)}>
              {tc('dismiss')}
            </button>
          </div>
        </div>
      ) : null}

      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} title={game.title} />
      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} game={game} getContext={getContext} />
    </div>
  );
}

function ShareDialog({ open, onClose, title }: { open: boolean; onClose: () => void; title: string }) {
  const t = useTranslations('game');
  const tc = useTranslations('common');
  const toast = useToast();
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (open) setUrl(window.location.href.split('#')[0] ?? '');
  }, [open]);
  const text = t('shareText', { title });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast(t('linkCopied'), { tone: 'success' });
      onClose();
    } catch {
      toast(tc('errorBody'), { tone: 'error' });
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('shareTitle')} size="sm" closeLabel={tc('close')}>
      <div className="flex flex-col gap-2">
        <Button block icon={<Copy aria-hidden="true" className="size-4" />} onClick={() => void copy()} data-testid="copy-link">
          {t('copyLink')}
        </Button>
        <a
          className={buttonClass({ variant: 'outline', block: true })}
          href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle aria-hidden="true" className="size-4" />
          {t('shareWhatsapp')}
        </a>
        <a
          className={buttonClass({ variant: 'outline', block: true })}
          href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Send aria-hidden="true" className="size-4" />
          {t('shareX')}
        </a>
      </div>
    </Dialog>
  );
}

function ReportDialog({
  open,
  onClose,
  game,
  getContext,
}: {
  open: boolean;
  onClose: () => void;
  game: GameSummary;
  getContext?: () => Record<string, unknown> | null;
}) {
  const t = useTranslations('game');
  const tc = useTranslations('common');
  const toast = useToast();
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (message.trim().length < 5) {
      setError(t('reportTooShort'));
      return;
    }
    setSending(true);
    try {
      const repo = await getRepo();
      await repo.player.sendFeedback({
        gameId: game.id,
        versionId: game.versionId,
        category,
        message: message.trim(),
        context: getContext?.() ?? null,
        device: getDeviceClass(),
      });
      toast(t('reportSent'), { tone: 'success' });
      setMessage('');
      setError(null);
      onClose();
    } catch (err) {
      toast(err instanceof RepoError && err.code === 'rate_limited' ? tc('rateLimited') : tc('errorBody'), {
        tone: 'error',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('reportTitle', { title: game.title })}
      description={t('reportIntro')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button loading={sending} onClick={() => void submit()} data-testid="report-submit">
            {tc('send')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SelectField
          label={t('reportCategory')}
          value={category}
          onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
          options={FEEDBACK_CATEGORIES.map((c) => ({ value: c, label: t(`reportCategories.${c}`) }))}
        />
        <TextAreaField
          label={t('reportMessage')}
          hint={t('reportMessageHint')}
          error={error}
          value={message}
          maxLength={2000}
          onChange={(e) => {
            setMessage(e.target.value);
            setError(null);
          }}
          data-testid="report-message"
        />
      </div>
    </Dialog>
  );
}
