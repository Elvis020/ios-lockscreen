import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', '.vercel/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { '@stylistic': stylistic },
    languageOptions: {
      globals: {
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        crypto: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        CryptoKey: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        console: 'readonly',
        Intl: 'readonly',
      },
    },
    rules: {
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: ['return', 'throw'] },
        { blankLine: 'always', prev: ['const', 'let'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['scripts/scriptable/*.js'],
    plugins: { '@stylistic': stylistic },
    languageOptions: {
      globals: {
        args: 'readonly',
        Color: 'readonly',
        Data: 'readonly',
        DrawContext: 'readonly',
        Font: 'readonly',
        Path: 'readonly',
        Rect: 'readonly',
        Script: 'readonly',
        Size: 'readonly',
      },
    },
    rules: {
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: ['return', 'throw'] },
        { blankLine: 'always', prev: ['const', 'let'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
      ],
    },
  },
  {
    files: ['api/admin/create-invite.ts'],
    rules: {
      '@stylistic/padding-line-between-statements': 'off',
    },
  },
);
