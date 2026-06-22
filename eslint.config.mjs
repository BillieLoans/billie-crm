import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // React Compiler lint rules (eslint-plugin-react-hooks v6, newly enabled by
      // eslint-config-next 16). purity / use-memo / immutability /
      // preserve-manual-memoization are enforced as errors (inherited default — all
      // violations fixed). set-state-in-effect stays a warning: its current ~26 hits
      // are legitimate patterns (SSR-safe client-only values, form-reset-on-open) where
      // "fixing" means risky refactors; revisit deliberately. refs/globals kept as warn
      // alongside it to avoid blocking on the same conservative-pattern family.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/globals': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: false,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^(_|ignore)',
        },
      ],
    },
  },
  {
    ignores: ['.next/'],
  },
]

export default eslintConfig
