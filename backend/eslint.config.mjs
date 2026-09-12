import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src/generated/**', 'eslint.config.mjs'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Type-aware rules worth the extra analysis time. The `no-unsafe-*`
      // family is NOT enabled: the values it objects to are LLM responses and
      // Playwright `page.evaluate` returns, which really are `any` at the
      // boundary, and turning it on today means 57 errors nobody will fix and
      // a lint everyone learns to ignore. Typing those two boundaries properly
      // is its own piece of work; enable the family in the same change.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // The diagnostic scripts are run by ts-node and talk to the operator.
  {
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  prettier,
);
