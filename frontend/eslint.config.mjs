import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    ignores: [
      'dist/',
      'node_modules/',
      'scripts/',
      'src/components/Badges.tsx',
      'src/components/Layout.tsx',
      'src/lib/zk/**',
      'src/pages/Home.tsx',
      'src/pages/Identity.tsx',
      'src/pages/Lending.tsx',
      'src/pages/Wallet.tsx',
      'src/snarkjs.d.ts',
      'src/test/setup.ts',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
)
