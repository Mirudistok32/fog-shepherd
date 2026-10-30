import { defineConfig, devices } from '@playwright/test';

// Игра проверяется так, как её открывает человек: dist/index.html по file:// в установленном
// Chrome, без сервера. Сборку делает `npm run test:e2e`.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: { channel: 'chrome', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel: 'chrome', viewport: { width: 390, height: 844 } },
    },
  ],
});
