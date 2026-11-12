import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default function config(phase: string): NextConfig {
  const base: NextConfig = {
    // The site is a static export for Cloudflare Pages. Dev stays a normal server so any dynamic
    // path can render on demand (see docs/PLAN.md, D4).
    output: phase === PHASE_PRODUCTION_BUILD ? 'export' : undefined,
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
  };
  return withNextIntl(base);
}
