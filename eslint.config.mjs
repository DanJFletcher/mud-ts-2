import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import { readPolicy, numericRules, numericExemptions } from './scripts/quality/policy.mjs';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/storybook-static/**', '**/coverage/**', 'artifacts/**', 'generated-artifacts/**', 'scripts/extract-world-map-data.ts', 'engine-contracts/originals/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    ignores: numericExemptions,
    plugins: { sonarjs },
    rules: numericRules(readPolicy()),
  },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    plugins: { sonarjs },
    rules: { 'sonarjs/no-duplicated-branches': 'error', 'sonarjs/no-identical-functions': 'error', 'sonarjs/no-identical-expressions': 'error' },
  },
  {
    files: ['**/*.{test,spec,stories}.{ts,tsx}', '**/tests/**/*.ts', '**/__tests__/**/*.ts', '*.ts', '**/*.config.ts', 'packages/ui/.storybook/*.ts'],
    languageOptions: { parserOptions: { projectService: false, project: './tsconfig.eslint.json' } },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
