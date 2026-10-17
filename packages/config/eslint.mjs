// Shared flat ESLint config for the whole monorepo.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import { importX } from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Hard Rule 3: business-day logic must go through @hr/shared/time (tenant timezone),
// never through server-local Date getters/setters.
const LOCAL_TIME_METHODS =
  'getDay|getDate|getMonth|getFullYear|getHours|getMinutes|setDate|setMonth|setFullYear|setHours|setMinutes';

export const ignores = {
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/coverage/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '**/next-env.d.ts',
    '**/public/sw.js',
    '**/public/swe-worker-*.js',
    'reference/**',
    'supabase/**',
  ],
};

export default tseslint.config(
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'import-x': importX },
    settings: { 'import-x/internal-regex': '^@hr/' },
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression[callee.property.name=/^(${LOCAL_TIME_METHODS})$/]`,
          message:
            'Server/browser-local Date methods are banned. Use the tenant-timezone helpers in @hr/shared/time.',
        },
      ],
    },
  },
  {
    files: ['packages/shared/src/time/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },
);
