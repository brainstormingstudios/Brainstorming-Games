'use client';

import { useTranslations } from 'next-intl';
import { Camera, Clapperboard, Link2, Plus, SquarePlay, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Checkbox, IconButton, SelectField, Skeleton, TextAreaField, TextField, buttonClass } from '@brainstorming/ui';
import { Link } from '@/i18n/navigation';
import { requestLogin } from '@/lib/auth/loginPrompt';
import { getRepo, RepoError } from '@/lib/data';
import { CREATOR_HANDLE, CREATOR_SHARE_PCT, type ChannelKind, type CreatorChannel } from '@/lib/data/creatorTypes';
import { useRepoQuery } from '@/lib/hooks/useRepoQuery';
import { useSession } from '@/lib/hooks/useSession';

const KINDS: ChannelKind[] = ['youtube', 'instagram', 'twitch', 'other'];

function ApplyForm({ defaultName, onDone }: { defaultName: string; onDone: () => void }) {
  const t = useTranslations('creators.apply');
  const tc = useTranslations('common');
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState(defaultName);
  const [channels, setChannels] = useState<CreatorChannel[]>([{ kind: 'youtube', url: '' }]);
  const [about, setAbout] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const h = handle.trim().toLowerCase();
    if (!CREATOR_HANDLE.test(h)) return setError(t('badHandle'));
    setBusy(true);
    try {
      const repo = await getRepo();
      if (!(await repo.creators.handleAvailable(h))) {
        setError(t('handleTaken'));
        return;
      }
      await repo.creators.apply({ handle: h, displayName, channels, about, agreed });
      onDone();
    } catch (err) {
      setError(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5" data-testid="creator-apply">
      <h2 className="text-2xl font-bold">{t('title')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={t('handle')}
          hint={t('handleHint', { handle: handle.trim().toLowerCase() || 'yourname' })}
          value={handle}
          maxLength={24}
          onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
          data-testid="creator-handle"
        />
        <TextField label={t('displayName')} value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold">{t('channels')}</legend>
        {channels.map((c, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
            <SelectField
              label={t('channelKind')}
              hideLabel
              value={c.kind}
              onChange={(e) => setChannels(channels.map((x, j) => (j === i ? { ...x, kind: e.target.value as ChannelKind } : x)))}
              options={KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
            />
            <TextField
              label={t('channelUrl')}
              hideLabel
              placeholder="https://"
              value={c.url}
              onChange={(e) => setChannels(channels.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
              data-testid="creator-channel"
            />
            <IconButton label={t('remove')} disabled={channels.length === 1} onClick={() => setChannels(channels.filter((_, j) => j !== i))}>
              <Trash2 aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
        ))}
        {channels.length < 5 ? (
          <Button variant="outline" size="sm" className="self-start" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setChannels([...channels, { kind: 'instagram', url: '' }])}>
            {t('addChannel')}
          </Button>
        ) : null}
      </fieldset>
      <TextAreaField label={t('about')} hint={t('aboutHint')} rows={4} maxLength={600} value={about} onChange={(e) => setAbout(e.target.value)} data-testid="creator-about" />
      <details className="rounded-control border border-border p-3 text-sm" data-testid="creator-terms">
        <summary className="cursor-pointer font-bold">{t('termsTitle')}</summary>
        <ul className="mt-2 list-disc pl-5 text-fg-muted">
          {(['t1', 't2', 't3', 't4', 't5', 't6'] as const).map((k) => (
            <li key={k}>{t(`terms.${k}`, { pct: CREATOR_SHARE_PCT })}</li>
          ))}
        </ul>
      </details>
      <p className="text-sm font-bold" data-testid="creator-india-only">
        {t('indiaOnly')}
      </p>
      <Checkbox
        label={t('agree')}
        checked={agreed}
        onChange={(e) => setAgreed(e.target.checked)}
        data-testid="creator-agree"
      />
      {error ? (
        <p role="alert" className="text-sm font-bold text-danger" data-testid="creator-error">
          {error}
        </p>
      ) : null}
      <Button className="self-start" size="lg" loading={busy} disabled={!agreed} onClick={() => void submit()} data-testid="creator-submit">
        {t('submit')}
      </Button>
    </Card>
  );
}

/** The creator program: what it is, how it pays, and the application or its status. */
export function CreatorsLanding() {
  const t = useTranslations('creators');
  const { user, ready } = useSession();
  const mine = useRepoQuery((repo) => (user?.username ? repo.creators.mine() : Promise.resolve(null)), [user?.id, user?.username], { topics: ['creators', 'session'] });
  const [applied, setApplied] = useState(false);

  const steps = [
    { icon: Link2, key: 'step1' },
    { icon: Clapperboard, key: 'step2' },
    { icon: Wallet, key: 'step3' },
  ] as const;

  let action: React.ReactNode;
  if (!ready || (user?.username && mine.data === undefined)) action = <Skeleton className="h-40 w-full" />;
  else if (!user?.username)
    action = (
      <Card className="flex flex-col items-start gap-3 p-5">
        <h2 className="text-2xl font-bold">{t('joinTitle')}</h2>
        <p className="text-sm text-fg-muted">{t('signInFirst')}</p>
        <Button size="lg" onClick={() => void requestLogin()} data-testid="creator-login">
          {t('signIn')}
        </Button>
      </Card>
    );
  else if (user.isMinor) action = <Card className="p-5 text-sm">{t('adultsOnly')}</Card>;
  else if (mine.data && mine.data.status !== 'rejected' && !applied) {
    const c = mine.data;
    action = (
      <Card className="flex flex-col items-start gap-3 p-5" data-testid="creator-status">
        <Badge tone={c.status === 'approved' ? 'success' : c.status === 'pending' ? 'warning' : 'danger'}>{t(`status.${c.status}`)}</Badge>
        <p className="text-sm">{t(`statusBody.${c.status}`, { handle: c.handle })}</p>
        {c.status === 'approved' ? (
          <Link href="/creators/dashboard" className={buttonClass({ size: 'lg' })} data-testid="creator-dashboard-link">
            {t('openDashboard')}
          </Link>
        ) : null}
      </Card>
    );
  } else if (applied)
    action = (
      <Card className="p-5 text-sm" data-testid="creator-applied">
        {t('appliedBody')}
      </Card>
    );
  else
    action = (
      <>
        {mine.data?.status === 'rejected' && mine.data.reviewNote ? <Card className="p-4 text-sm">{t('rejectedBefore', { note: mine.data.reviewNote })}</Card> : null}
        <ApplyForm
          defaultName={user.displayName || user.username}
          onDone={() => {
            setApplied(true);
            mine.refresh();
          }}
        />
      </>
    );

  return (
    <div className="page flex flex-col gap-8" data-testid="creators-page">
      <section className="flex flex-col gap-3">
        <Badge tone="glow" className="self-start">
          {t('kicker')}
        </Badge>
        <h1 className="max-w-3xl text-4xl font-bold">{t('title', { pct: CREATOR_SHARE_PCT })}</h1>
        <p className="max-w-2xl text-lg text-fg-muted">{t('intro')}</p>
        <div className="flex flex-wrap gap-2 text-sm font-bold text-fg-muted">
          <span className="inline-flex items-center gap-1">
            <SquarePlay aria-hidden="true" className="size-4" /> YouTube Shorts
          </span>
          <span className="inline-flex items-center gap-1">
            <Camera aria-hidden="true" className="size-4" /> Instagram Reels
          </span>
        </div>
      </section>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map(({ icon: Icon, key }, i) => (
          <li key={key}>
            <Card className="flex h-full flex-col gap-2 p-4">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-fg">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <h2 className="text-lg font-bold">
                {i + 1}. {t(`${key}.title`)}
              </h2>
              <p className="text-sm text-fg-muted">{t(`${key}.body`, { pct: CREATOR_SHARE_PCT })}</p>
            </Card>
          </li>
        ))}
      </ol>
      {action}
      <section className="flex flex-col gap-2" aria-labelledby="creator-faq">
        <h2 id="creator-faq" className="text-2xl font-bold">
          {t('faqTitle')}
        </h2>
        {(['q1', 'q2', 'q3', 'q4', 'q5'] as const).map((q) => (
          <details key={q} className="rounded-control border border-border p-3">
            <summary className="cursor-pointer font-bold">{t(`faq.${q}.q`)}</summary>
            <p className="mt-2 text-sm text-fg-muted">{t(`faq.${q}.a`, { pct: CREATOR_SHARE_PCT })}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
