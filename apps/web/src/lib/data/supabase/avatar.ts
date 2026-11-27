import { SUPABASE_URL } from '@/lib/config';

/**
 * An avatar as stored (equip_cosmetics): an uploaded picture is kept as its storage path
 * ("avatars/<user>/<name>.webp"); pages need its full public address.
 */
export function avatarOf(raw: unknown): Record<string, string> {
  const av = { ...((raw as Record<string, string> | null) ?? {}) };
  const url = av.pictureUrl;
  if (url && !/^https:\/\//.test(url)) {
    if (/^avatars\/[0-9a-f-]{36}\/[a-z0-9-]{1,40}\.webp$/.test(url)) av.pictureUrl = `${SUPABASE_URL}/storage/v1/object/public/${url}`;
    else delete av.pictureUrl;
  }
  return av;
}
