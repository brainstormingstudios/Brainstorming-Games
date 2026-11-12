import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@/': `${r('./apps/web/src')}/`,
      '@brainstorming/sdk/host': r('./packages/sdk/src/host.ts'),
      '@brainstorming/sdk/protocol': r('./packages/sdk/src/protocol.ts'),
      '@brainstorming/sdk': r('./packages/sdk/src/index.ts'),
      '@brainstorming/ui': r('./packages/ui/src/index.ts'),
    },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    // DOM tests opt in per file with `// @vitest-environment happy-dom`.
    environment: 'node',
    include: [
      'apps/web/src/**/*.test.{ts,tsx}',
      'packages/*/src/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
      'supabase/functions/**/*.test.ts',
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/db/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
  cacheDir: 'node_modules/.cache/vite',
});
