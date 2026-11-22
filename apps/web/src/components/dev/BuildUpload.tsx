'use client';

import { useTranslations } from 'next-intl';
import { FileArchive, Upload } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { Badge, Button, Checkbox, ProgressBar, TextField, cn, useToast } from '@brainstorming/ui';
import { getRepo, RepoError } from '@/lib/data';
import type { PreQaReport } from '@/lib/domain/preqa';
import {
  extensionOf,
  findAbsolutePaths,
  mentionsSdk,
  validateBuild,
  type BuildValidation,
  type ZipEntryInfo,
} from '@/lib/domain/zipValidation';
import { savePreviewToken } from '@/lib/dev/previewTokens';
import { formatBytes } from '@/lib/format';
import { MIME_BY_EXT, assetHashes, buildFingerprint } from './media';

import type JSZipType from 'jszip';

export interface BuildUploadProps {
  gameId: string;
  suggestedVersion: string;
  isLive: boolean;
  onUploaded: (versionId: string, report: PreQaReport | null) => void;
}

/** `<script src="bg-sdk.js">` (or "./bg-sdk.js"): the build expects the SDK next to index.html. */
const LOCAL_SDK = /<script[^>]+src=["'](?:\.\/)?bg-sdk\.js["']/i;

type Picked = { zip: JSZipType; check: BuildValidation; sdk: boolean; addSdk: boolean };

/**
 * Drag a .zip in: unpack and validate it in the browser, show the tree, then upload and run
 * pre-QA straight away. A live game's update waits for the button, so the version and the
 * minor-update choice can be set first.
 */
export function BuildUpload({ gameId, suggestedVersion, isLive, onUploaded }: BuildUploadProps) {
  const t = useTranslations('dev.build');
  const tc = useTranslations('common');
  const toast = useToast();
  const [zip, setZip] = useState<JSZipType | null>(null);
  const [check, setCheck] = useState<BuildValidation | null>(null);
  const [extraWarnings, setExtraWarnings] = useState<string[]>([]);
  const [sdk, setSdk] = useState(false);
  const [addSdk, setAddSdk] = useState(false);
  const [reading, setReading] = useState(false);
  const [version, setVersion] = useState(suggestedVersion);
  const [minor, setMinor] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setCheck(null);
    try {
      const JSZip = (await import('jszip')).default;
      const z = await JSZip.loadAsync(file);
      const entries: ZipEntryInfo[] = [];
      z.forEach((path, entry) => {
        const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
        entries.push({ path, size, dir: entry.dir, unixPermissions: typeof entry.unixPermissions === 'number' ? entry.unixPermissions : null });
      });
      const result = validateBuild(entries);
      const warnings: string[] = [];
      let found = false;
      let missingSdk = false;
      const index = result.files.find((f) => f.path === 'index.html');
      if (index) {
        const html = await z.file(index.source)!.async('string');
        found = mentionsSdk(html);
        // Missing or an old copy: either way the build gets the latest official SDK file.
        missingSdk = LOCAL_SDK.test(html);
        const abs = findAbsolutePaths(html);
        if (abs.length) warnings.push(`index.html loads files from absolute paths (${abs.slice(0, 3).join(', ')}). Use relative paths.`);
      }
      // Look for the SDK in a few small scripts too.
      for (const f of result.files.filter((x) => extensionOf(x.path) === 'js' && x.size < 2_000_000).slice(0, 25)) {
        if (found) break;
        found = mentionsSdk(await z.file(f.source)!.async('string'));
      }
      setZip(z);
      setCheck(result);
      setSdk(found);
      setAddSdk(missingSdk);
      setExtraWarnings(warnings);
      setReading(false);
      if (result.ok && !isLive) await upload({ zip: z, check: result, sdk: found, addSdk: missingSdk });
    } catch {
      toast(tc('errorBody'), { tone: 'error' });
    } finally {
      setReading(false);
    }
  };

  const upload = async (picked: Picked | null = zip && check ? { zip, check, sdk, addSdk } : null) => {
    if (!picked?.check.ok) return;
    setProgress(0);
    try {
      const files = await Promise.all(
        picked.check.files.map(async (f) => {
          const ext = extensionOf(f.path);
          const data = await picked.zip.file(f.source)!.async('blob');
          return { path: f.path, data: new Blob([data], { type: MIME_BY_EXT[ext] ?? 'application/octet-stream' }) };
        }),
      );
      if (picked.addSdk) {
        // index.html loads bg-sdk.js from its own folder: ship the official copy with the build.
        const res = await fetch('/sdk/v1/bg-sdk.js');
        if (res.ok) {
          const official = new Blob([await res.blob()], { type: 'text/javascript' });
          const at = files.findIndex((f) => f.path === 'bg-sdk.js');
          if (at >= 0) files[at] = { path: 'bg-sdk.js', data: official };
          else files.push({ path: 'bg-sdk.js', data: official });
        }
      }
      const repo = await getRepo();
      const { versionId, previewToken } = await repo.dev.createVersion(
        { gameId, version: version.trim(), files, entryFile: 'index.html', usesSdk: picked.sdk, minorUpdate: isLive && minor, fingerprint: await buildFingerprint(files), assetHashes: await assetHashes(files) },
        setProgress,
      );
      savePreviewToken(versionId, previewToken);
      toast(t('uploaded'), { tone: 'success' });
      setZip(null);
      setCheck(null);
      setProgress(null);
      onUploaded(versionId, null);
      const report = await repo.dev.runPreQa(versionId);
      onUploaded(versionId, report);
    } catch (err) {
      setProgress(null);
      toast(err instanceof RepoError && err.message !== err.code ? err.message : tc('errorBody'), { tone: 'error' });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void read(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="build-upload">
      <p className="text-sm text-fg-muted">{t('intro')}</p>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed p-8 text-center transition-colors',
          dragging ? 'border-primary bg-surface-2' : 'border-border bg-surface-3 hover:bg-surface-2',
        )}
      >
        <FileArchive aria-hidden="true" className={cn('size-10 transition-transform', dragging ? 'scale-110 text-primary' : 'text-glow')} />
        <span className="font-bold">{reading ? t('reading') : dragging ? t('dropNow') : t('drop')}</span>
        <span className="text-xs text-fg-muted">{t('dropHint')}</span>
        <input
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          onChange={(e) => {
            void read(e.target.files?.[0]);
            e.target.value = '';
          }}
          data-testid="zip-input"
        />
      </label>

      {check ? (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4" data-testid="zip-report">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
            {t('files', { count: check.files.length, size: formatBytes(check.totalBytes) })}
            <Badge tone={sdk ? 'success' : 'warning'}>{sdk ? t('sdkFound') : 'SDK'}</Badge>
          </p>
          {!sdk ? <p className="text-sm text-fg-muted">{t('sdkMissing')}</p> : null}
          {addSdk ? (
            <p className="text-sm text-fg-muted" data-testid="sdk-added">
              {t('sdkAdded')}
            </p>
          ) : null}
          {check.errors.length ? (
            <div role="alert">
              <p className="text-sm font-bold text-danger">{t('errors')}</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {check.errors.slice(0, 20).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {[...check.warnings, ...extraWarnings].length ? (
            <div>
              <p className="text-sm font-bold text-warning light:text-navy-950">{t('warnings')}</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {[...check.warnings, ...extraWarnings].map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <details>
            <summary className="text-sm font-bold">{t('tree')}</summary>
            <ul className="mt-2 max-h-56 overflow-auto rounded-control bg-surface-3 p-2 font-mono text-xs">
              {check.files.slice(0, 200).map((f) => (
                <li key={f.path} className="flex justify-between gap-3">
                  <span className="truncate">{f.path}</span>
                  <span className="shrink-0 text-fg-muted">{formatBytes(f.size)}</span>
                </li>
              ))}
              {check.files.length > 200 ? <li className="text-fg-muted">{t('more', { count: check.files.length - 200 })}</li> : null}
            </ul>
          </details>
          {check.ok && isLive ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <TextField label={t('version')} value={version} onChange={(e) => setVersion(e.target.value)} className="sm:w-40" data-testid="build-version" />
              <Checkbox label={t('minor')} checked={minor} onChange={(e) => setMinor(e.target.checked)} />
              <Button onClick={() => void upload()} loading={progress != null} icon={<Upload aria-hidden="true" className="size-4" />} data-testid="build-submit">
                {t('upload')}
              </Button>
            </div>
          ) : null}
          {progress != null ? <ProgressBar value={progress * 100} label={t('uploading', { percent: Math.round(progress * 100) })} /> : null}
        </div>
      ) : null}
    </div>
  );
}
