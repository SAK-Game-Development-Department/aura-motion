import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-lab/**', 'node_modules/**', 'public/**', 'release/**', 'test-results/**', 'playwright-report/**', 'soak-out/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Privacy guard: no network sending APIs in app code (see CLAUDE.md).
      'no-restricted-globals': ['error',
        { name: 'XMLHttpRequest', message: 'Network sending is forbidden (privacy).' },
        { name: 'WebSocket', message: 'Network sending is forbidden (privacy).' },
        { name: 'EventSource', message: 'Network sending is forbidden (privacy).' },
      ],
      'no-restricted-properties': ['error',
        { object: 'navigator', property: 'sendBeacon', message: 'Network sending is forbidden (privacy).' },
        { object: 'navigator', property: 'mediaDevices.getDisplayMedia', message: 'Not used.' },
      ],
    },
  },
);
