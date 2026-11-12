'use client';

import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@brainstorming/ui';
import type { QaStatus } from '@/lib/data/devTypes';
import type { GameStatus } from '@/lib/data/types';

const GAME_TONE: Record<GameStatus, BadgeTone> = {
  draft: 'neutral',
  in_review: 'warning',
  changes_requested: 'danger',
  spark: 'glow',
  rise: 'success',
  featured: 'primary',
  paused: 'neutral',
  removed: 'danger',
};

const QA_TONE: Record<QaStatus, BadgeTone> = {
  uploaded: 'neutral',
  pre_qa_running: 'warning',
  pre_qa_passed: 'success',
  pre_qa_warn: 'warning',
  pre_qa_failed: 'danger',
  in_review: 'warning',
  approved: 'success',
  changes_requested: 'danger',
  rejected: 'danger',
};

export function GameStatusBadge({ status }: { status: GameStatus }) {
  const t = useTranslations('dev.status');
  return (
    <Badge tone={GAME_TONE[status]} data-testid="game-status">
      {t(status)}
    </Badge>
  );
}

export function QaBadge({ status }: { status: QaStatus }) {
  const t = useTranslations('dev.qa');
  return (
    <Badge tone={QA_TONE[status]} data-testid="qa-status">
      {t(status)}
    </Badge>
  );
}
