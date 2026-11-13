import { defineConfig } from '@playwright/test';

// Smoke tests run against the production build, served statically (as it will be deployed).
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:4791',
    channel: process.env.CI ? undefined : 'chrome', // locally use installed Chrome; CI uses Playwright's Chromium
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4791 --strictPort',
    url: 'http://localhost:4791',
    reuseExistingServer: false, // never test some other app that happens to hold the port
    timeout: 120_000,
  },
});
