import { DEVELOPERS_URL, MANAGE_URL, SITE, SITE_URL, type SiteId } from './config';

/**
 * Paths in the code are written for the whole product: `/dev/...` is the developer portal,
 * `/admin/...` the management portal, everything else the player site. Each of the three is its
 * own website, so a path is turned into "this site, this path" (a normal link) or an absolute URL
 * on one of the other two.
 */
const ORIGINS: Record<SiteId, string> = { play: SITE_URL, developers: DEVELOPERS_URL, manage: MANAGE_URL };

export const siteOrigin = (site: SiteId): string => ORIGINS[site];

/** The site a product path belongs to, and the path on that site. */
export function sitePath(path: string): { site: SiteId; path: string } {
  const m = /^\/(dev|admin)(?=[/?#]|$)(.*)$/.exec(path);
  if (!m) return { site: 'play', path };
  const rest = m[2] ?? '';
  return { site: m[1] === 'dev' ? 'developers' : 'manage', path: rest.startsWith('/') ? rest : `/${rest}` };
}

/** True when a product path lives on the site this build is. */
export const isThisSite = (path: string): boolean => sitePath(path).site === SITE;

/** The current browser path as a product path (`/games/new` on the developer portal is `/dev/games/new`). */
export function productPath(pathname: string): string {
  if (SITE === 'play') return pathname;
  const prefix = SITE === 'developers' ? '/dev' : '/admin';
  return pathname === '/' ? prefix : `${prefix}${pathname}`;
}
