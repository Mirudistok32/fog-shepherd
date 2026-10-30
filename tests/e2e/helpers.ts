import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, type Page } from '@playwright/test';

export const SAVE_KEY = 'fog-shepherd:save';
export const URL = pathToFileURL(resolve('dist/index.html')).href;

/** Собирает ошибки консоли и страницы — в конце теста их должно быть ноль. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Открывает игру с диска с управляемыми часами: время крутим сами через page.clock. */
export async function open(page: Page, query = '') {
  await page.clock.install();
  await page.goto(URL + query);
  await page.clock.runFor(200);
}

export async function seed(page: Page, value: object | string) {
  await page.addInitScript(
    ([key, raw]) => {
      if (!localStorage.getItem(key as string)) localStorage.setItem(key as string, raw as string);
    },
    [SAVE_KEY, typeof value === 'string' ? value : JSON.stringify(value)],
  );
}

export const stored = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), SAVE_KEY);

/** Где собака (в координатах луга) — из атрибута сцены. */
export async function dog(page: Page): Promise<{ x: number; y: number }> {
  const raw = (await page.locator('#stage').getAttribute('data-dog')) ?? '';
  const [x, y] = raw.split(',').map(Number);
  return { x: x ?? NaN, y: y ?? NaN };
}

/** Начать выбранный в меню уровень кнопкой «Играть». */
export async function play(page: Page) {
  await page.locator('#btn-start').click();
  await expect(page.locator('#hud')).toBeVisible();
}

/** Сколько осталось до рассвета по HUD, с. */
export async function timeLeft(page: Page): Promise<number> {
  const [m, s] = ((await page.locator('#hud-time-left').textContent()) ?? '0:00').split(':');
  return Number(m) * 60 + Number(s);
}

export const SAVED = {
  schemaVersion: 1,
  sound: false,
  theme: 'system',
  level: 3,
  levels: {
    '0': { stars: 3, saved: 3, time: 6.2 },
    '1': { stars: 3, saved: 6, time: 28.4 },
    '2': { stars: 2, saved: 8, time: 61 },
    '3': { stars: 1, saved: 8, time: null },
  },
  achievements: {
    'first-flock': '2026-10-29T10:00:00.000Z',
    'whole-flock': '2026-10-29T10:05:00.000Z',
  },
  stats: { runs: 6, flocks: 3, penned: 25, lost: 2, whistles: 9, seasons: ['spring'] },
};
