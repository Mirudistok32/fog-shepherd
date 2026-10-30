// Снимки собранной игры (dist/index.html по file://) в .screenshots/: экраны × 1280×720,
// 390×844, 844×390 × тёмная/светлая, игра в тумане по временам года, загон, итог уровня,
// подсказка, погоня, задание дня, рассвет.
// Заодно — ошибки консоли и прокрутка вбок. Запуск после `npm run build`:
// `npm run shots [фильтр]`, например `npm run shots fog`.
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

const OUT = resolve('.screenshots');
const URL = pathToFileURL(resolve('dist/index.html')).href;
const filter = process.argv[2] ?? '';

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 720, mobile: false },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '844x390', width: 844, height: 390, mobile: true },
];

/** Начать выбранный уровень и сдвинуть собаку, чтобы пошло время. */
async function play(page) {
  await page.locator('#btn-start').click();
  await page.keyboard.down('ArrowLeft');
  await page.clock.runFor(700);
  await page.keyboard.up('ArrowLeft');
}

/** Состояния: имя → [адрес, как до него дойти]. */
const STATES = {
  menu: ['', async () => {}],
  help: ['', (page) => page.getByRole('button', { name: 'Как играть' }).click()],
  achievements: ['', (page) => page.getByRole('button', { name: /Ачивки/ }).click()],
  training: ['?level=0', (page) => page.locator('#btn-start').click()],
  'fog-spring': ['?level=2', play],
  'fog-summer': ['?level=5', play],
  'fog-autumn': ['?level=8', play],
  'fog-winter': ['?level=12', play],
  paused: [
    '?level=3',
    async (page) => {
      await play(page);
      await page.keyboard.press('Escape');
    },
  ],
  // Загон: бот ведёт уровень, кадр — когда часть стада уже внутри.
  pen: [
    '?autopilot&level=4',
    async (page) => {
      await page.locator('#btn-start').click();
      await page.clock.runFor(26_000);
    },
  ],
  // Подсказка: на тренировке собака стоит, пока не появится совет.
  coach: [
    '?level=1',
    async (page) => {
      await page.locator('#btn-start').click();
      await page.keyboard.down('ArrowUp');
      await page.clock.runFor(200);
      await page.keyboard.up('ArrowUp');
      await page.clock.runFor(4500);
    },
  ],
  // Погоня: бот гонит стадо — видны галоп, пыль и повороты.
  chase: [
    '?autopilot&level=9',
    async (page) => {
      await page.locator('#btn-start').click();
      await page.clock.runFor(9000);
    },
  ],
  daily: ['', (page) => page.locator('#btn-daily').click()],
  // Рассвет: туман редеет, над деревней тянутся птицы.
  dawn: [
    '?level=4',
    async (page) => {
      await play(page);
      await page.clock.runFor(135_000);
    },
  ],
  result: [
    '?autopilot&level=2',
    async (page) => {
      await page.locator('#btn-start').click();
      await page.clock.runFor(45_000);
    },
  ],
};

mkdirSync(OUT, { recursive: true });
if (!filter) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
}

const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];
let count = 0;

async function shoot({ viewport, scheme, state }) {
  const name = `${state}-${viewport.name}-${scheme}`;
  if (filter && !name.includes(filter)) return;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.mobile ? 2 : 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    colorScheme: scheme,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const [query, reach] = STATES[state];
  await page.clock.install();
  await page.goto(URL + query);
  await page.clock.runFor(500);
  await reach(page);
  await page.clock.runFor(400);
  const scroll = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (scroll > 0) problems.push(`${name}: прокрутка вбок на ${scroll}px`);
  for (const e of errors) problems.push(`${name}: ${e}`);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  count++;
  await context.close();
}

for (const viewport of VIEWPORTS) {
  for (const scheme of ['dark', 'light']) {
    for (const state of ['menu', 'help', 'achievements', 'paused', 'result']) {
      await shoot({ viewport, scheme, state });
    }
  }
  for (const state of [
    'training',
    'fog-spring',
    'fog-summer',
    'fog-autumn',
    'fog-winter',
    'pen',
    'coach',
    'chase',
    'daily',
    'dawn',
  ]) {
    await shoot({ viewport, scheme: 'dark', state });
  }
}

await browser.close();
console.log(`shots: ${count} снимков в ${OUT}`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
