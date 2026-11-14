import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * This one codebase builds three separate websites. `BG_SITE` picks which:
 *
 *   play        the player site        src/app/(en)/**         page.tsx
 *   developers  the developer portal   src/app/(developers)/** page.dev.tsx
 *   manage      the management portal  src/app/(manage)/**     page.manage.tsx
 *
 * A build only sees the route files with its own extension, so no page of one site can end up
 * in another. Each site has its own build folder and its own export folder.
 */
const SITES = {
  play: { extensions: ['tsx', 'ts'], distDir: '.next', outDir: 'out' },
  developers: { extensions: ['dev.tsx', 'dev.ts'], distDir: '.next-developers', outDir: 'out-developers' },
  manage: { extensions: ['manage.tsx', 'manage.ts'], distDir: '.next-manage', outDir: 'out-manage' },
} as const;

const requested = process.env.BG_SITE ?? process.env.NEXT_PUBLIC_BG_SITE ?? 'play';
const SITE = (requested in SITES ? requested : 'play') as keyof typeof SITES;

export default function config(phase: string): NextConfig {
  const building = phase === PHASE_PRODUCTION_BUILD;
  const base: NextConfig = {
    // Each site is a static export for Cloudflare Pages. Dev stays a normal server so any dynamic
    // path can render on demand (see docs/PLAN.md, D4).
    output: building ? 'export' : undefined,
    // With `output: 'export'` the export is written to distDir, so a build uses the export folder
    // and the dev server its own cache folder.
    distDir: building ? SITES[SITE].outDir : SITES[SITE].distDir,
    pageExtensions: [...SITES[SITE].extensions],
    env: { NEXT_PUBLIC_BG_SITE: SITE },
    trailingSlash: true,
    reactStrictMode: true,
    poweredByHeader: false,
    images: { unoptimized: true },
    transpilePackages: ['@brainstorming/ui', '@brainstorming/sdk'],
    experimental: {
      optimizePackageImports: ['lucide-react', '@brainstorming/ui'],
    },
    // Linting runs once for the whole monorepo from the root (`npm run lint`).
    eslint: { ignoreDuringBuilds: true },
    // Type checking also runs once for everything (`npm run typecheck`).
    typescript: { ignoreBuildErrors: SITE !== 'play' },
  };
  return withNextIntl(base);
}
