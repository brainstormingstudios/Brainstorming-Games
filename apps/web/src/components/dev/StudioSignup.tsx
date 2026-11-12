'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, SelectField, TextField, useToast } from '@brainstorming/ui';
import { Link } from '@/i18n/navigation';
import { DEVELOPER_TERMS_VERSION } from '@/lib/config';
import { getRepo, RepoError } from '@/lib/data';
import type { AccountHolder } from '@/lib/data/devTypes';
import type { SessionUser } from '@/lib/data/repo';

/** A short list of common countries first; the rest follow alphabetically (ISO 3166 codes). */
const COUNTRIES: [string, string][] = [
  ['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['BD', 'Bangladesh'], ['PK', 'Pakistan'],
  ['NP', 'Nepal'], ['LK', 'Sri Lanka'], ['ID', 'Indonesia'], ['PH', 'Philippines'], ['VN', 'Vietnam'],
  ['BR', 'Brazil'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'],
  ['PL', 'Poland'], ['TR', 'Turkey'], ['UA', 'Ukraine'], ['RU', 'Russia'], ['CA', 'Canada'], ['MX', 'Mexico'],
  ['AU', 'Australia'], ['JP', 'Japan'], ['KR', 'South Korea'], ['SG', 'Singapore'], ['AE', 'United Arab Emirates'],
  ['NG', 'Nigeria'], ['EG', 'Egypt'], ['ZA', 'South Africa'], ['AR', 'Argentina'], ['SE', 'Sweden'],
];

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function StudioSignup({ user, onCreated }: { user: SessionUser; onCreated: () => void }) {
  const t = useTranslations('dev.signup');
  const tc = useTranslations('common');
  const toast = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [country, setCountry] = useState('IN');
  const [contact, setContact] = useState(user.email);
  const [holder, setHolder] = useState<AccountHolder>(user.isMinor ? 'minor_with_guardian' : 'adult');
  const [guardian, setGuardian] = useState('');
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!terms) {
      setError(t('termsRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const repo = await getRepo();
      await repo.dev.createStudio({
        name,
        slug,
        country,
        contactEmail: contact,
        holder,
        guardianName: guardian,
        termsVersion: DEVELOPER_TERMS_VERSION,
      });
      onCreated();
    } catch (err) {
      const message = err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody');
      setError(message);
      toast(message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-xl flex-col gap-4 rounded-card border border-border bg-surface p-5 sm:p-7" data-testid="studio-signup" noValidate>
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('intro')}</p>
      </div>
      <TextField
        label={t('name')}
        value={name}
        maxLength={60}
        onChange={(e) => {
          setName(e.target.value);
          if (!slugTouched) setSlug(slugify(e.target.value));
        }}
        data-testid="studio-name"
        required
      />
      <TextField
        label={t('slug')}
        hint={t('slugHint', { slug: slug || '…' })}
        value={slug}
        maxLength={40}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(slugify(e.target.value));
        }}
        data-testid="studio-slug"
        required
      />
      <SelectField label={t('country')} value={country} onChange={(e) => setCountry(e.target.value)} options={COUNTRIES.map(([value, label]) => ({ value, label }))} />
      <TextField label={t('contact')} hint={t('contactHint')} type="email" value={contact} onChange={(e) => setContact(e.target.value)} required />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold">{t('holder')}</legend>
        {(['adult', 'company', 'minor_with_guardian'] as const).map((h) => (
          <label key={h} className="flex items-center gap-2.5 text-sm">
            <input type="radio" name="holder" value={h} checked={holder === h} onChange={() => setHolder(h)} className="size-4 accent-(--primary)" />
            {t(h === 'adult' ? 'holderAdult' : h === 'company' ? 'holderCompany' : 'holderMinor')}
          </label>
        ))}
      </fieldset>
      {holder === 'minor_with_guardian' ? <TextField label={t('guardian')} value={guardian} onChange={(e) => setGuardian(e.target.value)} required /> : null}
      <Checkbox
        checked={terms}
        onChange={(e) => setTerms(e.target.checked)}
        data-testid="studio-terms"
        label={
          <>
            {t('terms', { version: DEVELOPER_TERMS_VERSION })}{' '}
            <Link href="/developer-terms" className="font-bold text-link underline" target="_blank">
              {t('readTerms')}
            </Link>
          </>
        }
      />
      {error ? (
        <p role="alert" className="text-sm font-bold text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" loading={busy} data-testid="studio-create">
        {t('create')}
      </Button>
    </form>
  );
}
