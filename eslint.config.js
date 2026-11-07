// Lint: TypeScript's recommended rules + the React hooks rules (hooks called conditionally or in
// the wrong order are real bugs). Formatting is not linted. Run in CI (see ci.yml).
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'supabase/functions/_shared/*.generated.ts', 'docs/**', 'coverage/**', 'test-results/**', 'playwright-report/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // unused values are already errors in tsc (noUnusedLocals); `_name` marks an intentional one
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', ignoreRestSiblings: true }],
      // Supabase / Deno edge-function payloads are untyped JSON at the boundary
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
