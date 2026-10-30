import { readFileSync } from 'node:fs';

import { expect, type Page, test } from '@playwright/test';

import { dog, open, play, SAVED, seed, stored, timeLeft, trackErrors } from './helpers';

test('открывается с диска: меню, шрифты встроены, без ошибок и внешних запросов', async ({
  page,
}) => {
  const errors = trackErrors(page);
  const external: string[] = [];
  page.on('request', (r) => !/^(file|data|blob):/.test(r.url()) && external.push(r.url()));
  await open(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Пастух в тумане' })).toBeVisible();
  await expect(page.locator('input[name="level"]')).toHaveCount(13);
  await expect(page.locator('input[name="level"]:checked')).toHaveValue('0');
  await expect(page.locator('input[name="level"][value="2"]')).toBeDisabled();
  expect(await page.evaluate(() => document.fonts.check('16px Tektur'))).toBe(true);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('клавиатура: тренировка проходится стрелками, итог и звёзды переживают перезагрузку', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page);
  await play(page);
  await expect(page.locator('#hint')).toBeVisible();
  const start = await dog(page);
  // Как играет человек: подбежать к овцам — остановиться — снова подтолкнуть.
  for (let i = 0; i < 8 && (await page.locator('#screen-result').isHidden()); i++) {
    await page.keyboard.down('ArrowRight');
    await page.clock.runFor(500);
    await page.keyboard.up('ArrowRight');
    await page.clock.runFor(700);
  }
  await page.clock.runFor(2000);
  await expect(page.getByRole('heading', { name: 'Все дома' })).toBeVisible();
  await expect(page.locator('#result-stars')).toHaveAttribute('aria-label', /[23] звезды из 3/);
  expect((await dog(page)).x).toBeGreaterThan(start.x);
  await expect(page.locator('#btn-next')).toHaveText('Дальше: уровень 1');

  await page.getByRole('button', { name: 'В меню' }).click();
  await page.reload();
  await page.clock.runFor(300);
  const saved = await stored(page);
  expect(saved.stats.runs).toBe(1);
  expect(saved.levels['0'].stars).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.level.training .level-stars')).toHaveText(/★★/);
  await expect(page.locator('input[name="level"][value="1"]')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('мышь: собака бежит к курсору, а ушёл курсор с луга — останавливается', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, '?level=1');
  await play(page);
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('нет сцены');
  const start = await dog(page);
  await page.mouse.move(box.x + box.width - 12, box.y + box.height * 0.5);
  await page.clock.runFor(1500);
  const right = await dog(page);
  expect(right.x).toBeGreaterThan(start.x + 30);
  await expect(page.locator('#hint')).toBeHidden();

  await page.mouse.move(box.x + 12, box.y + box.height * 0.75);
  await page.clock.runFor(1500);
  const left = await dog(page);
  expect(left.x).toBeLessThan(right.x - 30);

  // Курсор ушёл с луга — собака тормозит и стоит.
  await page.mouse.move(box.x + box.width / 2, box.y - 4 > 0 ? box.y - 4 : box.y + box.height + 4);
  await page.clock.runFor(800);
  const a = await dog(page);
  await page.clock.runFor(800);
  expect(await dog(page)).toEqual(a);
  expect(errors).toEqual([]);
});

test.describe('палец', () => {
  test.use({ hasTouch: true });

  test('тап: собака бежит туда, где коснулись, и добегает после того, как палец убран', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await open(page, '?level=1');
    await play(page);
    const box = await page.locator('#scene').boundingBox();
    if (!box) throw new Error('нет сцены');
    const start = await dog(page);
    await page.touchscreen.tap(box.x + box.width * 0.15, box.y + box.height * 0.85);
    await page.clock.runFor(2500);
    const after = await dog(page);
    expect(after.x).toBeLessThan(start.x - 20);
    expect(after.y).toBeGreaterThan(start.y + 10);
    const scroll = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(scroll).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});

test('свист: пробел и кнопка, между свистами — перезарядка', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, '?level=1');
  await play(page);
  const whistle = page.getByRole('button', { name: 'Свист (пробел)' });
  await expect(whistle).toHaveAttribute('aria-disabled', 'false');
  await page.keyboard.press('Space');
  await page.clock.runFor(200);
  await expect(whistle).toHaveAttribute('aria-disabled', 'true');
  await page.clock.runFor(4200);
  await expect(whistle).toHaveAttribute('aria-disabled', 'false');
  await whistle.click();
  await page.clock.runFor(200);
  await expect(whistle).toHaveAttribute('aria-disabled', 'true');
  expect(errors).toEqual([]);
});

test('тестовый сид: уровень со своей раскладкой проходится до итога и не идёт в рекорды', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await open(page, '?seed=e2e&autopilot&level=1');
  await play(page);
  await page.clock.runFor(70_000);
  await expect(page.getByRole('heading', { name: 'Все дома' })).toBeVisible();
  await expect(page.locator('#result-level')).toContainText('вёл бот');
  await expect(page.getByRole('link', { name: 'Telegram' })).toHaveAttribute('href', /t\.me/);
  expect(await stored(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('пауза при сворачивании вкладки: время стоит; продолжение и рестарт', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, '?level=1');
  await play(page);
  await page.keyboard.down('ArrowUp');
  await page.clock.runFor(3000);
  await page.keyboard.up('ArrowUp');
  const before = await timeLeft(page);
  expect(before).toBeLessThan(130);

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('heading', { name: 'Пауза' })).toBeVisible();
  await page.clock.runFor(5000);
  expect(await timeLeft(page)).toBe(before);

  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.keyboard.press('ArrowLeft');
  await page.clock.runFor(2000);
  expect(await timeLeft(page)).toBeLessThan(before);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Начать заново' }).click();
  await expect(page.locator('#hud-time-left')).toHaveText('2:10');
  await expect(page.locator('#hud-penned')).toHaveText('0 / 6');
  await expect(page.locator('#hint')).toBeVisible();
  expect(errors).toEqual([]);
});

test('сохранение: звёзды, открытые уровни, звук и выбор уровня после перезагрузки', async ({
  page,
}) => {
  await seed(page, SAVED);
  await open(page);
  await expect(page.locator('input[name="level"][value="3"]')).toBeChecked();
  await expect(page.locator('input[name="level"][value="4"]')).toBeEnabled();
  await expect(page.locator('input[name="level"][value="5"]')).toBeDisabled();
  await expect(page.locator('#level-note')).toContainText('★☆☆');
  await expect(page.getByRole('button', { name: 'Звук: выключен' })).toBeVisible();
  await expect(page.locator('#ach-count')).toHaveText('2 из 9');

  await page.locator('input[name="level"][value="2"]').check({ force: true });
  await page.reload();
  await page.clock.runFor(200);
  await expect(page.locator('input[name="level"][value="2"]')).toBeChecked();
  expect((await stored(page)).level).toBe(2);
});

test('повреждённое сохранение не ломает игру: сообщение, данные отложены, игра идёт', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seed(page, '{"schemaVersion":1,"levels":{"1":');
  await open(page);
  await expect(page.locator('#save-notice')).toContainText('не прочиталось');
  expect(await page.evaluate(() => localStorage.getItem('fog-shepherd:save-corrupt'))).toContain(
    'levels',
  );
  await play(page);
  await expect(page.locator('#hud-penned')).toHaveText('0 / 3');
  expect(errors).toEqual([]);
});

test('резервная копия: скачать, испорченный файл не подходит, своя копия загружается', async ({
  page,
}) => {
  await seed(page, SAVED);
  await open(page);
  await page.getByRole('button', { name: /Ачивки/ }).click();
  await expect(page.locator('.ach.open')).toHaveCount(2);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать копию' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^fog-shepherd-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const text = readFileSync(await file.path(), 'utf8');
  expect(JSON.parse(text).data.levels).toEqual(SAVED.levels);

  await page.locator('#import-file').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"fog'),
  });
  await expect(page.getByText('Файл «broken.json» не подошёл')).toBeVisible();

  await page.evaluate(() => localStorage.clear());
  const fresh = await page.context().newPage();
  await open(fresh);
  await fresh.getByRole('button', { name: /Ачивки/ }).click();
  await expect(fresh.locator('.ach.open')).toHaveCount(0);
  await fresh.locator('#import-file').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  });
  await expect(fresh.getByText(/Копия «backup.json» загружена/)).toBeVisible();
  await expect(fresh.locator('.ach.open')).toHaveCount(2);
  expect((await stored(fresh)).levels).toEqual(SAVED.levels);
});

test.describe('телефон вертикально', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('мини-карта: под лугом, ничего не закрывает, касание посылает туда собаку', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await open(page, '?level=2');
    const map = page.locator('#minimap');
    await expect(map).toHaveClass(/waiting/);
    await play(page);
    await expect(map).toBeVisible();
    await expect(map).not.toHaveClass(/waiting/);
    const stage = await page.locator('#scene').boundingBox();
    const box = await map.boundingBox();
    const whistle = await page.locator('#btn-whistle').boundingBox();
    if (!stage || !box || !whistle) throw new Error('нет сцены, карты или свиста');
    expect(box.y).toBeGreaterThanOrEqual(stage.y + stage.height);
    expect(box.y + box.height).toBeLessThanOrEqual(whistle.y);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);

    // Коснуться правого края карты: собака бежит за пределы видимой части луга.
    const start = await dog(page);
    await page.touchscreen.tap(box.x + box.width - 16, box.y + box.height * 0.6);
    await page.clock.runFor(3000);
    const after = await dog(page);
    expect(after.x).toBeGreaterThan(start.x + 60);
    expect(errors).toEqual([]);
  });

  test('в меню карта скрыта, на паузе её закрывает карточка', async ({ page }) => {
    await open(page, '?level=2');
    await play(page);
    await page.locator('[data-action="pause"]').click();
    await expect(page.getByRole('heading', { name: 'Пауза' })).toBeVisible();
    await page.getByRole('button', { name: 'В меню' }).click();
    await expect(page.locator('#minimap')).toHaveClass(/waiting/);
  });
});

test.describe('широкий экран', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('луг виден целиком, мини-карты нет', async ({ page }) => {
    await open(page, '?level=2');
    await play(page);
    await expect(page.locator('#minimap')).toBeHidden();
  });
});

test.describe('окно почти квадратное', () => {
  test.use({ viewport: { width: 1000, height: 900 }, isMobile: false });

  test('мини-карта — в углу луга, под HUD, и не закрывает свист', async ({ page }) => {
    await open(page, '?level=2');
    await play(page);
    const map = await page.locator('#minimap').boundingBox();
    const stage = await page.locator('#scene').boundingBox();
    const hud = await page.locator('#hud-time').boundingBox();
    const whistle = await page.locator('#btn-whistle').boundingBox();
    if (!map || !stage || !hud || !whistle) throw new Error('нет карты, сцены, HUD или свиста');
    expect(map.y).toBeGreaterThanOrEqual(hud.y + hud.height);
    expect(map.x).toBeGreaterThanOrEqual(stage.x);
    expect(map.y + map.height).toBeLessThan(whistle.y);
  });
});

test('подсказка: появляется на первых уровнях, а для пройденного уровня молчит', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page, '?level=1');
  await play(page);
  await page.keyboard.down('ArrowUp');
  await page.clock.runFor(150);
  await page.keyboard.up('ArrowUp');
  await page.clock.runFor(7000);
  await expect(page.locator('#coach')).toBeVisible();
  await expect(page.locator('#coach')).not.toBeEmpty();
  await page.clock.runFor(6000);
  await expect(page.locator('#coach')).toBeHidden();
  expect(errors).toEqual([]);

  const other = await page.context().newPage();
  await seed(other, SAVED);
  await open(other, '?level=1');
  await play(other);
  await other.keyboard.down('ArrowUp');
  await other.clock.runFor(150);
  await other.keyboard.up('ArrowUp');
  await other.clock.runFor(7000);
  await expect(other.locator('#coach')).toBeHidden();
});

/** Подменяет буфер обмена: скопированное можно прочитать из window.__copied. */
const spyClipboard = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { __copied: string }).__copied = text;
        },
      },
    });
  });

const copied = (page: Page) =>
  page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '');

/** Проходит тренировку стрелками. */
async function finishTraining(page: Page) {
  for (let i = 0; i < 8 && (await page.locator('#screen-result').isHidden()); i++) {
    await page.keyboard.down('ArrowRight');
    await page.clock.runFor(500);
    await page.keyboard.up('ArrowRight');
    await page.clock.runFor(700);
  }
  await page.clock.runFor(2000);
  await expect(page.locator('#screen-result')).toBeVisible();
}

test('задание дня: кнопка открывает раскладку дня, в меню есть ссылка и выход в кампанию', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await spyClipboard(page);
  await open(page);
  await page.getByRole('button', { name: 'Задание дня' }).click();
  await page.waitForURL(/seed=day-\d{4}-\d{2}-\d{2}&level=\d+/);
  await page.clock.runFor(200);
  await expect(page.locator('#seed-text')).toContainText('Задание дня');
  await expect(page.locator('#btn-daily')).toBeHidden();
  await page.getByRole('button', { name: 'Скопировать ссылку' }).click();
  await expect(page.locator('#copy-message')).toContainText('Ссылка скопирована');
  const link = await copied(page);
  expect(link).toMatch(/^https:\/\/.+\?seed=day-\d{4}-\d{2}-\d{2}&level=\d+$/);
  expect(await stored(page)).toBeNull();
  await page.getByRole('link', { name: 'К кампании' }).click();
  await page.waitForURL((u) => !u.search.includes('seed'));
  await page.clock.runFor(200);
  await expect(page.locator('#seed-note')).toBeHidden();
  await expect(page.locator('#btn-daily')).toBeVisible();
  expect(errors).toEqual([]);
});

test('своя раскладка: итогом можно поделиться, в рекорды он не идёт', async ({ page }) => {
  const errors = trackErrors(page);
  await spyClipboard(page);
  await open(page, '?seed=друзья&level=0');
  await play(page);
  await finishTraining(page);
  await expect(page.locator('#result-level')).toContainText('своя раскладка');
  await page.getByRole('button', { name: 'Поделиться итогом' }).click();
  await expect(page.locator('#share-message')).toContainText('Итог скопирован');
  const text = await copied(page);
  expect(text).toContain('Пастух в тумане');
  expect(text).toMatch(/★/);
  expect(text).toContain('seed=%D0%B4%D1%80%D1%83%D0%B7%D1%8C%D1%8F');
  expect(await stored(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('буфер обмена недоступен: текст показывается, его можно выделить вручную', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = () => false;
  });
  await open(page, '?seed=abc&level=4');
  await page.getByRole('button', { name: 'Скопировать ссылку' }).click();
  await expect(page.locator('#copy-message')).toContainText('выделите');
  await expect(page.locator('#copy-box')).toBeVisible();
  await expect(page.locator('#copy-box')).toHaveValue(/seed=abc&level=4/);
});

test('плейтест: попытки пишутся и переживают перезагрузку, отчёт копируется', async ({ page }) => {
  const errors = trackErrors(page);
  await spyClipboard(page);
  await open(page, '?playtest');
  await expect(page.locator('#playtest-note')).toBeVisible();
  await play(page);
  await finishTraining(page);
  await page.getByRole('button', { name: 'Скопировать отчёт' }).click();
  await expect(page.locator('#share-message')).toContainText('попыток: 1');
  const report = await copied(page);
  expect(report).toContain('отчёт плейтеста');
  expect(report).toContain('| тренировка | 1 | 0 |');
  expect(report).toContain('keys');
  // Сохранение при этом обычное: рекорд записан.
  expect((await stored(page)).stats.runs).toBe(1);

  await page.reload();
  await page.clock.runFor(200);
  await page.locator('#playtest-note button').click();
  await expect(page.locator('#copy-message')).toContainText('попыток: 1');
  expect(errors).toEqual([]);
});

test('без ?playtest журнала нет', async ({ page }) => {
  await open(page);
  await expect(page.locator('#playtest-note')).toBeHidden();
  await play(page);
  await finishTraining(page);
  await expect(page.locator('#btn-report')).toBeHidden();
  await expect(page.locator('#btn-share')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('fog-shepherd:playtest'))).toBeNull();
});

test('фон: ветер заводится только в игре и не дублируется после паузы', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __loops: number };
    w.__loops = 0;
    const real = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      w.__loops += 1;
      return real.call(this);
    };
  });
  const errors = trackErrors(page);
  await open(page, '?level=1');
  const loops = () => page.evaluate(() => (window as unknown as { __loops: number }).__loops);
  expect(await loops()).toBe(0);
  await play(page);
  await page.keyboard.press('ArrowLeft');
  await page.clock.runFor(1500);
  expect(await loops()).toBe(1);
  await page.keyboard.press('Escape');
  await page.clock.runFor(500);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.clock.runFor(1000);
  expect(await loops()).toBe(1);
  expect(errors).toEqual([]);
});

test.describe('prefers-reduced-motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('игра идёт без ошибок: погода и пыль отключены, собака слушается', async ({ page }) => {
    const errors = trackErrors(page);
    await open(page, '?level=12');
    await play(page);
    const start = await dog(page);
    await page.keyboard.down('ArrowRight');
    await page.clock.runFor(1500);
    await page.keyboard.up('ArrowRight');
    expect((await dog(page)).x).toBeGreaterThan(start.x + 30);
    expect(errors).toEqual([]);
  });
});
