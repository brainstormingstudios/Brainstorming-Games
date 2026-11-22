'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Badge, Card } from '@brainstorming/ui';
import { useLocale } from '@/i18n/navigation';
import type { QaReviewItem } from '@/lib/data/devTypes';
import { Markdown } from '@/lib/domain/markdown';
import { formatBytes, formatDate } from '@/lib/format';

/** One labelled fact; empty values show a dash so a missing field is obvious. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  const empty = children == null || children === '' || (Array.isArray(children) && children.length === 0);
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-3 border-t border-border py-1.5 text-sm first:border-t-0">
      <dt className="font-bold text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words">{empty ? <span className="text-fg-muted">–</span> : children}</dd>
    </div>
  );
}

/**
 * Everything a moderator needs to decide on a game, in one place: the full store page, every
 * setting, every cover and video (also test variants and earlier files), the build, the rights
 * declaration and the studio's record.
 */
export function ReviewDetails({ item }: { item: QaReviewItem }) {
  const t = useTranslations('admin.review.details');
  const locale = useLocale();
  const { game, studio, version, media, declaration, studioRecord } = item;
  const yes = (v: boolean) => (v ? t('yes') : t('no'));
  return (
    <div className="flex flex-col gap-5" data-testid="review-details">
      <Card className="p-4">
        <h2 className="mb-2 text-xl font-semibold">{t('page')}</h2>
        <dl>
          <Fact label={t('title')}>{game.title}</Fact>
          <Fact label={t('address')}>/game/{game.slug}</Fact>
          <Fact label={t('short')}>{game.shortDescription}</Fact>
          <Fact label={t('category')}>{game.category}</Fact>
          <Fact label={t('tags')}>{game.tags.join(', ')}</Fact>
          <Fact label={t('skills')}>{game.skills.join(', ')}</Fact>
          <Fact label={t('orientation')}>{game.orientation}</Fact>
          <Fact label={t('platforms')}>{game.platforms.join(', ')}</Fact>
          <Fact label={t('engine')}>{game.engine}</Fact>
          <Fact label={t('multiplayer')}>{yes(game.isMultiplayer)}</Fact>
          <Fact label={t('progress')}>{yes(game.hasProgress)}</Fact>
          <Fact label={t('maxScore')}>{game.maxScorePerSec == null ? '' : String(game.maxScorePerSec)}</Fact>
          <Fact label={t('exclusive')}>{yes(game.wantsExclusive)}</Fact>
        </dl>
      </Card>

      <Card className="prose-bg p-4" data-testid="review-text">
        <h2>{t('description')}</h2>
        <Markdown source={game.descriptionMd || '–'} />
        <h2>{t('howToPlay')}</h2>
        <Markdown source={game.howToPlayMd || '–'} />
        {game.featuresMd ? (
          <>
            <h2>{t('features')}</h2>
            <Markdown source={game.featuresMd} />
          </>
        ) : null}
        {game.tipsMd ? (
          <>
            <h2>{t('tips')}</h2>
            <Markdown source={game.tipsMd} />
          </>
        ) : null}
        <h2>{t('controls')}</h2>
        {game.controls.length ? (
          <table>
            <thead>
              <tr>
                <th>{t('action')}</th>
                <th>{t('keyboard')}</th>
                <th>{t('touch')}</th>
              </tr>
            </thead>
            <tbody>
              {game.controls.map((c, i) => (
                <tr key={i}>
                  <td>{c.action}</td>
                  <td>{c.keyboard}</td>
                  <td>{c.touch}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>–</p>
        )}
        {game.faq.length ? (
          <>
            <h2>{t('faq')}</h2>
            {game.faq.map((f, i) => (
              <p key={i}>
                <strong>{f.q}</strong> {f.a}
              </p>
            ))}
          </>
        ) : null}
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-xl font-semibold">{t('media')}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="review-media">
          {media.map((m) => (
            <figure key={m.id} className="flex flex-col gap-1">
              {m.kind.startsWith('preview') ? (
                <video src={m.url} muted controls className="w-full rounded-control" />
              ) : (
                <img src={m.url} alt="" className="w-full rounded-control border border-border" />
              )}
              <figcaption className="flex flex-wrap gap-1 text-xs">
                <span className="font-bold">{t(`kinds.${m.kind}`)}</span>
                {m.variantLabel ? <Badge>{t('variant', { label: m.variantLabel })}</Badge> : null}
                {!m.isActive ? <Badge tone="warning">{t('inactive')}</Badge> : null}
              </figcaption>
            </figure>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-xl font-semibold">{t('build')}</h2>
        <dl>
          <Fact label={t('version')}>v{version.version}</Fact>
          <Fact label={t('size')}>{formatBytes(version.totalBytes)}</Fact>
          <Fact label={t('files')}>{String(version.fileCount)}</Fact>
          <Fact label={t('entry')}>{version.entryFile}</Fact>
          <Fact label={t('sdk')}>{yes(version.usesSdk)}</Fact>
          <Fact label={t('minor')}>{yes(version.minorUpdate)}</Fact>
          <Fact label={t('uploaded')}>{formatDate(version.createdAt, locale)}</Fact>
          <Fact label={t('submitted')}>{version.submittedAt ? formatDate(version.submittedAt, locale) : ''}</Fact>
        </dl>
      </Card>

      <Card className="p-4" data-testid="review-declaration">
        <h2 className="mb-2 text-xl font-semibold">{t('declaration')}</h2>
        <dl>
          <Fact label={t('ownsRights')}>{declaration ? yes(declaration.ownsRights) : ''}</Fact>
          <Fact label={t('noCopies')}>{declaration ? yes(declaration.noCopies) : ''}</Fact>
          <Fact label={t('credits')}>{declaration?.credits ? <span className="whitespace-pre-wrap">{declaration.credits}</span> : ''}</Fact>
        </dl>
      </Card>

      <Card className="p-4" data-testid="review-studio">
        <h2 className="mb-2 text-xl font-semibold">{t('studio')}</h2>
        <dl>
          <Fact label={t('studioName')}>
            {studio.name} {studio.verified ? <Badge tone="success">{t('verified')}</Badge> : null} {studio.isFirstParty ? <Badge tone="primary">{t('firstParty')}</Badge> : null}{' '}
            {studio.suspended ? <Badge tone="danger">{t('suspended')}</Badge> : null}
          </Fact>
          <Fact label={t('country')}>{studio.country}</Fact>
          <Fact label={t('contact')}>{studio.contactEmail}</Fact>
          <Fact label={t('level')}>{studio.level}</Fact>
          <Fact label={t('since')}>{formatDate(studio.createdAt, locale)}</Fact>
          <Fact label={t('terms')}>{studio.termsVersion ? `${studio.termsVersion} · ${studio.termsAcceptedAt ? formatDate(studio.termsAcceptedAt, locale) : ''}` : ''}</Fact>
          <Fact label={t('guardian')}>{studio.guardianName}</Fact>
          <Fact label={t('bio')}>{studio.bio}</Fact>
          <Fact label={t('links')}>
            {studio.links.map((l) => (
              <span key={l.url} className="me-2 break-all">
                {l.label}: {l.url}
              </span>
            ))}
          </Fact>
          {studioRecord ? (
            <>
              <Fact label={t('reviews')}>{t('reviewCounts', { approved: studioRecord.approvals, changes: studioRecord.changesRequested, rejected: studioRecord.rejections })}</Fact>
              <Fact label={t('otherGames')}>{studioRecord.games.map((g) => `${g.title} (${g.status})`).join(', ')}</Fact>
            </>
          ) : null}
        </dl>
      </Card>
    </div>
  );
}
