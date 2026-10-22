import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/eval/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
