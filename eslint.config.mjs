// Flat ESLint config for the whole monorepo.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.build/**',
      '**/out/**',
      '**/out-*/**',
      '**/.next-*/**',
      'games/**',
      '**/.wrangler/**',
      '**/dist/**',
      '.local/**',
      'apps/web/public/**',
      'apps/web/src/generated/**',
      'apps/web/next-env.d.ts',
      'apps/web/src/lib/data/supabase/database.types.ts',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // React, hooks, accessibility and Next rules for the app and the UI package.
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      '@next/next': nextPlugin,
    },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // Covers come from user uploads with our own responsive <picture>; next/image cannot
      // optimise in a static export.
      '@next/next/no-img-element': 'off',
      // Both rules target the Pages Router; this app uses the App Router only.
      '@next/next/no-html-link-for-pages': 'off',
      '@next/next/no-head-element': 'off',
      // Media previews are muted, decorative loops; captions do not apply.
      'jsx-a11y/media-has-caption': 'off',
    },
  },
  {
    // Node scripts, tests and tooling may log freely.
    files: [
      'scripts/**',
      'tests/**',
      'supabase/functions/**',
      '**/*.config.{js,mjs,ts}',
      'packages/sdk/build.mjs',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    // The SDK logs on purpose in the local environment.
    files: ['packages/sdk/src/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
