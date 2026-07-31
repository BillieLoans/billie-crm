import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Accessibility — see docs/ux-standards.md §8. eslint-config-next enables only
      // six ARIA-correctness rules, all as warnings, so a11y previously failed nothing
      // in CI. Tier 1 below is enforced as errors; the backlog was cleared in the same
      // change. Tier 2 (click-events-have-key-events, no-static-element-interactions,
      // no-noninteractive-element-interactions, no-autofocus) stays at warn until the
      // shared <Modal> primitive has absorbed the ~87 backdrop-overlay call sites.
      // depth 3: several correct labels wrap their input alongside a title/description
      // block (e.g. NotificationControlsDrawer's suppression modes), putting the text
      // one level below the rule's default depth of 2.
      'jsx-a11y/label-has-associated-control': ['error', { depth: 3 }],
      'jsx-a11y/interactive-supports-focus': 'error',
      'jsx-a11y/tabindex-no-positive': 'error',
      'jsx-a11y/no-noninteractive-tabindex': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      'jsx-a11y/no-autofocus': 'warn',

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
