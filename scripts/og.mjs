// Картинка превью ссылки public/og.png (1200×630): бот гонит стадо к загону в тумане.
// Запуск после `npm run build`: `npm run og`.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: 'dark' });
await page.clock.install();
await page.goto(pathToFileURL(resolve('dist/index.html')).href + '?autopilot&level=4');
await page.clock.runFor(300);
await page.locator('#btn-start').click();
await page.clock.runFor(Number(process.argv[2] ?? 24_000));
await page
  .locator('#hud, #btn-whistle, #toasts')
  .evaluateAll((els) => els.forEach((el) => (el.hidden = true)));
await page.screenshot({ path: 'public/og.png' });
await browser.close();
console.log('og: public/og.png');
