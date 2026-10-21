import { defineConfig } from '@playwright/test';
import base, { GPU_ARGS } from '../../playwright.config';

const minutes = Number(process.env.SOAK_MINUTES ?? 30);

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: /soak\.spec\.ts/,
  timeout: (minutes + 5) * 60_000,
  projects: [
    {
      name: 'soak',
      use: {
        viewport: { width: 640, height: 360 },
        launchOptions: { args: [...GPU_ARGS, '--enable-precise-memory-info', '--js-flags=--expose-gc'] },
      },
    },
  ],
});
