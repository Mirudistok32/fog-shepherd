import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { trackErrors } from './helpers';

// Остальные тесты открывают файл с диска, а на хостинге игра живёт на http: на Vercel — в корне
// сайта, на GitHub Pages — в подпапке. Тут простой статический сервер и те же два случая.
const DIST = resolve('dist');
const TYPES: Record<string, string> = { '.html': 'text/html', '.png': 'image/png' };

function serve(prefix: string): Promise<Server> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (!path.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    const file = path.slice(prefix.length) || 'index.html';
    readFile(join(DIST, normalize(file))).then(
      (body) => res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? '' }).end(body),
      () => res.writeHead(404).end(),
    );
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

for (const [host, prefix] of [
  ['Vercel, корень сайта', '/'],
  ['GitHub Pages, подпапка', '/fog-shepherd/'],
] as const) {
  test.describe(host, () => {
    let server: Server;
    let base: string;

    test.beforeAll(async () => {
      server = await serve(prefix);
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${prefix}`;
    });
    test.afterAll(() => {
      server.close();
    });

    test('всё грузится, игра идёт, запросов мимо сайта нет', async ({ page }) => {
      const errors = trackErrors(page);
      const failed: string[] = [];
      const external: string[] = [];
      page.on('response', (r) => r.status() >= 400 && failed.push(r.url()));
      page.on('request', (r) => {
        if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(base)) external.push(r.url());
      });
      await page.goto(base);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.locator('#btn-start').click();
      await expect(page.locator('#hud')).toBeVisible();
      expect(await page.evaluate(() => document.fonts.check('16px Tektur'))).toBe(true);
      expect((await page.request.get(`${base}og.png`)).status()).toBe(200);
      expect(failed).toEqual([]);
      expect(external).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('задание дня и выход в кампанию не теряют путь сайта, ссылка ведёт сюда же', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (text: string) => {
              (window as unknown as { __copied: string }).__copied = text;
            },
          },
        });
      });
      await page.goto(base);
      await page.getByRole('button', { name: 'Задание дня' }).click();
      await page.waitForURL((u) => u.search.includes('seed=day-'));
      expect(new URL(page.url()).pathname).toBe(prefix);
      await page.getByRole('button', { name: 'Скопировать ссылку' }).click();
      await expect(page.locator('#copy-message')).toContainText('скопирована');
      const link = await page.evaluate(
        () => (window as unknown as { __copied?: string }).__copied ?? '',
      );
      expect(link.startsWith(`${base}?seed=day-`)).toBe(true);
      await page.getByRole('link', { name: 'К кампании' }).click();
      await page.waitForURL((u) => !u.search.includes('seed'));
      expect(new URL(page.url()).pathname).toBe(prefix);
    });
  });
}

test('метатеги: адрес подставлен, превью и canonical абсолютные', async ({ page }) => {
  const html = await readFile(join(DIST, 'index.html'), 'utf8');
  expect(html).not.toContain('__SITE_URL__');
  await page.setContent(html.slice(0, html.indexOf('<script type="module">')));
  const site = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(site).toMatch(/^https:\/\/.+\/$/);
  expect(await page.locator('meta[property="og:url"]').getAttribute('content')).toBe(site);
  expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toBe(
    `${site}og.png`,
  );
});
