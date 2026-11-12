'use client';

import { local } from '@/lib/data/local';

/**
 * Private preview tokens are shown once, when a build is uploaded (the database keeps only a
 * hash). The developer's browser remembers them so the "Private preview" link keeps working.
 */
const KEY = 'bg.previewTokens';

export function savePreviewToken(versionId: string, token: string): void {
  const all = local.get<Record<string, string>>(KEY, {});
  all[versionId] = token;
  local.set(KEY, all);
}

export function getPreviewToken(versionId: string): string | null {
  return local.get<Record<string, string>>(KEY, {})[versionId] ?? null;
}
